# ClashConfigCenter

本地 Mihomo 订阅配置中心：管理 URL 订阅和自定义节点，生成具有独立访问 Token 的聚合订阅。

后端为 Python / FastAPI / SQLite，前端为 React + Vite 管理界面（Vercel 风格）。

在 Windows PowerShell 中启动：

```powershell
cd backend
uv sync --locked --dev
uv run clash-config-center serve
```

首次启动在终端显示管理 Token。打开 <http://127.0.0.1:8000/docs>，点击 **Authorize** 并输入 Token，即可调用管理接口。

管理界面：在另一个终端执行 `cd frontend; npm install; npm run dev`，打开 <http://localhost:5173> 并输入管理 Token。

- [前端开发与部署](frontend/README.md)
- [后端配置与接口示例](backend/README.md)
- [完整演示脚本](backend/examples/api_workflow.py)
- [依赖与开发配置](backend/pyproject.toml)

客户端使用创建出口时返回的 `subscription_url`。管理 Token 和出口 Token 相互独立。
