import copy
import shutil
import subprocess

import pytest
import yaml
from conftest import SS_NODE, VLESS_NODE

from clash_config_center.compiler import SourceContent, compile_export
from clash_config_center.errors import DomainError
from clash_config_center.schemas import DEFAULT_TEMPLATE, ExportConfig


def sources():
    base = {
        "mixed-port": 7890,
        "proxies": [SS_NODE],
        "proxy-groups": [{"name": "主选择", "type": "select", "proxies": ["香港01", "DIRECT"]}],
        "dns": {"enable": True, "nameserver": ["https://dns.alidns.com/dns-query"]},
        "rules": [
            "DOMAIN,example.com,香港01",
            "AND,((NETWORK,TCP),(DST-PORT,443)),主选择",
            "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
            "MATCH,主选择",
        ],
    }
    return [
        SourceContent("a", "机场", "url", [SS_NODE], base, "v1"),
        SourceContent("b", "机场", "manual", [VLESS_NODE, VLESS_NODE], None, "v2"),
    ]


@pytest.mark.parametrize("mode", ["template", "inherit"])
@pytest.mark.parametrize("injection", ["grouped", "direct"])
def test_modes_and_injection(mode, injection):
    config = ExportConfig(
        name="test",
        source_ids=["a", "b"],
        mode=mode,
        injection=injection,
        base_source_id="a" if mode == "inherit" else None,
        target_groups=["主选择"] if mode == "inherit" else ["代理选择"],
    )
    result = compile_export(config, sources())
    doc = yaml.safe_load(result.yaml_content)
    assert len(doc["proxies"]) == 3  # no cross-source or within-source deduplication
    assert len({n["name"] for n in doc["proxies"]}) == 3
    assert result.yaml_content == compile_export(config, sources()).yaml_content
    group = doc["proxy-groups"][0]
    if mode == "inherit":
        assert doc["dns"] == sources()[0].document["dns"]
        assert doc["rules"][0] == "DOMAIN,example.com,[机场] 香港01"
        assert group["proxies"][0] == "[机场] 香港01"
        assert doc["rules"][2].endswith("DIRECT,no-resolve")
    if injection == "grouped":
        assert any(value.startswith("来源 ·") for value in group["proxies"])
    else:
        assert any(value.endswith("#3") for value in group["proxies"])


@pytest.mark.parametrize(
    "change",
    [
        {"rules": ["MATCH,missing"]},
        {"proxy-groups": [{"name": "代理选择", "type": "select", "proxies": ["代理选择"]}]},
        {"proxy-groups": [{"name": "代理选择", "type": "select", "proxies": ["missing"]}]},
        {"proxies": []},
        {"proxy-providers": {}},
    ],
)
def test_invalid_templates(change):
    doc = yaml.safe_load(DEFAULT_TEMPLATE)
    doc.update(change)
    with pytest.raises(DomainError):
        compile_export(
            ExportConfig(name="x", source_ids=["a", "b"], template_yaml=yaml.safe_dump(doc)),
            sources(),
        )


def test_multiple_targets_and_dialer_references():
    current = sources()
    first = copy.deepcopy(SS_NODE)
    first["name"] = "first"
    second = {**SS_NODE, "name": "second", "dialer-proxy": "first"}
    current[1].nodes = [first, second]
    doc = yaml.safe_load(DEFAULT_TEMPLATE)
    doc["proxy-groups"].append({"name": "备用", "type": "select", "proxies": ["DIRECT"]})
    config = ExportConfig(
        name="x",
        source_ids=["a", "b"],
        target_groups=["代理选择", "备用"],
        template_yaml=yaml.safe_dump(doc),
    )
    result = yaml.safe_load(compile_export(config, current).yaml_content)
    assert result["proxies"][-1]["dialer-proxy"] == result["proxies"][-2]["name"]
    assert result["proxy-groups"][0]["proxies"] == result["proxy-groups"][1]["proxies"]


def test_subrules_rewrite_and_cycle_validation():
    current = sources()
    current[0].document["rules"] = ["SUB-RULE,(NETWORK,TCP),tcp", "MATCH,主选择"]
    current[0].document["sub-rules"] = {"tcp": ["MATCH,香港01"]}
    config = ExportConfig(
        name="x",
        source_ids=["a", "b"],
        mode="inherit",
        base_source_id="a",
        target_groups=["主选择"],
    )
    result = yaml.safe_load(compile_export(config, current).yaml_content)
    assert result["sub-rules"]["tcp"] == ["MATCH,[机场] 香港01"]
    current[0].document["sub-rules"]["tcp"] = ["SUB-RULE,(NETWORK,TCP),tcp"]
    with pytest.raises(DomainError):
        compile_export(config, current)


def test_inherited_automatic_groups_keep_original_membership_and_anchors():
    current = sources()
    current[0].nodes = [SS_NODE, {**SS_NODE, "name": "日本01"}]
    current[0].document["proxies"] = current[0].nodes
    current[0].document["proxy-groups"].extend(
        [
            {
                "name": "香港自动",
                "type": "url-test",
                "include-all-proxies": True,
                "filter": "^香港",
            },
            {"name": "排除香港", "type": "select", "include-all": True, "exclude-filter": "^香港"},
            {
                "name": "无匹配",
                "type": "select",
                "include-all": True,
                "filter": "^不存在",
                "empty-fallback": "香港01",
            },
        ]
    )
    config = ExportConfig(
        name="x",
        source_ids=["a", "b"],
        mode="inherit",
        base_source_id="a",
        target_groups=["主选择"],
    )
    result = yaml.safe_load(compile_export(config, current).yaml_content)
    groups = {group["name"]: group for group in result["proxy-groups"]}
    assert groups["香港自动"]["proxies"] == ["[机场] 香港01"]
    assert groups["排除香港"]["proxies"] == ["[机场] 日本01"]
    assert groups["无匹配"]["empty-fallback"] == "[机场] 香港01"
    assert "include-all-proxies" not in groups["香港自动"]
    assert "exclude-filter" not in groups["排除香港"]


def test_inherited_dns_and_rule_provider_node_references():
    current = sources()
    current[0].document["dns"]["nameserver"] = [
        "https://dns.example.com/dns-query#香港01&ecs=1.1.1.1/24"
    ]
    current[0].document["rule-providers"] = {
        "remote": {
            "type": "http",
            "url": "https://rules.example.com/a.yaml",
            "behavior": "domain",
            "proxy": "香港01",
        }
    }
    config = ExportConfig(
        name="x",
        source_ids=["a", "b"],
        mode="inherit",
        base_source_id="a",
        target_groups=["主选择"],
    )
    result = yaml.safe_load(compile_export(config, current).yaml_content)
    assert result["dns"]["nameserver"][0].endswith("#[机场] 香港01&ecs=1.1.1.1/24")
    assert result["rule-providers"]["remote"]["proxy"] == "[机场] 香港01"


@pytest.mark.parametrize(
    "change", [{"type": []}, {"empty-fallback": []}, {"include-all": "false"}, {"proxies": [123]}]
)
def test_malformed_groups_report_validation_error(change):
    document = yaml.safe_load(DEFAULT_TEMPLATE)
    document["proxy-groups"][0].update(change)
    config = ExportConfig(name="x", source_ids=["a", "b"], template_yaml=yaml.safe_dump(document))
    with pytest.raises(DomainError):
        compile_export(config, sources())


@pytest.mark.skipif(
    shutil.which("mihomo") is None, reason="本机未安装 Mihomo，跳过实际内核配置校验"
)
def test_mihomo_validates_representative_configs(tmp_path):
    for mode in ("template", "inherit"):
        for injection in ("grouped", "direct"):
            config = ExportConfig(
                name="test",
                source_ids=["a", "b"],
                mode=mode,
                injection=injection,
                base_source_id="a" if mode == "inherit" else None,
                target_groups=["主选择"] if mode == "inherit" else ["代理选择"],
            )
            path = tmp_path / f"{mode}-{injection}.yaml"
            path.write_text(compile_export(config, sources()).yaml_content, encoding="utf-8")
            result = subprocess.run(
                [shutil.which("mihomo"), "-t", "-d", str(tmp_path), "-f", str(path)],
                capture_output=True,
                text=True,
                timeout=30,
            )
            assert result.returncode == 0, result.stdout + result.stderr
