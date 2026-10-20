from dataclasses import dataclass

import httpx
import pytest
import yaml

from clash_config_center.app import create_app
from clash_config_center.config import Settings

SS_NODE = {
    "name": "香港01",
    "type": "ss",
    "server": "example.com",
    "port": 443,
    "cipher": "aes-128-gcm",
    "password": "test-password",
}
VLESS_NODE = {
    "name": "香港01",
    "type": "vless",
    "server": "vless.example.com",
    "port": 443,
    "uuid": "12345678-1234-1234-1234-123456789abc",
    "tls": True,
    "servername": "vless.example.com",
}


@dataclass
class Harness:
    app: object
    client: httpx.AsyncClient
    upstream: dict
    admin_token: str
    settings: Settings

    async def source(self, name="手动", kind="manual", url=None):
        response = await self.client.post(
            "/api/v1/sources", json={"name": name, "kind": kind, "url": url}
        )
        assert response.status_code == 201, response.text
        return response.json()

    async def add(self, source_id, config=None):
        response = await self.client.post(
            f"/api/v1/sources/{source_id}/nodes", json={"config": config or SS_NODE}
        )
        assert response.status_code == 201, response.text
        return response.json()

    async def refresh(self, source_id):
        response = await self.client.post(f"/api/v1/sources/{source_id}/refresh")
        assert response.status_code == 200, response.text
        return response.json()

    async def export(self, source_ids, **kwargs):
        response = await self.client.post(
            "/api/v1/exports", json={"name": "测试出口", "source_ids": source_ids, **kwargs}
        )
        assert response.status_code == 201, response.text
        return response.json()


@pytest.fixture
async def harness(tmp_path, capsys):
    upstream = {"/a": {"proxies": [SS_NODE]}, "/b": {"proxies": [VLESS_NODE]}}

    async def handler(request):
        value = upstream.get(request.url.path, 404)
        if isinstance(value, Exception):
            raise value
        if callable(value):
            return await value(request)
        if isinstance(value, int):
            return httpx.Response(value)
        return httpx.Response(
            200, text=value if isinstance(value, str) else yaml.safe_dump(value, allow_unicode=True)
        )

    settings = Settings(_env_file=None, data_dir=tmp_path / "data", scheduler_enabled=False)
    app = create_app(settings, transport=httpx.MockTransport(handler))
    async with app.router.lifespan_context(app):
        token = capsys.readouterr().out.strip().rsplit(": ", 1)[-1]
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
            headers={"Authorization": f"Bearer {token}"},
        ) as client:
            yield Harness(app, client, upstream, token, settings)
