"""Strict, credential-safe input parsing; never include upstream text in errors."""

import base64
import binascii
import copy
import json
import math
import uuid
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl, unquote, urlsplit

import yaml

from .errors import DomainError

MAX_INPUT_BYTES = 10 * 1024 * 1024


class UniqueKeyLoader(yaml.SafeLoader):
    def construct_mapping(self, node, deep=False):
        self.flatten_mapping(node)
        result = {}
        for key_node, value_node in node.value:
            key = self.construct_object(key_node, deep=deep)
            if not isinstance(key, str) or key in result:
                raise DomainError("YAML 键必须是字符串，且不能重复")
            result[key] = self.construct_object(value_node, deep=deep)
        return result


def _check_tree(value: Any, depth: int = 0, budget: list[int] | None = None) -> None:
    if budget is None:
        budget = [200_000]
    budget[0] -= 1
    if budget[0] < 0 or depth > 40:
        raise DomainError("配置过于复杂或包含循环 YAML 引用")
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise DomainError("配置键必须是字符串")
            _check_tree(item, depth + 1, budget)
    elif isinstance(value, list):
        for item in value:
            _check_tree(item, depth + 1, budget)
    elif value is not None and not isinstance(value, (str, bool, int, float)):
        raise DomainError("配置包含非 JSON 类型，请将日期等值写成带引号的字符串")
    elif isinstance(value, float) and not math.isfinite(value):
        raise DomainError("配置不能包含 NaN 或无穷大")


def load_yaml(text: str) -> Any:
    if len(text.encode("utf-8")) > MAX_INPUT_BYTES:
        raise DomainError("配置超过 10 MiB 上限")
    try:
        result = yaml.load(text, Loader=UniqueKeyLoader)
        _check_tree(result)
        json.dumps(result, allow_nan=False)
        return result
    except (yaml.YAMLError, ValueError, RecursionError, TypeError) as exc:
        raise DomainError("YAML 无效或包含不支持的数据类型") from exc


def validate_node(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise DomainError("每个节点必须是一个对象")
    _check_tree(value)
    for key in ("name", "type", "server"):
        if not isinstance(value.get(key), str) or not value[key].strip():
            raise DomainError(f"节点缺少有效的 {key}")
    if any(char in value["name"] for char in ("\n", "\r", ",")):
        raise DomainError("节点名称不能包含换行或逗号")
    port = value.get("port")
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise DomainError("节点 port 必须是 1–65535 的整数")
    if value["type"] == "ss":
        for key in ("cipher", "password"):
            if not isinstance(value.get(key), str) or not value[key]:
                raise DomainError(f"SS 节点缺少有效的 {key}")
    if value["type"] == "vless":
        try:
            uuid.UUID(value["uuid"])
        except (KeyError, ValueError, TypeError, AttributeError) as exc:
            raise DomainError("VLESS 节点必须提供有效的 UUID") from exc
    return copy.deepcopy(value)


def decode_base64(value: str) -> str:
    compact = "".join(value.split())
    try:
        raw = base64.b64decode(compact + "=" * (-len(compact) % 4), altchars=b"-_", validate=True)
        return raw.decode("utf-8-sig")
    except (ValueError, binascii.Error, UnicodeDecodeError) as exc:
        raise DomainError("Base64 内容无效") from exc


def _query(query: str, allowed: set[str]) -> dict[str, str]:
    result = {}
    for key, value in parse_qsl(query, keep_blank_values=True):
        if key not in allowed or key in result:
            raise DomainError("节点链接包含不支持或重复的参数，请改用完整节点 YAML")
        result[key] = value
    return result


def parse_ss(uri: str) -> dict[str, Any]:
    body = uri[len("ss://") :]
    authority_and_query, _, fragment = body.partition("#")
    authority, _, query = authority_and_query.partition("?")
    _query(query, set())
    legacy = "@" not in authority
    if legacy:
        authority = decode_base64(authority)
    try:
        # Split the decoded authority ourselves: passwords may contain /, ?, # or @.
        userinfo, host_port = authority.rsplit("@", 1)
        parts = urlsplit("ss://" + host_port)
        if parts.path not in ("", "/") or not parts.hostname or not parts.port:
            raise ValueError()
        encoded_userinfo = ":" not in userinfo
        if encoded_userinfo:
            userinfo = decode_base64(unquote(userinfo))
        cipher, password = userinfo.split(":", 1)
        if not legacy and not encoded_userinfo:
            cipher, password = unquote(cipher), unquote(password)
        result = {
            "name": unquote(fragment) or f"{parts.hostname}:{parts.port}",
            "type": "ss",
            "server": parts.hostname,
            "port": parts.port,
            "cipher": cipher,
            "password": password,
        }
        return validate_node(result)
    except (ValueError, IndexError) as exc:
        raise DomainError("SS 链接格式无效") from exc


def parse_vless(uri: str) -> dict[str, Any]:
    try:
        parts = urlsplit(uri)
        if not parts.hostname or not parts.port or parts.password or parts.path not in ("", "/"):
            raise ValueError()
        result = {
            "name": unquote(parts.fragment) or f"{parts.hostname}:{parts.port}",
            "type": "vless",
            "server": parts.hostname,
            "port": parts.port,
            "uuid": unquote(parts.username or ""),
        }
    except ValueError as exc:
        raise DomainError("VLESS 链接格式无效") from exc
    params = _query(
        parts.query,
        {
            "encryption",
            "security",
            "type",
            "sni",
            "servername",
            "fp",
            "pbk",
            "sid",
            "flow",
            "alpn",
            "host",
            "path",
            "serviceName",
            "mode",
            "headerType",
            "allowInsecure",
            "packetEncoding",
        },
    )
    if params.get("encryption", "none") != "none":
        raise DomainError("仅支持 encryption=none 的 VLESS 链接")
    network = params.get("type", "tcp")
    security = params.get("security", "none")
    if network not in ("tcp", "ws", "grpc") or security not in ("none", "tls", "reality"):
        raise DomainError("不支持该 VLESS 传输方式，请改用完整节点 YAML")
    if params.get("headerType", "none") != "none":
        raise DomainError("不支持 VLESS TCP 伪装参数，请改用完整节点 YAML")
    if "sni" in params and "servername" in params and params["sni"] != params["servername"]:
        raise DomainError("VLESS 链接的服务器名称参数冲突")
    if security == "none" and any(
        k in params
        for k in ("sni", "servername", "fp", "pbk", "sid", "alpn", "allowInsecure", "flow")
    ):
        raise DomainError("VLESS TLS 参数与 security=none 冲突")
    if security != "reality" and any(k in params for k in ("pbk", "sid")):
        raise DomainError("Reality 参数需要 security=reality")
    if "flow" in params:
        if params["flow"] not in ("", "xtls-rprx-vision") or network != "tcp":
            raise DomainError("不支持该 VLESS flow 与传输方式组合")
        if params["flow"]:
            result["flow"] = params["flow"]
    if security != "none":
        result["tls"] = True
        if "sni" in params or "servername" in params:
            result["servername"] = params.get("sni", params.get("servername"))
        if "fp" in params:
            result["client-fingerprint"] = params["fp"]
        if "alpn" in params:
            result["alpn"] = params["alpn"].split(",")
        if "allowInsecure" in params:
            if params["allowInsecure"] not in ("0", "1", "true", "false"):
                raise DomainError("allowInsecure 必须为 0、1、true 或 false")
            result["skip-cert-verify"] = params["allowInsecure"] in ("1", "true")
    if security == "reality":
        if not params.get("pbk"):
            raise DomainError("Reality 链接缺少公钥")
        result["reality-opts"] = {"public-key": params["pbk"], "short-id": params.get("sid", "")}
    if network != "ws" and any(k in params for k in ("path", "host")):
        raise DomainError("当前仅在 WebSocket 链接中支持 path/host 参数")
    if network != "grpc" and any(k in params for k in ("serviceName", "mode")):
        raise DomainError("serviceName/mode 参数仅适用于 gRPC")
    if network == "ws":
        result["network"] = "ws"
        opts: dict[str, Any] = {"path": params.get("path", "/")}
        if "host" in params:
            opts["headers"] = {"Host": params["host"]}
        result["ws-opts"] = opts
    elif network == "grpc":
        if params.get("mode", "gun") != "gun":
            raise DomainError("仅支持 gRPC gun 模式，请改用完整节点 YAML")
        result["network"] = "grpc"
        result["grpc-opts"] = {"grpc-service-name": params.get("serviceName", "")}
    if "packetEncoding" in params:
        if params["packetEncoding"] not in ("xudp", "packetaddr"):
            raise DomainError("不支持该 VLESS packetEncoding")
        result["packet-encoding"] = params["packetEncoding"]
    return validate_node(result)


def parse_uri(uri: str) -> dict[str, Any]:
    uri = uri.strip()
    if uri.startswith("ss://"):
        return parse_ss(uri)
    if uri.startswith("vless://"):
        return parse_vless(uri)
    raise DomainError("链接导入仅支持 ss:// 和 vless://，其他协议请使用节点 YAML")


@dataclass
class ParsedSubscription:
    nodes: list[dict[str, Any]]
    document: dict[str, Any] | None = None


def parse_subscription(text: str, *, allow_single_node: bool = False) -> ParsedSubscription:
    text = text.lstrip("\ufeff").strip()
    if not text or len(text.encode("utf-8")) > MAX_INPUT_BYTES:
        raise DomainError("订阅内容为空或超过 10 MiB 上限")
    if text.startswith(("ss://", "vless://")):
        return ParsedSubscription([parse_uri(line) for line in text.splitlines() if line.strip()])
    loaded = load_yaml(text)
    if isinstance(loaded, str):
        decoded = decode_base64(text).strip()
        if not decoded.startswith(("ss://", "vless://")):
            raise DomainError("Base64 订阅只支持 SS/VLESS 链接列表")
        return ParsedSubscription(
            [parse_uri(line) for line in decoded.splitlines() if line.strip()]
        )
    if isinstance(loaded, dict):
        if loaded.get("proxy-providers"):
            raise DomainError("首版不支持远程 proxy-providers，请提供直接包含 proxies 的订阅")
        if allow_single_node and "type" in loaded and "proxies" not in loaded:
            return ParsedSubscription([validate_node(loaded)])
        nodes = loaded.get("proxies")
        document = loaded if "proxy-groups" in loaded or "rules" in loaded else None
    elif allow_single_node and isinstance(loaded, list):
        nodes, document = loaded, None
    else:
        raise DomainError("订阅必须是包含 proxies 的 YAML 或 SS/VLESS 链接列表")
    if not isinstance(nodes, list) or not nodes:
        raise DomainError("订阅 proxies 必须是非空节点列表")
    return ParsedSubscription([validate_node(node) for node in nodes], document)
