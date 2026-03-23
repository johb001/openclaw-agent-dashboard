# Agent Dashboard

> 一个面向 OpenClaw 的多智能体监控台 MVP。  
> 用来实时查看智能体状态、会话活动、缓存状态、基础配置与使用情况。

## 项目定位

Agent Dashboard 的目标，不是一次性做成完整的运维平台，而是先交付一个**稳定可看、结构清晰、便于继续扩展**的第一版控制台。

它优先解决三个最现实的问题：

1. **页面能打开**
2. **接口不假死**
3. **用户能看懂当前状态**（加载中 / 刷新中 / 显示缓存 / 数据异常）

---

## 核心能力

### 多智能体可视化
- 智能体总览
- Agent 团队卡片视图
- 团队泳道视图
- 单个 Agent 详情

### 会话观察
- 最近会话列表
- 会话详情抽屉
- 最近活跃时间
- 基础 token 使用量展示

### 状态感知
- 加载态
- 后台刷新态
- 缓存态
- 错误态
- 空状态文案
- 骨架屏

### 工程稳定性
- 同域 API 代理
- 异步状态刷新
- 超时兜底
- 保留最后一次成功缓存
- 冷启动降级返回

---

## 为什么要做这个项目

在多智能体运行过程中，最常见的问题不是“没有数据”，而是：

- 页面像断了一样没反馈
- 状态命令太慢，把接口拖死
- 用户分不清是真断连，还是只是刷新慢
- 缺少一个统一观察 main / builder / planner / qa 的界面

这个项目的第一版，就是先把这些问题打穿。

---

## 当前版本特性

### 已完成
- 多智能体总览
- Agent 团队卡片视图（main / builder / planner / qa）
- 团队泳道视图（活跃中 / 近期活跃 / 空闲 / 异常）
- 会话列表
- Agent 详情面板
- 配置总览
- 基础使用情况统计
- 会话详情抽屉
- 同域 API 代理
- 加载态 / 刷新态 / 缓存态 / 错误态
- 空状态文案与骨架屏
- 后端缓存化状态采集

### 当前限制
- 底层 `openclaw status` 在某些环境下可能较慢，甚至超时
- 因此页面虽然稳定，但数据实时性仍受状态源影响
- 首次冷启动时，可能先看到降级数据或空数据，随后逐步刷新

---

## 技术架构

### 前端
- React
- Vite

### 后端
- Node.js 原生 HTTP 服务

### 代理
- 通过 Vite proxy 将 `/api/*` 同域转发到后端服务

### 状态采集策略
- 后端后台异步刷新状态
- 页面请求优先拿缓存
- 刷新失败时保留上次成功结果
- 首次无缓存时立即返回降级结果，避免页面卡死

---

## 目录结构

```bash
agent-dashboard/
├── src/
│   ├── App.jsx
│   ├── App.css
│   └── ...
├── public/
├── server.js
├── vite.config.js
├── package.json
├── README.md
├── DELIVERY.md
└── ROADMAP.md
```

---

## 一键启动（推荐，确保跑的是最新代码）

在项目目录执行：

```bash
npm run restart:latest
```

或：

```bash
./start-prod.sh
```

停止服务：

```bash
./stop.sh
```

启动脚本会先：
- 停掉旧的 dashboard 进程
- 重新 build 前端
- 启动最新后端 `server.js`
- 启动带 `/api` 代理的 preview

启动后默认可访问：
- 页面：`http://<server-ip>:4173/`
- API（走前端代理）：`http://<server-ip>:4173/api/health`
- API（直连后端）：`http://127.0.0.1:3456/api/health`

当前项目预览地址：
- `http://100.101.231.43:4173/`

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动后端 API

```bash
npm run dev:api
```

默认地址：
- `http://localhost:3456`

### 3. 启动前端

开发模式：

```bash
npm run dev -- --host 0.0.0.0 --port 4173
```

默认会把 `/api` 代理到：
- `http://127.0.0.1:3456`

如需临时改后端地址：

```bash
VITE_API_TARGET=http://127.0.0.1:3456 npm run dev -- --host 0.0.0.0 --port 4173
```

生产预览模式（更接近稳定联调）：

```bash
npm run restart:latest
```

默认地址：
- `http://localhost:4173`

---

## API 概览

### `GET /api/health`
查看服务和缓存刷新状态。

### `GET /api/overview`
查看仪表盘总览数据，同时返回当前推荐预览入口：
- `config.preview.web`
- `config.preview.apiViaWebProxy`
- `config.preview.directApi`

### `GET /api/agents`
查看所有 Agent 列表，并附带当前推荐预览入口。

### `GET /api/agents/:id/profile`
查看单个 Agent 的语义档案详情。

### `GET /api/agent/:id`
兼容接口。查看单个 Agent 详情，并额外返回：
- `profile`: 当前 Agent 语义档案
- `tasks`: 当前 Agent 关联任务列表
- `preview`: 当前推荐预览入口

### `GET /api/tasks`
查看任务列表。

### `POST /api/tasks`
创建手工任务。

### `PATCH /api/tasks/:id`
更新手工任务（仅 `writable=true` 的 manual task 可写）。

### `GET /api/runs`
查看运行单元列表。

### `GET /api/refresh`
触发一次后台刷新。

---

## 页面状态说明

### 你会看到这些状态
- **正在加载**：首次加载中
- **正在刷新缓存**：后台刷新中
- **显示上次缓存**：刷新失败，但仍在展示旧数据
- **数据异常**：当前请求失败且无缓存可用

### 如何判断问题类型

#### 真断连
- `/api/health` 无法访问
- 页面直接报错
- 代理返回 502 / 504

#### 刷新慢
- 服务在线
- 页面有缓存或刷新提示
- 数据不是最新，但页面不空白

#### 状态源慢
- 页面能打开
- API 能快速返回
- 但数据更新频率低，或长期显示缓存

---

## 适用场景

- 观察多智能体是否在线
- 查看最近会话与活跃度
- 查看当前默认模型 / Gateway / 缓存状态
- 作为后续多智能体控制台的基础底座

---

## 路线图

请查看：[`ROADMAP.md`](./ROADMAP.md)

---

## 交付文档

请查看：[`DELIVERY.md`](./DELIVERY.md)

---

## 当前结论

这版已经可以作为一个：

> **可交付的多智能体监控台 MVP**

它已经解决了最关键的问题：
- 页面不再假死
- API 不再被慢命令拖死
- 用户能够区分加载、刷新、缓存与异常状态

后续建议基于这版继续增强，而不是推倒重做。
