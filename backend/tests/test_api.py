import asyncio
import copy

import httpx
import pytest
import yaml
from conftest import SS_NODE, VLESS_NODE
from sqlalchemy import delete

from clash_config_center.app import create_app
from clash_config_center.models import Export, ExportSnapshot, Source, SystemSetting
from clash_config_center.security import token_digest


@pytest.mark.parametrize("kind", ["manual", "url"])
async def test_source_ignores_rebuild_exports_and_survive_refresh_and_restart(harness, kind):
    h = harness
    response = await h.client.post(
        "/api/v1/sources",
        json={
            "name": "过滤来源",
            "kind": kind,
            "url": "https://upstream.test/a" if kind == "url" else None,
            "ignored_node_names": ["香港01"],
        },
    )
    assert response.status_code == 201
    source = response.json()
    sid = source["id"]
    keep = {**SS_NODE, "name": "保留"}
    if kind == "url":
        h.upstream["/a"] = {"proxies": [SS_NODE, SS_NODE, keep]}
        await h.refresh(sid)
    else:
        for node in (SS_NODE, SS_NODE, keep):
            await h.add(sid, node)
    source = (await h.client.get(f"/api/v1/sources/{sid}")).json()
    assert source["node_count"] == 3 and source["ignored_node_count"] == 2
    assert len((await h.client.get(f"/api/v1/sources/{sid}/nodes")).json()) == 3
    export = await h.export([sid], prefix_source_name=False)
    assert export["prefix_source_name"] is False
    doc = yaml.safe_load((await h.client.get(export["subscription_url"])).text)
    assert [n["name"] for n in doc["proxies"]] == ["保留"]
    second_export = await h.export([sid])
    assert second_export["prefix_source_name"] is True

    restored = await h.client.patch(f"/api/v1/sources/{sid}", json={"ignored_node_names": []})
    assert restored.status_code == 200 and restored.json()["ignored_node_count"] == 0
    for item in (export, second_export):
        assert (
            len(yaml.safe_load((await h.client.get(item["subscription_url"])).text)["proxies"]) == 3
        )
    response = await h.client.patch(
        f"/api/v1/sources/{sid}", json={"ignored_node_names": ["香港01"]}
    )
    assert response.status_code == 200
    if kind == "url":
        h.upstream["/a"]["proxies"].reverse()
        refreshed = await h.refresh(sid)
        assert refreshed["ignored_node_count"] == 2
        h.upstream["/a"] = 503
        assert (await h.refresh(sid))["using_stale_snapshot"]
    else:
        await h.add(sid, SS_NODE)
    preview = await h.client.post(
        "/api/v1/exports/preview",
        json={"name": "预览", "source_ids": [sid], "prefix_source_name": False},
    )
    assert preview.status_code == 200 and preview.json()["node_count"] == 1
    assert preview.json()["yaml"] == (await h.client.get(export["subscription_url"])).text
    # A new app instance reads persisted options and the same published subscription.
    app = create_app(h.settings, transport=httpx.MockTransport(lambda _: httpx.Response(503)))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
            headers={"Authorization": f"Bearer {h.admin_token}"},
        ) as client:
            assert (await client.get(f"/api/v1/sources/{sid}")).json()["ignored_node_names"] == [
                "香港01"
            ]
            assert (await client.get(f"/api/v1/exports/{export['id']}")).json()[
                "prefix_source_name"
            ] is False
            assert (
                len(yaml.safe_load((await client.get(export["subscription_url"])).text)["proxies"])
                == 1
            )


async def test_prefix_patch_and_invalid_ignore_keep_previous_output(harness):
    h = harness
    source = await h.source()
    sid = source["id"]
    assert source["ignored_node_names"] == [] and source["ignored_node_count"] == 0
    await h.add(sid)
    export = await h.export([sid])
    initial = await h.client.get(export["subscription_url"])
    response = await h.client.patch(
        f"/api/v1/exports/{export['id']}", json={"prefix_source_name": False}
    )
    assert response.status_code == 200 and response.json()["prefix_source_name"] is False
    changed = await h.client.get(export["subscription_url"])
    assert changed.headers["etag"] != initial.headers["etag"]
    assert yaml.safe_load(changed.text)["proxies"][0]["name"] == "香港01"
    response = await h.client.patch(
        f"/api/v1/sources/{sid}", json={"ignored_node_names": ["香港01"]}
    )
    assert response.status_code == 200
    state = (await h.client.get(f"/api/v1/exports/{export['id']}")).json()
    assert state["using_stale_snapshot"] and "至少需要一个节点" in state["last_error"]
    assert (await h.client.get(export["subscription_url"])).text == changed.text
    for invalid in (None, "香港01", [1], [""]):
        response = await h.client.patch(
            f"/api/v1/sources/{sid}", json={"ignored_node_names": invalid}
        )
        assert response.status_code == 422
    assert (
        await h.client.patch(f"/api/v1/exports/{export['id']}", json={"prefix_source_name": None})
    ).status_code == 422
    await h.client.patch(f"/api/v1/sources/{sid}", json={"ignored_node_names": []})
    restored = (await h.client.get(f"/api/v1/exports/{export['id']}")).json()
    assert restored["last_error"] is None and not restored["using_stale_snapshot"]
    response = await h.client.patch(
        f"/api/v1/exports/{export['id']}", json={"prefix_source_name": True}
    )
    assert response.status_code == 200
    assert (await h.client.get(export["subscription_url"])).text == initial.text


async def test_auth_initialization_persistence_and_reset(harness, capsys):
    h = harness
    assert (await h.client.get("/api/v1/auth/check")).json() == {"authenticated": True}
    assert (
        await h.client.get("/api/v1/sources", headers={"Authorization": "Bearer wrong"})
    ).status_code == 401
    async with h.app.state.service.db.sessions() as session:
        setting = await session.get(SystemSetting, "admin_token_hash")
        assert setting.value == token_digest(h.admin_token)
        assert setting.value != h.admin_token
    assert await h.app.state.service.db.initialize() is None
    new_token = await h.app.state.service.db.reset_admin_token()
    assert (await h.client.get("/api/v1/auth/check")).status_code == 401
    assert (
        await h.client.get("/api/v1/auth/check", headers={"Authorization": f"Bearer {new_token}"})
    ).status_code == 200
    assert "Token" not in capsys.readouterr().out


async def test_full_workflow_failure_fallback_and_tokens(harness):
    h = harness
    a = await h.source("机场A", "url", "https://upstream.test/a?token=upstream-secret")
    b = await h.source("机场B", "url", "https://upstream.test/b")
    manual = await h.source("自建")
    assert a["status"] == "pending"
    assert (await h.refresh(a["id"]))["status"] == "ready"
    await h.refresh(b["id"])
    response = await h.client.post(
        f"/api/v1/sources/{manual['id']}/nodes",
        json={
            "yaml": "name: 自建Trojan\ntype: trojan\nserver: trojan.example.com\nport: 443\npassword: secret\nsni: trojan.example.com"
        },
    )
    assert response.status_code == 201
    export = await h.export([a["id"], b["id"], manual["id"]], token="client-secret")
    link = export["subscription_url"]
    response = await h.client.get(link)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/yaml; charset=utf-8"
    document = yaml.safe_load(response.text)
    assert [node["type"] for node in document["proxies"]] == ["ss", "vless", "trojan"]
    cached_yaml, etag = response.text, response.headers["etag"]
    assert (await h.client.get(link, headers={"If-None-Match": etag})).status_code == 304
    assert (await h.client.get(link, headers={"If-None-Match": f"W/{etag}"})).status_code == 304
    wrong = await h.client.get(f"/sub/{export['id']}?token=wrong", headers={"If-None-Match": etag})
    assert wrong.status_code == 404
    # An admin token cannot authenticate to the public subscription endpoint.
    assert (await h.client.get(f"/sub/{export['id']}?token={h.admin_token}")).status_code == 404
    assert (
        await h.client.get("/api/v1/sources", headers={"Authorization": "Bearer client-secret"})
    ).status_code == 401
    detail = (await h.client.get(f"/api/v1/exports/{export['id']}")).json()
    assert "token" not in detail and "token_hash" not in detail and "subscription_url" not in detail
    listed = (await h.client.get("/api/v1/exports")).text
    assert "client-secret" not in listed
    creds = (await h.client.get(f"/api/v1/exports/{export['id']}/credentials")).json()
    assert creds == {"token": "client-secret", "subscription_url": link}
    assert (await h.client.get(f"/api/v1/sources/{a['id']}/groups")).status_code == 200
    assert (await h.client.get(f"/api/v1/sources/{manual['id']}/groups")).json() == []
    h.upstream["/a"] = 503
    source = await h.refresh(a["id"])
    assert source["using_stale_snapshot"] and source["last_success_at"]
    assert source["last_error"] == "上游返回 HTTP 503"
    assert (await h.client.get(link)).text == cached_yaml
    detail = (await h.client.get(f"/api/v1/exports/{export['id']}")).json()
    assert detail["using_stale_snapshot"] and detail["source_errors"]
    rotated = await h.client.put(f"/api/v1/exports/{export['id']}/token", json={})
    assert rotated.status_code == 200
    assert (await h.client.get(link)).status_code == 404
    new_link = rotated.json()["subscription_url"]
    assert (await h.client.get(new_link)).status_code == 200
    async with h.app.state.service.db.sessions() as session:
        row = await session.get(Export, export["id"])
        assert row.token_hash == token_digest(rotated.json()["token"])
    # Credentials can be fetched again any time and always reflect the current token.
    for _ in range(2):
        again = await h.client.get(f"/api/v1/exports/{export['id']}/credentials")
        assert again.status_code == 200 and again.json() == rotated.json()
    async with h.app.state.service.db.sessions.begin() as session:
        (await session.get(Export, export["id"])).token = None
    legacy = await h.client.get(f"/api/v1/exports/{export['id']}/credentials")
    assert legacy.status_code == 409
    assert (await h.client.get(new_link)).status_code == 200
    assert (
        await h.client.patch(f"/api/v1/exports/{export['id']}", json={"enabled": False})
    ).status_code == 200
    assert (await h.client.get(new_link)).status_code == 404
    assert (await h.client.delete(f"/api/v1/sources/{a['id']}")).status_code == 409
    assert (await h.client.delete(f"/api/v1/exports/{export['id']}")).status_code == 204
    assert (await h.client.delete(f"/api/v1/sources/{a['id']}")).status_code == 204


async def test_preview_no_initial_snapshot_and_atomic_validation(harness):
    h = harness
    remote = await h.source("远程", "url", "https://upstream.test/a")
    body = {"name": "出口", "source_ids": [remote["id"]]}
    assert (await h.client.post("/api/v1/exports", json=body)).status_code == 422
    assert (await h.client.get("/api/v1/exports")).json() == []
    await h.refresh(remote["id"])
    preview = await h.client.post("/api/v1/exports/preview", json=body)
    assert preview.status_code == 200 and preview.json()["node_count"] == 1
    assert (await h.client.get("/api/v1/exports")).json() == []
    export = await h.export([remote["id"]])
    before = (await h.client.get(export["subscription_url"])).text
    invalid = await h.client.patch(
        f"/api/v1/exports/{export['id']}", json={"target_groups": ["不存在"]}
    )
    assert invalid.status_code == 422
    assert (await h.client.get(export["subscription_url"])).text == before
    assert (await h.client.get(f"/api/v1/exports/{export['id']}")).json()["target_groups"] == [
        "代理选择"
    ]
    async with h.app.state.service.db.sessions.begin() as session:
        await session.execute(
            delete(ExportSnapshot).where(ExportSnapshot.export_id == export["id"])
        )
    assert (await h.client.get(export["subscription_url"])).status_code == 503


async def test_node_crud_order_import_is_atomic_and_rebuilds(harness):
    h = harness
    source = await h.source()
    nodes = await h.add(source["id"])
    first_id = nodes[0]["id"]
    export = await h.export([source["id"]], injection="direct")
    initial = (await h.client.get(export["subscription_url"])).text
    assert (
        await h.client.post(
            f"/api/v1/sources/{source['id']}/nodes/import",
            json={"content": "proxies:\n- name: invalid\n  type: ss"},
        )
    ).status_code == 422
    assert len((await h.client.get(f"/api/v1/sources/{source['id']}/nodes")).json()) == 1
    nodes = await h.add(source["id"], VLESS_NODE)
    second_id = nodes[1]["id"]
    assert (await h.client.get(export["subscription_url"])).text != initial
    ordered = await h.client.put(
        f"/api/v1/sources/{source['id']}/nodes/order", json={"node_ids": [second_id, first_id]}
    )
    assert ordered.status_code == 200
    result = yaml.safe_load((await h.client.get(export["subscription_url"])).text)
    assert [node["type"] for node in result["proxies"]] == ["vless", "ss"]
    assert (
        await h.client.put(
            f"/api/v1/sources/{source['id']}/nodes/order", json={"node_ids": [first_id, first_id]}
        )
    ).status_code == 422
    changed = await h.client.patch(
        f"/api/v1/sources/{source['id']}/nodes/{first_id}",
        json={"config": {**SS_NODE, "name": "新名称"}},
    )
    assert changed.status_code == 200
    assert "新名称" in (await h.client.get(export["subscription_url"])).text
    assert (
        await h.client.delete(f"/api/v1/sources/{source['id']}/nodes/{first_id}")
    ).status_code == 204
    assert len((await h.client.get(f"/api/v1/sources/{source['id']}/nodes")).json()) == 1


@pytest.mark.parametrize("injection", ["direct", "grouped"])
async def test_inheritance_and_failed_rebuild_retains_previous_export(harness, injection):
    h = harness
    original = {
        "proxies": [SS_NODE],
        "proxy-groups": [{"name": "上游选择", "type": "select", "proxies": ["香港01"]}],
        "rules": ["MATCH,上游选择"],
        "dns": {"enable": False},
        "mixed-port": 7891,
    }
    h.upstream["/a"] = original
    base = await h.source("上游", "url", "https://upstream.test/a")
    manual = await h.source()
    await h.refresh(base["id"])
    await h.add(manual["id"])
    export = await h.export(
        [base["id"], manual["id"]],
        mode="inherit",
        base_source_id=base["id"],
        target_groups=["上游选择"],
        injection=injection,
    )
    groups = await h.client.get(f"/api/v1/sources/{base['id']}/groups")
    assert groups.json() == ["上游选择"]
    before = (await h.client.get(export["subscription_url"])).text
    document = yaml.safe_load(before)
    assert document["dns"] == original["dns"] and document["mixed-port"] == 7891
    changed = copy.deepcopy(original)
    changed["proxy-groups"][0]["name"] = "更名后的组"
    changed["rules"] = ["MATCH,更名后的组"]
    h.upstream["/a"] = changed
    assert (await h.refresh(base["id"]))["status"] == "ready"
    assert (await h.client.get(export["subscription_url"])).text == before
    state = (await h.client.get(f"/api/v1/exports/{export['id']}")).json()
    assert state["using_stale_snapshot"] and state["last_error"]
    fixed = await h.client.patch(
        f"/api/v1/exports/{export['id']}", json={"target_groups": ["更名后的组"]}
    )
    assert fixed.status_code == 200 and fixed.json()["last_error"] is None
    assert "更名后的组" in (await h.client.get(export["subscription_url"])).text
    # Mode switching clears the mutually exclusive old mode's setting.
    changed_mode = await h.client.patch(
        f"/api/v1/exports/{export['id']}", json={"mode": "template", "target_groups": ["代理选择"]}
    )
    assert changed_mode.status_code == 200


async def test_concurrent_refresh_atomic_reads_and_old_url_result_discard(harness):
    h = harness
    source = await h.source("A", "url", "https://upstream.test/a")
    await h.refresh(source["id"])
    export = await h.export([source["id"]])
    old_content = (await h.client.get(export["subscription_url"])).text
    started, release = asyncio.Event(), asyncio.Event()
    active, peak, calls = 0, 0, 0

    async def slow(_request):
        nonlocal active, peak, calls
        active += 1
        peak = max(peak, active)
        calls += 1
        started.set()
        await release.wait()
        active -= 1
        return httpx.Response(
            200, text=yaml.safe_dump({"proxies": [{**SS_NODE, "name": "更新节点"}]})
        )

    h.upstream["/a"] = slow
    first = asyncio.create_task(h.refresh(source["id"]))
    await asyncio.wait_for(started.wait(), 3)
    second = asyncio.create_task(h.refresh(source["id"]))
    assert (await h.client.get(export["subscription_url"])).text == old_content
    release.set()
    await asyncio.gather(first, second)
    assert calls == 2 and peak == 1
    assert "更新节点" in (await h.client.get(export["subscription_url"])).text
    started.clear()
    release.clear()
    stale_request = asyncio.create_task(h.refresh(source["id"]))
    await asyncio.wait_for(started.wait(), 3)
    assert (
        await h.client.patch(
            f"/api/v1/sources/{source['id']}", json={"url": "https://upstream.test/b"}
        )
    ).status_code == 200
    release.set()
    await stale_request
    assert (await h.client.get(f"/api/v1/sources/{source['id']}")).json()["using_stale_snapshot"]
    await h.refresh(source["id"])
    result = yaml.safe_load((await h.client.get(export["subscription_url"])).text)
    assert result["proxies"][0]["type"] == "vless"


async def test_scheduler_errors_and_recovery(harness):
    h = harness
    source = await h.source("A", "url", "https://upstream.test/a")
    await h.app.state.service.refresh_due()
    assert (await h.client.get(f"/api/v1/sources/{source['id']}")).json()["has_snapshot"]
    for failure in (
        "proxies: [invalid]",
        httpx.ReadTimeout("contains-a-secret-url"),
        "proxy-providers: {a: {type: http}}",
    ):
        h.upstream["/a"] = failure
        result = await h.refresh(source["id"])
        assert result["status"] == "error" and result["using_stale_snapshot"]
        assert "secret-url" not in result["last_error"]
        assert result["node_count"] == 1
    h.upstream["/a"] = {"proxies": [VLESS_NODE]}
    async with h.app.state.service.db.sessions.begin() as session:
        row = await session.get(Source, source["id"])
        row.next_refresh_at = 0
    await h.app.state.service.refresh_due()
    result = (await h.client.get(f"/api/v1/sources/{source['id']}")).json()
    assert result["status"] == "ready" and not result["using_stale_snapshot"]


async def test_restart_restores_config_tokens_and_snapshot(harness, capsys):
    h = harness
    source = await h.source()
    await h.add(source["id"])
    export = await h.export([source["id"]])
    before = (await h.client.get(export["subscription_url"])).text
    second_app = create_app(
        h.settings, transport=httpx.MockTransport(lambda _: httpx.Response(503))
    )
    async with second_app.router.lifespan_context(second_app):
        assert "Token" not in capsys.readouterr().out
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=second_app),
            base_url="http://testserver",
            headers={"Authorization": f"Bearer {h.admin_token}"},
        ) as client:
            assert (await client.get("/api/v1/auth/check")).status_code == 200
            assert (await client.get(export["subscription_url"])).text == before
            assert (await client.get("/api/v1/sources")).json()[0]["id"] == source["id"]


async def test_schema_validation_and_no_sensitive_echo(harness):
    h = harness
    response = await h.client.post(
        "/api/v1/sources", json={"name": "x", "kind": "url", "url": "ftp://secret"}
    )
    assert response.status_code == 422 and "ftp://secret" not in response.text
    source = await h.source()
    assert (
        await h.client.patch(f"/api/v1/sources/{source['id']}", json={"name": None})
    ).status_code == 422
    assert (await h.client.get(f"/api/v1/sources/{source['id']}")).json()["name"] == "手动"
    document = (await h.client.get("/openapi.json")).json()
    assert document["components"]["securitySchemes"]["HTTPBearer"]["scheme"] == "bearer"
    assert document["paths"]["/api/v1/exports"]["post"]["security"] == [{"HTTPBearer": []}]
    assert "security" not in document["paths"]["/sub/{export_id}"]["get"]
