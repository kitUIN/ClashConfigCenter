# ClashConfigCenter 前端

React 19 + TypeScript + Vite 实现的 Vercel/Geist 风格管理界面，覆盖后端 `/api/v1` 全部管理接口：

- **登录**：使用管理 Token（`GET /api/v1/auth/check` 校验），可选择记住在本浏览器；任何接口返回 401 时自动退出。
- **概览**：来源/节点/出口统计，集中列出出错或使用旧快照的来源与出口。
- **来源**：URL 订阅与自定义来源的创建、编辑、删除、立即刷新；状态为 `pending` 时自动轮询。
- **节点**：查看快照节点；URL 和自定义来源均可按原名称忽略/恢复节点，来源表单支持每行一个名称批量设置，刷新后继续生效；自定义来源支持分享链接 / YAML / 表单（SS、VLESS）录入、整体替换、删除、上下排序与批量导入。
- **订阅出口**：模板/继承模式、按来源分组/直接注入、节点名称来源前缀开关（默认开启）、目标策略组（下拉选择或自定义输入）、来源排序；保存前可实时预览编译 YAML；详情页及创建/更换 Token 后的弹窗均支持 URL 复制、二维码、Clash 直接导入三种模式，Token 可随时复制；启用/禁用、重建、删除。
- 浅色/深色主题、加载骨架、空状态、Toast 与错误详情（含 422 字段校验）。

## 开发

先按 [后端说明](../backend/README.md) 启动服务（默认 `http://127.0.0.1:8000`），然后：

```powershell
cd frontend
npm install
npm run dev
```

打开 <http://localhost:5173>。开发服务器把 `/api`、`/sub`、`/health`、`/docs` 代理到后端，因此无需配置 CORS。后端不在默认地址时：

```powershell
$env:CCC_BACKEND_URL = 'http://127.0.0.1:8001'; npm run dev
```

## 构建与部署

```powershell
npm run typecheck
npm run build      # 输出到 dist/
npm run preview    # 以 4173 端口预览构建结果，同样代理到后端
```

`dist/` 是纯静态文件，部署时任选其一：

1. **同源反向代理（推荐）**：由 Nginx/Caddy 等托管 `dist/`，并将 `/api`、`/sub`、`/health` 转发到后端；其余路径回退到 `index.html`。
2. **跨源**：构建时设置 `VITE_API_BASE=https://后端地址`，并在后端设置 `CCC_CORS_ORIGINS='["https://前端地址"]'`。

### Nginx 反向代理

通过 `clash.kituin.fun` 代理访问 Vite 开发服务或预览服务时，该域名已加入两者的 `allowedHosts`。使用其他域名时，在 `frontend/.env.local` 中设置 `CCC_ALLOWED_HOSTS=example.com,another.example.com`（只填域名，不含协议和端口），然后重启 Vite。可参考 `.env.example`。

在现有 Nginx HTTPS `server` 中配置以下转发；预览服务将端口改为 `4173`：

```nginx
location / {
    proxy_pass http://127.0.0.1:5173;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

订阅出口返回的 `subscription_url` 由后端生成。在 `backend/.env` 中设置实际对外地址，并重启后端：

```dotenv
CCC_PUBLIC_BASE_URL=https://clash.kituin.fun
```

此配置优先于代理传入的请求地址，适用于创建出口、查看现有出口凭据和更换 Token。配置后重新打开出口详情即可获取正确链接，无需重建出口或更换 Token。若终端或服务已设置同名环境变量，需同步修改，因为环境变量优先于 `.env`。

未设置 `CCC_PUBLIC_BASE_URL` 时，后端根据请求的 Host 和协议生成地址：Nginx 需要保留外部 `Host` 并传递 `X-Forwarded-Proto`；仅设置 `X-Forwarded-Host` 不会替换后端的 Host。默认只信任本机代理的协议头；跨主机或容器部署建议直接配置固定对外地址。由 Nginx 托管 `dist/` 时，也应将这些 Host/转发头用于后端代理路径。

二维码在浏览器本地生成，内容为完整订阅 URL；扫码设备必须能够访问该地址（跨设备使用时不能填 `localhost` 或 `127.0.0.1`）。Clash 直接导入使用 `clash://install-config?url=...&name=...`，携带订阅 URL 和出口名称，需要本机安装支持该协议的客户端；浏览器未能唤起时可复制 URL 手动添加。

## 目录

| 路径 | 说明 |
|---|---|
| `src/api/` | 接口类型与请求封装（Bearer 认证、错误格式化） |
| `src/components/` | 设计系统组件、布局、来源/节点/凭据弹窗 |
| `src/pages/` | 概览、来源、来源详情、出口列表、出口详情、出口编辑 |
| `src/styles.css` | 设计令牌与全部样式（含深色主题） |
