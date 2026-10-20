"""Create two URL sources plus a manual source, then fetch the merged subscription."""

import argparse
import getpass
import os
import uuid

import httpx
import yaml


def main():
    parser = argparse.ArgumentParser(description="通过 API 创建完整示例。会新增来源和出口。")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--source-a", required=True)
    parser.add_argument("--source-b", required=True)
    parser.add_argument("--ss-server", default="ss.example.com")
    parser.add_argument("--ss-port", type=int, default=443)
    parser.add_argument("--ss-password", default="replace-me")
    args = parser.parse_args()
    token = os.environ.get("CCC_ADMIN_TOKEN") or getpass.getpass("管理 Token: ")
    suffix = uuid.uuid4().hex[:6]
    with httpx.Client(
        base_url=args.base_url, headers={"Authorization": f"Bearer {token}"}, timeout=60
    ) as client:

        def call(method, path, **kwargs):
            response = client.request(method, path, **kwargs)
            if response.is_error:
                raise SystemExit(f"API 操作失败：HTTP {response.status_code}，{response.text}")
            return response.json()

        call("GET", "/api/v1/auth/check")
        ids = []
        for name, url in (("机场A", args.source_a), ("机场B", args.source_b)):
            source = call(
                "POST",
                "/api/v1/sources",
                json={"name": f"{name}-{suffix}", "kind": "url", "url": url},
            )
            ids.append(source["id"])
            state = call("POST", f"/api/v1/sources/{source['id']}/refresh")
            if state["status"] != "ready":
                raise SystemExit(
                    f"上游拉取失败：{state['last_error']}；来源已创建，可在管理接口中修正或删除。"
                )
        manual = call("POST", "/api/v1/sources", json={"name": f"自建-{suffix}", "kind": "manual"})
        call(
            "POST",
            f"/api/v1/sources/{manual['id']}/nodes",
            json={
                "config": {
                    "name": "示例SS",
                    "type": "ss",
                    "server": args.ss_server,
                    "port": args.ss_port,
                    "cipher": "aes-128-gcm",
                    "password": args.ss_password,
                }
            },
        )
        config = {
            "name": f"示例出口-{suffix}",
            "source_ids": [*ids, manual["id"]],
            "injection": "grouped",
        }
        preview = call("POST", "/api/v1/exports/preview", json=config)
        export = call("POST", "/api/v1/exports", json=config)
        response = client.get(export["subscription_url"])
        if response.status_code != 200:
            raise SystemExit(f"客户端拉取失败：HTTP {response.status_code}")
        document = yaml.safe_load(response.text)
        print(
            f"预览 {preview['node_count']} 个节点；客户端实际取得 {len(document['proxies'])} 个节点。"
        )
        print(f"出口 ID: {export['id']}")
        print(f"订阅地址（包含访问 Token，请保存）: {export['subscription_url']}")


if __name__ == "__main__":
    main()
