import base64

import pytest

from clash_config_center.errors import DomainError
from clash_config_center.parsing import load_yaml, parse_subscription, parse_uri, validate_node

UUID = "12345678-1234-1234-1234-123456789abc"


def b64(value):
    return base64.urlsafe_b64encode(value.encode()).decode().rstrip("=")


@pytest.mark.parametrize(
    "uri",
    [
        f"ss://{b64('aes-128-gcm:secret')}@example.com:443#香港",
        f"ss://{b64('aes-128-gcm:secret@example.com:443')}#香港",
        "ss://aes-128-gcm:secret@example.com:443#香港",
    ],
)
def test_ss_variants(uri):
    node = parse_uri(uri)
    assert node["name"] == "香港"
    assert node["password"] == "secret"
    assert node["server"] == "example.com"


def test_ss_ipv6_and_escaped_password():
    node = parse_uri("ss://aes-128-gcm:p%40ss%3Aword@[::1]:443#local")
    assert node["server"] == "::1"
    assert node["password"] == "p@ss:word"


@pytest.mark.parametrize("password", ["literal%40value", "a/b?c#d@e:secret"])
def test_base64_ss_password_is_not_url_decoded_twice(password):
    for link in (
        f"ss://{b64('aes-128-gcm:' + password)}@example.com:443",
        f"ss://{b64('aes-128-gcm:' + password + '@example.com:443')}",
    ):
        assert parse_uri(link)["password"] == password


def test_vless_ws_and_reality():
    node = parse_uri(
        f"vless://{UUID}@example.com:443?type=ws&security=tls&sni=s.example.com&path=%2Fws&host=h.example.com&alpn=h2%2Chttp%2F1.1#test"
    )
    assert node["ws-opts"] == {"path": "/ws", "headers": {"Host": "h.example.com"}}
    assert node["servername"] == "s.example.com"
    assert node["alpn"] == ["h2", "http/1.1"]
    node = parse_uri(
        f"vless://{UUID}@example.com:443?security=reality&pbk=key&sid=abcd&fp=chrome&flow=xtls-rprx-vision"
    )
    assert node["reality-opts"] == {"public-key": "key", "short-id": "abcd"}
    assert node["flow"] == "xtls-rprx-vision"


def test_vless_grpc():
    node = parse_uri(
        f"vless://{UUID}@example.com:443?security=tls&type=grpc&serviceName=hello&mode=gun&allowInsecure=0"
    )
    assert node["grpc-opts"] == {"grpc-service-name": "hello"}
    assert node["skip-cert-verify"] is False


@pytest.mark.parametrize(
    "suffix",
    [
        "?unknown=secret",
        "?security=tls&type=xhttp",
        "?security=tls&type=grpc&mode=multi",
        "?security=reality",
        "?security=none&sni=example.com",
        "?type=tcp&path=/x",
        "?security=tls&allowInsecure=maybe",
        "?type=ws&type=grpc",
        "?encryption=auto",
    ],
)
def test_unsupported_vless_parameters_fail(suffix):
    with pytest.raises(DomainError):
        parse_uri(f"vless://{UUID}@example.com:443{suffix}")


def test_ss_plugin_never_silently_discarded():
    with pytest.raises(DomainError):
        parse_uri(f"ss://{b64('aes-128-gcm:secret')}@example.com:443?plugin=v2ray-plugin")


def test_plain_and_base64_subscriptions():
    text = (
        f"ss://{b64('aes-128-gcm:secret')}@example.com:443#ss\nvless://{UUID}@example.com:443#vless"
    )
    assert parse_subscription(text).nodes == parse_subscription(b64(text)).nodes


@pytest.mark.parametrize(
    "text",
    [
        "proxy-providers:\n  remote: {type: http, url: 'https://example.com/secret'}\nproxies: []",
        "proxies: []",
        "proxies: []\nproxies: []",
        "!!python/object/apply:os.system ['echo nope']",
        "hello",
        "a: &a [*a]",
        "time: 2026-10-20",
        "proxies: [{name: wrong}]",
    ],
)
def test_invalid_subscription(text):
    with pytest.raises(DomainError):
        parse_subscription(text)


def test_generic_yaml_preserves_protocol_fields():
    node = parse_subscription(
        "name: hy2\ntype: hysteria2\nserver: example.com\nport: 443\npassword: test\nobfs: salamander\nobfs-password: other",
        allow_single_node=True,
    ).nodes[0]
    assert node["obfs-password"] == "other"


def test_invalid_node_does_not_leak_secrets():
    with pytest.raises(DomainError) as result:
        validate_node(
            {
                "name": "test",
                "type": "vless",
                "server": "x",
                "port": 443,
                "uuid": "my-secret-invalid-uuid",
            }
        )
    assert "my-secret" not in str(result.value)
    with pytest.raises(DomainError):
        load_yaml("{1: value}")
