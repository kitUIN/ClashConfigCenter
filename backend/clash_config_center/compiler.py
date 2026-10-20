"""Pure compilation: a candidate configuration is never published on failure."""

from __future__ import annotations

import copy
import hashlib
from dataclasses import dataclass
from graphlib import CycleError, TopologicalSorter
from typing import Any

import regex
import yaml

from .errors import DomainError
from .parsing import load_yaml
from .schemas import ExportConfig

BUILTINS = {"DIRECT", "REJECT", "REJECT-DROP", "PASS", "COMPATIBLE", "GLOBAL"}
EXPLICIT_GROUP_TYPES = {"select", "url-test", "fallback", "load-balance"}


def _patterns(value: Any) -> list:
    if not isinstance(value, str):
        raise DomainError("策略组 filter/exclude-filter 必须是字符串")
    try:
        return [regex.compile(part) for part in value.split("`")] if value else []
    except regex.error as exc:
        raise DomainError("继承策略组的正则表达式无法转换，请调整配置或使用自定义模板") from exc


def _matches(pattern, name: str) -> bool:
    try:
        return pattern.search(name, timeout=0.05) is not None
    except TimeoutError as exc:
        raise DomainError("策略组正则表达式匹配超时") from exc


def _materialize_groups(groups: list[dict], nodes: list[dict]) -> None:
    """Freeze the base's automatic selection before namespacing and adding other sources.

    Otherwise include-all would unexpectedly pull in unrelated sources, and anchored
    filters would stop matching after a source prefix was added to node names.
    """
    for group in groups:
        refs = group.get("proxies", [])
        if not isinstance(refs, list) or not all(isinstance(ref, str) for ref in refs):
            raise DomainError("策略组 proxies 必须是字符串列表")
        refs = list(refs)
        automatic = group.get("include-all") or group.get("include-all-proxies")
        if automatic:
            filters = _patterns(group.get("filter", ""))
            for node in nodes:
                if not filters:
                    refs.append(node["name"])
                else:
                    refs.extend(
                        node["name"] for pattern in filters if _matches(pattern, node["name"])
                    )
        excludes = _patterns(group.get("exclude-filter", ""))
        if excludes:
            refs = [ref for ref in refs if not any(_matches(pattern, ref) for pattern in excludes)]
        if not refs and (automatic or excludes):
            refs = [group.get("empty-fallback", "COMPATIBLE")]
        group["proxies"] = refs
        for field in (
            "include-all",
            "include-all-proxies",
            "include-all-providers",
            "filter",
            "exclude-filter",
        ):
            group.pop(field, None)


@dataclass
class SourceContent:
    id: str
    name: str
    kind: str
    nodes: list[dict[str, Any]]
    document: dict[str, Any] | None
    version: str


@dataclass
class Compiled:
    yaml_content: str
    digest: str
    source_versions: dict[str, str]
    node_count: int
    group_count: int


def split_rule(rule: str) -> list[str]:
    """Split top-level commas, preserving AND/OR/NOT and SUB-RULE predicates."""
    result, start, depth = [], 0, 0
    for index, char in enumerate(rule):
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth < 0:
                raise DomainError("规则括号不匹配")
        elif char == "," and depth == 0:
            result.append(rule[start:index].strip())
            start = index + 1
    if depth:
        raise DomainError("规则括号不匹配")
    result.append(rule[start:].strip())
    if len(result) < 2 or not all(result):
        raise DomainError("分流规则格式无效")
    return result


def _rewrite_rules(document: dict, mapping: dict[str, str]) -> None:
    rules = document.get("rules")
    if not isinstance(rules, list) or not rules:
        raise DomainError("完整配置必须包含非空 rules 列表")
    sub_rules = document.get("sub-rules", {})
    if not isinstance(sub_rules, dict):
        raise DomainError("sub-rules 必须是对象")
    all_lists = [rules, *sub_rules.values()]
    for rule_list in all_lists:
        if not isinstance(rule_list, list):
            raise DomainError("规则必须是字符串列表")
        for index, rule in enumerate(rule_list):
            if not isinstance(rule, str):
                raise DomainError("规则必须是字符串")
            parts = split_rule(rule)
            target_index = -2 if parts[-1] == "no-resolve" else -1
            if len(parts) + target_index < 1:
                raise DomainError("分流规则缺少目标")
            if parts[0] == "MATCH":
                if len(parts) != 2:
                    raise DomainError("MATCH 规则必须只包含目标")
            elif len(parts) not in (3, 4) or (len(parts) == 4 and parts[-1] != "no-resolve"):
                raise DomainError("分流规则参数数量无效")
            if parts[0] != "SUB-RULE":
                parts[target_index] = mapping.get(parts[target_index], parts[target_index])
            rule_list[index] = ",".join(parts)


def _rewrite_other_references(document: dict, mapping: dict[str, str]) -> None:
    # DNS server URLs can name a proxy after '#', alongside options separated by '&'.
    def rewrite_dns(value):
        if isinstance(value, str) and "#" in value:
            server, fragment = value.split("#", 1)
            return server + "#" + "&".join(mapping.get(part, part) for part in fragment.split("&"))
        if isinstance(value, list):
            return [rewrite_dns(item) for item in value]
        if isinstance(value, dict):
            return {key: rewrite_dns(item) for key, item in value.items()}
        return value

    if "dns" in document:
        document["dns"] = rewrite_dns(document["dns"])
    providers = document.get("rule-providers", {})
    if isinstance(providers, dict):
        for provider in providers.values():
            if isinstance(provider, dict) and isinstance(provider.get("proxy"), str):
                provider["proxy"] = mapping.get(provider["proxy"], provider["proxy"])


def _validate_references(document: dict) -> None:
    groups = document["proxy-groups"]
    nodes = document["proxies"]
    groups_by_name = {group["name"]: group for group in groups}
    node_names = {node["name"] for node in nodes}
    names = set(groups_by_name) | node_names | BUILTINS
    graph: dict[str, set[str]] = {}
    for group in groups:
        refs = group.get("proxies", [])
        if not isinstance(refs, list) or not all(isinstance(ref, str) for ref in refs):
            raise DomainError("策略组 proxies 必须是字符串列表")
        if group.get("use"):
            raise DomainError("首版不支持策略组通过 use 引用 provider")
        if not refs and not (group.get("include-all") or group.get("include-all-proxies")):
            raise DomainError("策略组必须包含节点、其他组或 include-all-proxies")
        if any(ref not in names for ref in refs):
            raise DomainError("策略组引用了不存在的节点或策略组")
        dependencies = set(refs) - BUILTINS
        fallback = group.get("empty-fallback")
        if fallback is not None:
            if not isinstance(fallback, str) or fallback not in node_names | BUILTINS:
                raise DomainError("empty-fallback 必须引用一个节点或内置代理，不能引用策略组")
            dependencies |= {fallback} - BUILTINS
        if group.get("include-all") or group.get("include-all-proxies"):
            dependencies |= node_names
        graph[group["name"]] = dependencies
    for node in nodes:
        dialer = node.get("dialer-proxy")
        if dialer is not None and (not isinstance(dialer, str) or dialer not in names):
            raise DomainError("节点 dialer-proxy 引用了不存在的节点或策略组")
        graph[node["name"]] = {dialer} - BUILTINS if dialer else set()
    try:
        TopologicalSorter(graph).prepare()
    except CycleError as exc:
        raise DomainError("策略组或节点拨号链存在循环引用") from exc
    sub_rules = document.get("sub-rules", {})
    rule_providers = document.get("rule-providers", {})
    if not isinstance(rule_providers, dict):
        raise DomainError("rule-providers 必须是对象")
    sub_graph: dict[str, set[str]] = {key: set() for key in sub_rules}
    for rule_name, rule_list in [(None, document["rules"]), *sub_rules.items()]:
        for rule in rule_list:
            parts = split_rule(rule)
            target = parts[-2] if parts[-1] == "no-resolve" else parts[-1]
            if parts[0] == "SUB-RULE":
                if target not in sub_rules:
                    raise DomainError("SUB-RULE 引用了不存在的子规则")
                if rule_name is not None:
                    sub_graph[rule_name].add(target)
            elif target not in names:
                raise DomainError("分流规则引用了不存在的节点或策略组")
            if parts[0] == "RULE-SET" and (len(parts) < 3 or parts[1] not in rule_providers):
                raise DomainError("RULE-SET 引用了不存在的规则源")
    try:
        TopologicalSorter(sub_graph).prepare()
    except CycleError as exc:
        raise DomainError("子规则存在循环引用") from exc


def compile_export(config: ExportConfig, sources: list[SourceContent]) -> Compiled:
    if [source.id for source in sources] != config.source_ids:
        raise DomainError("来源快照缺失或顺序不一致")
    if config.mode == "template":
        document = load_yaml(config.template_yaml or "")
        if not isinstance(document, dict):
            raise DomainError("模板必须是 YAML 对象")
        if "proxies" in document or "proxy-providers" in document:
            raise DomainError("模板不能自行定义 proxies 或 proxy-providers")
        base = None
    else:
        base = next(source for source in sources if source.id == config.base_source_id)
        if base.kind != "url" or not base.document:
            raise DomainError("基础来源必须是提供完整配置的 URL 来源")
        document = copy.deepcopy(base.document)
    groups = document.get("proxy-groups")
    if not isinstance(groups, list) or not groups:
        raise DomainError("配置必须包含非空 proxy-groups 列表")
    reserved = set(BUILTINS)
    for group in groups:
        if not isinstance(group, dict) or not isinstance(group.get("name"), str):
            raise DomainError("策略组缺少名称")
        name = group["name"]
        if not name.strip() or any(c in name for c in (",", "\r", "\n")) or name in reserved:
            raise DomainError("策略组名称重复、无效或与内置名称冲突")
        if not isinstance(group.get("type"), str) or group["type"] not in EXPLICIT_GROUP_TYPES:
            raise DomainError("策略组 type 不支持，须为 select/url-test/fallback/load-balance")
        for flag in ("include-all", "include-all-proxies", "include-all-providers"):
            if flag in group and not isinstance(group[flag], bool):
                raise DomainError("策略组 include-all 系列字段必须是布尔值")
        fallback = group.get("empty-fallback")
        if fallback is not None and (not isinstance(fallback, str) or not fallback):
            raise DomainError("empty-fallback 必须是名称字符串")
        reserved.add(name)
    if base:
        _materialize_groups(groups, base.nodes)
    groups_by_name = {group["name"]: group for group in groups}
    if any(name not in groups_by_name for name in config.target_groups):
        raise DomainError("接入目标策略组不存在")

    def allocate(name: str) -> str:
        candidate, suffix = name, 2
        while candidate in reserved:
            candidate = f"{name} #{suffix}"
            suffix += 1
        reserved.add(candidate)
        return candidate

    all_nodes, added_refs = [], []
    base_mapping = {}
    for source in sources:
        current_nodes, mapping, duplicates = [], {}, set()
        for node in source.nodes:
            current = copy.deepcopy(node)
            original = current["name"]
            current["name"] = allocate(f"[{source.name}] {original}")
            if original in mapping:
                duplicates.add(original)
            else:
                mapping[original] = current["name"]
            current_nodes.append(current)
        if base and source.id == base.id:
            if duplicates or set(mapping) & (set(groups_by_name) | BUILTINS):
                raise DomainError("基础配置的节点名称重复或与策略组/内置名称冲突，无法确定引用")
            base_mapping = mapping
        for node in current_nodes:
            dialer = node.get("dialer-proxy")
            if dialer is not None and not isinstance(dialer, str):
                raise DomainError("dialer-proxy 必须是名称字符串")
            if dialer in duplicates:
                raise DomainError("dialer-proxy 引用的节点名称不唯一")
            if dialer in mapping:
                node["dialer-proxy"] = mapping[dialer]
        all_nodes.extend(current_nodes)
        if base and source.id == base.id:
            continue
        if config.injection == "grouped" and current_nodes:
            group_name = allocate(f"来源 · {source.name}")
            groups.append(
                {
                    "name": group_name,
                    "type": "select",
                    "proxies": [n["name"] for n in current_nodes],
                }
            )
            added_refs.append(group_name)
        else:
            added_refs.extend(n["name"] for n in current_nodes)
    if not all_nodes:
        raise DomainError("出口至少需要一个节点")
    if base_mapping:
        for group in groups_by_name.values():
            refs = group.get("proxies", [])
            if not isinstance(refs, list) or not all(isinstance(ref, str) for ref in refs):
                raise DomainError("策略组 proxies 必须是字符串列表")
            group["proxies"] = [base_mapping.get(ref, ref) for ref in refs]
            fallback = group.get("empty-fallback")
            if isinstance(fallback, str):
                group["empty-fallback"] = base_mapping.get(fallback, fallback)
    _rewrite_rules(document, base_mapping)
    if base_mapping:
        _rewrite_other_references(document, base_mapping)
    for name in config.target_groups:
        group = groups_by_name[name]
        refs = group.setdefault("proxies", [])
        if not isinstance(refs, list):
            raise DomainError("目标策略组 proxies 必须是列表")
        refs.extend(ref for ref in added_refs if ref not in refs)
    document["proxies"] = all_nodes
    document.pop("proxy-providers", None)
    if not base:
        _materialize_groups(groups, all_nodes)
    _validate_references(document)
    output = yaml.safe_dump(document, allow_unicode=True, sort_keys=False)
    return Compiled(
        yaml_content=output,
        digest=hashlib.sha256(output.encode("utf-8")).hexdigest(),
        source_versions={source.id: source.version for source in sources},
        node_count=len(all_nodes),
        group_count=len(groups),
    )
