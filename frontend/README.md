# ClashConfigCenter 前端

React 19 + TypeScript + Vite 实现的 Vercel/Geist 风格管理界面，覆盖后端 `/api/v1` 全部管理接口：

- **登录**：使用管理 Token（`GET /api/v1/auth/check` 校验），可选择记住在本浏览器；任何接口返回 401 时自动退出。
- **概览**：来源/节点/出口统计，集中列出出错或使用旧快照的来源与出口。
- **来源**：URL 订阅与自定义来源的创建、编辑、删除、立即刷新；状态为 `pending` 时自动轮询。
- **节点**：查看快照节点；URL 和自定义来源均可按原名称忽略/恢复节点，来源表单支持每行一个名称批量设置，刷新后继续生效；自定义来源支持分享链接 / YAML / 表单（SS、VLESS）录入、整体替换、删除、上下排序与批量导入。
- **订阅出口**：模板/继承模式、按来源分组/直接注入、节点名称来源前缀开关（默认开启）、目标策略组（下拉选择或自定义输入）、来源排序；保存前可实时预览编译 YAML；订阅链接与 Token 可在详情页随时复制；启用/禁用、重建、删除。
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

订阅出口返回的 `subscription_url` 由后端生成；经代理访问时建议设置后端 `CCC_PUBLIC_BASE_URL`，让客户端拿到正确的对外地址。

## 目录

| 路径 | 说明 |
|---|---|
| `src/api/` | 接口类型与请求封装（Bearer 认证、错误格式化） |
| `src/components/` | 设计系统组件、布局、来源/节点/凭据弹窗 |
| `src/pages/` | 概览、来源、来源详情、出口列表、出口详情、出口编辑 |
| `src/styles.css` | 设计令牌与全部样式（含深色主题） |
