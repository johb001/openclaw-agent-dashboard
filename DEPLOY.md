# DEPLOY

## 本地开发运行

### 安装依赖
```bash
npm install
```

### 启动后端
```bash
npm run dev:api
```

### 启动前端
```bash
npm run dev -- --host 0.0.0.0 --port 4173
```

---

## 端口说明

- 前端：`4173`
- 后端 API：`3456`

前端通过 Vite proxy 把 `/api/*` 转发到 `3456`，浏览器侧统一访问同域 `/api/...`。

---

## 线上部署建议

### 方案 1：先按当前 MVP 跑
- 前端跑在 Vite dev server
- 后端单独跑 Node 服务
- 用 Nginx/Caddy 做统一反向代理

### 方案 2：后续整理成正式生产版
- 构建前端静态文件
- 后端独立守护
- Nginx 统一接入 HTTPS
- 域名访问

---

## 常见问题

### 页面能打开，但数据为空
优先检查：
- 后端 API 是否启动
- `/api/health` 是否正常
- `openclaw status` 是否过慢

### 页面不是断连，但数据不更新
说明多半是：
- 后端正在显示缓存
- 状态源刷新较慢

### 推送到 GitHub 失败
优先检查：
- token 是否有 repo 写权限
- 凭据是否写入服务器
- 仓库地址是否正确


---

## 常驻运行（systemd）

如果你希望服务后台常驻、并支持开机自启：

```bash
cd /root/.openclaw/workspace/apps/agent-dashboard
./install-service.sh
```

安装后可用以下命令检查：

```bash
sudo systemctl status agent-dashboard-api.service
sudo systemctl status agent-dashboard-web.service
```

重启服务：

```bash
sudo systemctl restart agent-dashboard-api.service
sudo systemctl restart agent-dashboard-web.service
```
