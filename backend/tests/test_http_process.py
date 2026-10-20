import json
import os
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import yaml
from conftest import SS_NODE, VLESS_NODE


def test_real_http_two_remote_sources_and_failure_fallback(tmp_path):
    """Exercise the delivered CLI and real sockets, not only the ASGI adapter."""
    state = {"fail": False}

    class Upstream(BaseHTTPRequestHandler):
        def do_GET(self):
            if state["fail"]:
                self.send_response(503)
                self.end_headers()
                return
            body = yaml.safe_dump(
                {"proxies": [SS_NODE if self.path == "/a" else VLESS_NODE]}
            ).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
    thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    thread.start()
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    command = [sys.executable, "-m", "clash_config_center", "--data-dir", str(tmp_path / "data")]
    env = {
        **os.environ,
        "CCC_SCHEDULER_ENABLED": "false",
        "PYTHONIOENCODING": "utf-8",
        "CCC_PUBLIC_BASE_URL": f"http://127.0.0.1:{port}",
        "CCC_CORS_ORIGINS": "[]",
    }
    initialized = subprocess.run(
        [*command, "init"], capture_output=True, text=True, encoding="utf-8", env=env, timeout=30
    )
    assert initialized.returncode == 0, initialized.stderr
    token = initialized.stdout.strip().rsplit(": ", 1)[-1]
    assert len(token) >= 40
    log_path = tmp_path / "server.log"
    with log_path.open("wb") as log:
        process = subprocess.Popen(
            [*command, "serve", "--host", "127.0.0.1", "--port", str(port)],
            stdout=log,
            stderr=log,
            env=env,
        )
        try:
            with httpx.Client(
                base_url=f"http://127.0.0.1:{port}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=5,
                trust_env=False,
            ) as client:
                deadline = time.monotonic() + 20
                while True:
                    try:
                        if client.get("/health").status_code == 200:
                            break
                    except httpx.TransportError:
                        pass
                    if process.poll() is not None or time.monotonic() > deadline:
                        raise AssertionError("CLI server failed to become ready")
                    time.sleep(0.1)
                source_ids = []
                for name in ("a", "b"):
                    response = client.post(
                        "/api/v1/sources",
                        json={
                            "name": name,
                            "kind": "url",
                            "url": f"http://127.0.0.1:{upstream.server_port}/{name}",
                        },
                    )
                    assert response.status_code == 201, response.text
                    source_id = response.json()["id"]
                    source_ids.append(source_id)
                    assert (
                        client.post(f"/api/v1/sources/{source_id}/refresh").json()["status"]
                        == "ready"
                    )
                manual = client.post(
                    "/api/v1/sources", json={"name": "自建", "kind": "manual"}
                ).json()
                assert (
                    client.post(
                        f"/api/v1/sources/{manual['id']}/nodes",
                        json={"config": {**SS_NODE, "name": "本地"}},
                    ).status_code
                    == 201
                )
                response = client.post(
                    "/api/v1/exports",
                    json={"name": "真实HTTP", "source_ids": [*source_ids, manual["id"]]},
                )
                assert response.status_code == 201, response.text
                export = response.json()
                first = client.get(export["subscription_url"])
                assert len(yaml.safe_load(first.text)["proxies"]) == 3
                state["fail"] = True
                assert client.post(f"/api/v1/sources/{source_ids[0]}/refresh").json()[
                    "using_stale_snapshot"
                ]
                assert client.get(export["subscription_url"]).text == first.text
                assert (
                    client.get(
                        export["subscription_url"], headers={"If-None-Match": first.headers["etag"]}
                    ).status_code
                    == 304
                )
                (tmp_path / "result.yaml").write_text(first.text, encoding="utf-8")
                json.dumps(client.get("/openapi.json").json())
                reset = subprocess.run(
                    [*command, "admin-token", "reset"],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    env=env,
                    timeout=30,
                )
                assert reset.returncode == 0
                assert client.get("/api/v1/auth/check").status_code == 401
                new_admin = reset.stdout.strip().rsplit(": ", 1)[-1]
                assert (
                    client.get(
                        "/api/v1/auth/check", headers={"Authorization": f"Bearer {new_admin}"}
                    ).status_code
                    == 200
                )
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            upstream.shutdown()
            upstream.server_close()
            thread.join(timeout=5)
    log_text = log_path.read_text(encoding="utf-8", errors="replace")
    assert "?token=" not in log_text
    assert token not in log_text
