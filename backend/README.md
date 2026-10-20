# ClashConfigCenter 后端

Python 3.10+、FastAPI、Pydantic 2、SQLite、SQLAlchemy 2、Alembic。使用 HTTPX 拉取上游、PyYAML 解析与生成配置；`regex` 用于在继承模式下固定上游自动分组的节点范围。

## 本地启动

在本目录执行：

```powershell
uv sync --locked --dev
uv run clash-config-center serve
```

默认使用本机 Python 3.10；`.python-version` 指定该版本。没有可用的 Python 3.10 时，可先执行 `uv python install 3.10`。仅运行服务时可使用 `uv sync --locked --no-dev`。

默认地址为 <http://127.0.0.1:8000>。首次启动自动执行数据库迁移并生成管理 Token，终端只显示一次。后续启动沿用数据库中的认证摘要。Token 不写入配置文件，也不能从查询接口恢复。

```powershell
# 可选：只初始化数据库，不启动 HTTP 服务
uv run clash-config-center init

# 忘记 Token 时，在有数据目录访问权的本机执行；运行中的服务也立即识别新值
uv run clash-config-center admin-token reset

# 指定其他数据目录和监听端口
uv run clash-config-center --data-dir 'D:\ClashData' serve --host 127.0.0.1 --port 8001
```

启动命令固定使用一个 Uvicorn worker。不要启动多个进程共享同一数据库，也不要使用多 worker 启动方式，以免重复运行定时任务。

运行时文档：

- Swagger UI：<http://127.0.0.1:8000/docs>
- ReDoc：<http://127.0.0.1:8000/redoc>
- OpenAPI JSON：<http://127.0.0.1:8000/openapi.json>
- 运行检查：<http://127.0.0.1:8000/health>

## 环境配置

可复制 `.env.example` 为 `.env`，或设置 `CCC_` 前缀的环境变量。环境变量优先于 `.env`。相对数据目录按 `backend/` 解析，不依赖启动终端的位置。

| 变量 | 默认值 | 含义 |
|---|---|---|
| `CCC_HOST` | `127.0.0.1` | 监听地址，需要局域网访问时设为 `0.0.0.0` |
| `CCC_PORT` | `8000` | HTTP 端口 |
| `CCC_DATA_DIR` | `backend/data` | SQLite 数据目录 |
| `CCC_CORS_ORIGINS` | `[]` | 允许的前端 Origin，JSON 数组，例如 `["http://localhost:5173"]` |
| `CCC_PUBLIC_BASE_URL` | 请求自身的 Origin | 创建出口时返回链接使用的对外根地址 |
| `CCC_FETCH_TIMEOUT_SECONDS` | `30` | HTTP 连接及读取超时，单位秒 |
| `CCC_FETCH_MAX_BYTES` | `10485760` | 上游解压后响应大小上限；解析器另设 10 MiB 上限 |
| `CCC_SCHEDULER_INTERVAL_SECONDS` | `60` | 检查到期来源的间隔 |
| `CCC_SCHEDULER_ENABLED` | `true` | 是否启用后台自动刷新 |

SQLite 使用 WAL 和外键约束。来源、节点、凭据摘要及最近成功结果均存入 `config-center.sqlite3`。迁移文件位于 Python 包中，启动时执行 `upgrade head`。备份时先停服务，再复制完整数据目录；节点密码和上游 URL 本身属于配置数据，会保存在数据库中。

CLI 禁用包含查询串的 HTTP 访问日志；上游网络错误仅记录错误类别，不记录订阅 URL、请求体或节点密码。管理 Token 的首次显示与显式重置显示是例外。

## 认证和接口约定

所有 `/api/v1` 管理接口使用：

```http
Authorization: Bearer <管理Token>
Content-Type: application/json
```

不需要调用登录接口来换取会话。`GET /api/v1/auth/check` 成功返回 `{"authenticated": true}`。认证失败返回 `401`。节点配置和上游 URL 仅对管理接口暴露。

创建资源返回 `201`，删除成功返回 `204`。一般错误返回 `{"detail": "说明"}`；请求字段验证错误返回 `detail` 数组，不回显请求中的密码或 Token。无效配置为 `422`，资源不存在为 `404`，删除仍被出口引用的来源等操作冲突为 `409`。

### 来源与节点

| 方法与路径 | 功能 |
|---|---|
| `GET /api/v1/sources` | 来源列表 |
| `POST /api/v1/sources` | 创建 URL 或自定义来源 |
| `GET/PATCH/DELETE /api/v1/sources/{id}` | 来源详情、更新、删除 |
| `POST /api/v1/sources/{id}/refresh` | 刷新 URL 来源 |
| `GET /api/v1/sources/{id}/nodes` | 当前节点列表 |
| `GET /api/v1/sources/{id}/groups` | 来源最新快照中的策略组名称（继承模式选择目标组用） |
| `POST /api/v1/sources/{id}/nodes` | 新增一个自定义节点 |
| `PATCH/DELETE /api/v1/sources/{id}/nodes/{node_id}` | 整体替换或删除自定义节点 |
| `POST /api/v1/sources/{id}/nodes/import` | 追加批量导入 |
| `PUT /api/v1/sources/{id}/nodes/order` | 调整自定义节点顺序 |

URL 来源创建请求：

```json
{
  "name": "机场A",
  "kind": "url",
  "url": "https://example.com/sub?token=your-upstream-token",
  "refresh_interval_seconds": 3600
}
```

创建自定义来源使用 `{"name":"自建节点","kind":"manual"}`。来源类型创建后不可修改。URL 来源创建后为 `pending`，下次定时检查会拉取，也可立即调用 `refresh`。周期可设为 60–604800 秒。

来源响应包含 `id`、配置字段、`node_count`、`has_snapshot`、`status`、`last_attempt_at`、`last_success_at`、`next_refresh_at`、`last_error`、`using_stale_snapshot`。时间为带 UTC 时区的 ISO 8601 字符串。`status` 为 `pending`、`ready` 或 `error`。

URL 和自定义来源均支持 `ignored_node_names`，默认 `[]`。创建或 PATCH 来源时传入原节点名称列表，例如 `{"ignored_node_names":["剩余流量","香港01"]}`，按完整名称精确匹配，同名节点全部忽略；传 `[]` 恢复全部节点。设置对所有引用该来源的出口生效，修改后自动重建，订阅刷新后仍然保留。节点列表和原始快照保留全部节点，`node_count` 为总数，`ignored_node_count` 为当前快照中被忽略的数量。

继承模式会从策略组中移除被忽略节点，过滤后为空的组使用 `empty-fallback`（默认 `COMPATIBLE`）；若 `empty-fallback` 本身被忽略，则改用 `COMPATIBLE`。规则、子规则、DNS、规则源或其他节点的拨号链仍直接依赖已忽略节点时，编译会报错，请调整引用或恢复该节点。过滤后整个出口没有节点也会报错。与其他来源变更一致，重建失败时保留最近成功的订阅，因此旧订阅可能仍含已忽略节点；可通过出口 `last_error` 和 `using_stale_snapshot` 查看状态。

新增/替换节点请求必须在 `config`、`yaml`、`uri` 三项中选择一项：

```json
{
  "config": {
    "name": "自建SS",
    "type": "ss",
    "server": "ss.example.com",
    "port": 443,
    "cipher": "aes-128-gcm",
    "password": "replace-me"
  }
}
```

```json
{
  "config": {
    "name": "自建VLESS",
    "type": "vless",
    "server": "vless.example.com",
    "port": 443,
    "uuid": "12345678-1234-1234-1234-123456789abc",
    "tls": true,
    "servername": "vless.example.com",
    "network": "ws",
    "ws-opts": {"path": "/ws"}
  }
}
```

`uri` 接收一个 `ss://` 或 `vless://` 链接；`yaml` 接收单个节点对象，例如：

```json
{"yaml":"name: 自建Trojan\ntype: trojan\nserver: example.com\nport: 443\npassword: replace-me\nsni: example.com\n"}
```

导入使用 `{"content":"..."}`，可传多个逐行 SS/VLESS 链接、其 Base64 编码、`proxies` YAML、节点 YAML 列表或单节点 YAML。导入先验证整个批次，任意一项错误都不写入。新增、替换、导入和排序成功后返回该来源的完整节点列表：`[{"id":"...","position":0,"config":{...}}]`。URL 来源节点只读，其 `id` 为 `null`。

排序请求：`{"node_ids":["第二个节点ID","第一个节点ID"]}`，必须包含当前所有节点且不能重复。节点 `PATCH` 是替换整个节点配置，不是按节点内部字段合并。

支持的上游格式为完整 Mihomo YAML、`proxies` 节点 YAML、SS/VLESS 明文或 Base64 链接列表。远程 `proxy-providers` 暂不支持。SS 插件参数以及暂未实现的 VLESS 链接参数会明确报错，请改用完整节点 YAML。VLESS 链接支持 TCP、WebSocket、gRPC，以及 TLS/Reality 常用参数。其他节点协议保留通用 YAML 字段；服务执行结构校验，协议完整兼容性以使用的 Mihomo 内核为准。

### 出口和预览

| 方法与路径 | 功能 |
|---|---|
| `GET/POST /api/v1/exports` | 出口列表、创建 |
| `GET/PATCH/DELETE /api/v1/exports/{id}` | 出口详情、更新、删除 |
| `POST /api/v1/exports/preview` | 根据提交的完整出口配置预览，不写入 |
| `POST /api/v1/exports/{id}/rebuild` | 使用现有来源快照重建，不拉取上游 |
| `PUT /api/v1/exports/{id}/token` | 更换订阅 Token |
| `GET /api/v1/exports/{id}/credentials` | 获取当前订阅 Token 与完整订阅链接（可重复获取） |

默认模板模式：

```json
{
  "name": "日常订阅",
  "source_ids": ["来源A的ID", "来源B的ID", "自定义来源ID"],
  "mode": "template",
  "injection": "grouped",
  "prefix_source_name": true,
  "target_groups": ["代理选择"]
}
```

省略 `template_yaml` 时使用内置模板：`mixed-port: 7890`、`allow-lan: false`、`mode: rule`、一个含 `DIRECT` 的“代理选择”组和 `MATCH,代理选择` 规则。模板可通过 `template_yaml` 完整替换，允许配置规则、DNS、监听等，禁止自行填写 `proxies` 或 `proxy-providers`。

继承模式：

```json
{
  "name": "保留机场A分流",
  "source_ids": ["来源A的ID", "来源B的ID"],
  "mode": "inherit",
  "base_source_id": "来源A的ID",
  "injection": "direct",
  "target_groups": ["机场A配置中的某个策略组"]
}
```

`base_source_id` 必须是所选 URL 来源之一，且它的快照具有完整策略组和规则。继承模式不传 `template_yaml`。`injection` 可选 `grouped`（按来源生成选择组）或 `direct`（逐个追加节点）。允许多个目标组，目标组必须已存在。

`source_ids` 数组顺序决定输出顺序。`prefix_source_name` 控制节点名称的来源前缀，默认 `true`，节点按 `[来源名称] 原节点名` 命名；设为 `false` 则使用原节点名。两种设置下，冲突名称均依次追加 ` #2`、` #3`，默认不去重。此开关支持创建、PATCH 和预览，不改变「来源 · 名称」策略组的名称。已有数据库启动时自动迁移，旧出口保持开启前缀。基础配置中的节点引用会同步调整。继承模式会将 `include-all`/`include-all-proxies` 及名称筛选固定为基础来源当前未忽略的节点列表，再注入其他来源，避免前缀改变筛选结果或无意扩大其他上游分组。不能转换或执行超时的正则表达式会明确报错。当前支持 `select`、`url-test`、`fallback`、`load-balance` 策略组。

保存前必须通过编译和引用校验。预览与创建使用相同的出口配置字段，但预览不接受 `token`，返回 `yaml`、`digest`、`node_count`、`group_count`。修改出口采用部分更新；切换 `mode` 时自动清除旧模式的互斥设置，但需要同时填写正确的新基础来源或目标组。

创建出口时可额外传 `token`；省略时自动生成。创建成功返回出口详情及 `token`、`subscription_url`。更换 Token 传 `{"token":"指定值"}`，或 `{}` 自动生成，返回新的凭据。出口列表和详情接口不返回 Token；需要时调用 `GET /api/v1/exports/{id}/credentials` 重新获取（可重复调用）。订阅 Token 以明文保存在数据库中供管理端查看，订阅校验仍使用哈希比对；升级前创建的出口没有保存明文，该接口返回 409，更换一次 Token 即可。

出口详情还包含 `last_attempt_at`、`last_success_at`、`last_error`、`source_errors`、`using_stale_snapshot` 和 `has_snapshot`。`status` 为 `disabled`、`pending`、`ready`、`stale` 或 `error`。前端应同时展示出口错误和来源错误，区分编译失败与仍使用上游旧快照。

### 客户端拉取

```http
GET /sub/{export_id}?token=<出口Token>
```

返回完整 UTF-8 YAML，提供 `ETag`；客户端发送匹配的 `If-None-Match` 时返回 `304`。先验证 Token 和启用状态，再处理条件请求。无有效结果为 `503`；出口不存在、已禁用或 Token 错误统一返回 `404`。更换 Token、禁用和删除出口立即生效。

后台定时刷新与手动刷新复用同一流程，同一来源串行拉取，最多同时拉取四个不同来源。上游或解析失败保留来源的最近成功快照；重新编译失败保留出口的最近成功结果。更新成功后在数据库事务中原子替换结果，客户端不等待上游。

`refresh` 和 `rebuild` 请求完成时返回 `200` 及当前状态，**不代表拉取或编译成功**，应检查 `status`、`last_error`。修改 URL 后会保留原快照并标记为旧数据；正在进行的旧 URL 请求不能覆盖新配置。节点修改若使某个出口无法编译，该出口也会保留旧结果并标记错误；需要立即停止提供旧结果时禁用该出口。

## 完整调用演示

先启动服务，在另一个终端执行：

```powershell
# 脚本会提示输入管理 Token，输入不回显
uv run python examples/api_workflow.py --source-a 'https://example.com/sub-a' --source-b 'https://example.com/sub-b'
```

脚本创建两个 URL 来源、拉取快照、创建一个自定义 SS 来源、预览并创建出口，最后通过真正的订阅接口获取 YAML。示例自定义 SS 使用占位域名和密码，可用 `--ss-server`、`--ss-password` 和 `--ss-port` 替换。配置需要真实可用节点才能建立代理连接。

也可用 PowerShell 单独检查认证：

```powershell
$adminToken = Read-Host '管理 Token'
$headers = @{ Authorization = "Bearer $adminToken" }
Invoke-RestMethod 'http://127.0.0.1:8000/api/v1/auth/check' -Headers $headers
```

## 开发与验证

```powershell
uv sync --locked --dev
uv run ruff check .
uv run ruff format --check .
uv run pytest -q
```

测试使用临时数据库及模拟上游，不读取生产订阅。包含 SS/VLESS 解析、整合引用、来源及节点 CRUD、Token 隔离和失效、定时调度、并发刷新、故障回退、SQLite 重启恢复，以及独立 CLI 进程上的真实 HTTP 流程。临时服务在测试结束后关闭。

若 PATH 中存在 `mihomo`，测试会对四种模式组合调用 `mihomo -t`；否则该项明确跳过。基础结构校验和自动化测试不替代具体版本内核校验，也不验证示例节点的网络连通性。

目录职责：`app.py` 提供 API 和生命周期；`service.py` 处理事务、调度及发布；`parsing.py` 和 `compiler.py` 提供解析与编译；`models.py`、`db.py`、`migrations/` 管理持久化。未提供 Docker 文件或前端实现。
