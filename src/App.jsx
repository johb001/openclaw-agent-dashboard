import { useEffect, useMemo, useState } from 'react'
import './App.css'

const API_BASE = ''

const NAV_ITEMS = [
  { key: 'overview', title: '总览', subtitle: '先看平台全貌', level: 'L1', description: '先快速判断平台现在整体是什么状态。' },
  { key: 'agents', title: '智能体', subtitle: '再看谁在承担工作', level: 'L2', description: '聚焦每个智能体的身份、职责和运行状态。' },
  { key: 'tasks', title: '任务', subtitle: '继续看当前任务怎么推进', level: 'L3', description: '从任务视角理解现在在做什么、谁在做、做到哪。' },
  { key: 'runtime', title: '运行', subtitle: '最后看底层运行状态', level: 'L4', description: '进入运行层后，看活跃、占用、风险与资源轨迹。' },
  { key: 'collab', title: '协作', subtitle: '协作关系', level: '扩展', description: '后续补充多智能体之间的协作关系。' },
  { key: 'system', title: '系统', subtitle: '系统设置', level: '扩展', description: '后续补充平台设置与系统信息。' },
]

const CORE_PAGE_FLOW = ['overview', 'agents', 'tasks', 'runtime']

function number(value) {
  return new Intl.NumberFormat('zh-CN').format(value || 0)
}

function ageText(ms) {
  if (ms == null) return '等待更新'
  const min = Math.floor(ms / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  return `${Math.floor(hour / 24)} 天前`
}

function formatTime(value) {
  if (!value) return '等待更新'
  return value
}

function shortText(value, fallback = '-') {
  if (!value) return fallback
  return String(value)
}

function agentMeta(agentId) {
  const metas = {
    main: {
      avatar: '🐉',
      name: '龙龙',
      role: '主控 Agent',
      color: '#39d0ff',
      mission: '承接用户意图，统筹方向判断与结果输出。',
      capability: '擅长对齐目标、做最终判断、维持整体节奏。',
      style: '对外主表达 / 决策中枢',
    },
    planner: {
      avatar: '📋',
      name: '规划师',
      role: '方案 / 拆解',
      color: '#8b5cff',
      mission: '负责把模糊目标拆成明确结构与执行路径。',
      capability: '擅长信息架构、步骤拆解、优先级规划。',
      style: '策略层 / 结构设计',
    },
    builder: {
      avatar: '🔧',
      name: '执行者',
      role: '开发 / 落地',
      color: '#4c7dff',
      mission: '把已经确认的方向落成页面、代码和交付结果。',
      capability: '擅长前端实现、视觉细化、快速落地。',
      style: '实现层 / 结果生产',
    },
    qa: {
      avatar: '🔍',
      name: '质检员',
      role: '检查 / 复核',
      color: '#37e6a7',
      mission: '检查交互、风险和方向偏移，避免页面越做越重。',
      capability: '擅长回归检查、细节复核、风险提示。',
      style: '复核层 / 质量守门',
    },
  }
  return metas[agentId] || {
    avatar: '🤖',
    name: agentId,
    role: 'Agent',
    color: '#4c7dff',
    mission: '承担当前智能体任务。',
    capability: '能力信息待补充。',
    style: '通用角色',
  }
}

function getStatus(lastActiveAgeMs, bootstrapPending) {
  if (bootstrapPending) return ['启动中', 'pending']
  if (lastActiveAgeMs == null) return ['离线', 'off']
  if (lastActiveAgeMs < 5 * 60 * 1000) return ['持续活跃', 'active']
  if (lastActiveAgeMs < 60 * 60 * 1000) return ['在线', 'warm']
  return ['空闲', 'idle']
}

function statusClass(state) {
  if (state === 'active') return 'is-active'
  if (state === 'warm') return 'is-warm'
  if (state === 'pending') return 'is-pending'
  if (state === 'idle') return 'is-idle'
  return 'is-off'
}

function EmptyState({ title, hint }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {hint ? <span>{hint}</span> : null}
    </div>
  )
}

function StatCard({ label, value, hint }) {
  return (
    <div className="stat-card">
      <div className="mini-label">{label}</div>
      <strong>{value}</strong>
      <p>{hint}</p>
    </div>
  )
}

function statusTone(state) {
  if (state === 'active') return 'active'
  if (state === 'warm') return 'warm'
  if (state === 'pending') return 'warn'
  if (state === 'idle') return 'idle'
  return 'warn'
}

function roleTitle(state) {
  if (state === 'active') return '正在主导当前任务链路'
  if (state === 'warm') return '仍在参与当前任务链路'
  if (state === 'pending') return '正在接入当前任务链路'
  if (state === 'idle') return '保持待命，等待新任务'
  return '当前未进入可见任务链路'
}

function stateDescription(state) {
  if (state === 'active') return '最近持续有输出，处于当前视图的核心位置。'
  if (state === 'warm') return '近期仍有参与，更多承担协同或跟进角色。'
  if (state === 'pending') return '刚进入运行过程，建议继续观察是否稳定。'
  if (state === 'idle') return '当前没有连续输出，更接近待命状态。'
  return '当前没有可见活动信号，暂未进入主任务链路。'
}

function runtimeSignal(agent) {
  if (agent?.displayRuntimeSignal) return agent.displayRuntimeSignal
  if (agent.bootstrapPending) return '正在启动，建议下一轮刷新继续观察。'
  if (agent.latestSession?.percentUsed >= 80) return '上下文占用偏高，后续可能需要压缩或切换任务焦点。'
  if (agent.latestSession?.totalTokens) return '本轮已留下明显运行痕迹，适合继续追踪。'
  return '当前信号较弱，更像处于待命或轻量活动状态。'
}

function currentTaskText(agent) {
  if (agent?.displayCurrentTask) return agent.displayCurrentTask
  if (agent.bootstrapPending) return '正在初始化当前任务环境，等待状态稳定。'
  if (agent.latestSession?.totalTokens) return '正在处理当前任务链路，并持续产出中间结果。'
  return '当前没有明确输出任务，更多承担候场与支援角色。'
}

function responsibilityItems(agentId) {
  const items = {
    main: ['对齐用户目标', '决定当前方向', '汇总并对外输出结果'],
    planner: ['拆解复杂目标', '设计信息架构', '安排执行顺序'],
    builder: ['落地界面与代码', '细化视觉与交互', '把方案变成交付'],
    qa: ['复核方向偏移', '检查页面负担', '补充风险提醒'],
  }
  return items[agentId] || ['承担当前任务', '维持基本输出', '等待更多上下文']
}

function behaviorSummary(agent) {
  if (agent?.displayBehavior) return agent.displayBehavior
  if (agent.bootstrapPending) return '刚进入运行过程，行为特征还在形成。'
  if (agent.latestSession?.percentUsed >= 80) return '近期行为偏连续，已经出现明显的高占用信号。'
  if (agent.latestSession?.totalTokens) return '最近行为稳定可见，说明它正在任务链里持续留下结果。'
  return '最近行为较轻，当前更像在等待下一轮指令。'
}

function agentHeadline(meta, state, agent) {
  if (agent?.displayHeadline) return agent.displayHeadline
  if (state === 'active') return `${meta.name} 正在当前链路里承担核心输出`
  if (state === 'warm') return `${meta.name} 仍在当前链路里持续跟进`
  if (state === 'pending') return `${meta.name} 正在接入并建立运行状态`
  if (state === 'idle') return `${meta.name} 当前处于待命观察位`
  return `${meta.name} 当前未进入主可见链路`
}

function taskStatusMeta(status) {
  const map = {
    queued: ['排队中', 'idle'],
    preparing: ['准备中', 'warn'],
    in_progress: ['处理中', 'warm'],
    running: ['深度执行中', 'active'],
    at_risk: ['高负载推进', 'warn'],
    blocked: ['阻塞中', 'warn'],
    paused: ['已暂停', 'idle'],
    done: ['已完成', 'active'],
    cancelled: ['已取消', 'idle'],
  }
  return map[status] || ['待观察', 'idle']
}

function taskStatusFromSession(session, agent) {
  if (agent?.bootstrapPending) return taskStatusMeta('preparing')
  if (!session) return taskStatusMeta('queued')
  if ((session.percentUsed || 0) >= 80) return taskStatusMeta('at_risk')
  if ((session.totalTokens || 0) >= 12000) return taskStatusMeta('running')
  if ((session.totalTokens || 0) > 0) return taskStatusMeta('in_progress')
  return taskStatusMeta('queued')
}

function allowedTaskTransitions(status) {
  const map = {
    queued: ['preparing', 'in_progress', 'blocked', 'paused', 'cancelled'],
    preparing: ['in_progress', 'blocked', 'paused', 'cancelled'],
    in_progress: ['running', 'blocked', 'paused', 'done', 'cancelled'],
    running: ['blocked', 'paused', 'done', 'cancelled'],
    at_risk: ['in_progress', 'running', 'blocked', 'paused', 'done', 'cancelled'],
    blocked: ['queued', 'in_progress', 'paused', 'cancelled'],
    paused: ['queued', 'in_progress', 'cancelled'],
    done: [],
    cancelled: [],
  }
  return map[status] || []
}

function taskOwnerText(agent) {
  if (!agent) return '待分配'
  const meta = agentMeta(agent.id)
  return `${meta.name} · ${meta.role}`
}

function taskTypeText(agent) {
  const map = {
    main: '目标统筹',
    planner: '方案拆解',
    builder: '页面落地',
    qa: '回归复核',
  }
  return map[agent?.id] || '通用任务'
}

function taskPriorityText(agent, session) {
  if (agent?.id === 'main') return 'P0 / 当前焦点'
  if (agent?.bootstrapPending) return 'P1 / 接入确认'
  if ((session?.percentUsed || 0) >= 80) return 'P1 / 风险跟进'
  if ((session?.totalTokens || 0) > 0) return 'P2 / 稳定推进'
  return 'P3 / 待命观察'
}

function taskStageText(agent, session) {
  if (agent?.bootstrapPending) return '初始化'
  if (!session) return '排队中'
  if ((session.percentUsed || 0) >= 80) return '冲刺中'
  if ((session.totalTokens || 0) >= 12000) return '深度处理'
  if ((session.totalTokens || 0) > 0) return '执行中'
  return '观察中'
}

function taskCurrentText(agent) {
  if (!agent) return '等待任务进入当前视图。'
  if (agent.bootstrapPending) return '正在建立运行上下文，等待任务状态稳定。'
  if (agent.latestSession?.percentUsed >= 80) return '正在连续推进任务，同时已出现较高上下文占用。'
  if (agent.latestSession?.totalTokens) return '正在推进当前任务，并持续留下运行结果。'
  return '当前没有明显执行痕迹，更像处于待命或轻量跟进。'
}

function taskProgressText(agent, session) {
  if (agent?.bootstrapPending) return '已进入运行链路，但还没形成稳定输出。'
  if (!session) return '暂无最近会话，等待新的任务动作。'
  if ((session.percentUsed || 0) >= 80) return `本轮累计 ${number(session.totalTokens || 0)} 资源，上下文 ${session.percentUsed}% ，推进力度强但需控风险。`
  if ((session.totalTokens || 0) > 0) return `本轮累计 ${number(session.totalTokens || 0)} 资源，最近活跃 ${ageText(agent?.lastActiveAgeMs)}。`
  return '已接入任务链，但最近输出较少。'
}

function taskRiskText(agent, session, hasGlobalError, degraded) {
  if (hasGlobalError) return '接口异常，当前任务状态可能不完整。'
  if (degraded) return '当前处于缓存模式，任务信息可能略旧。'
  if (agent?.bootstrapPending) return '启动中的任务可能还会继续变化。'
  if ((session?.percentUsed || 0) >= 80) return '上下文占用偏高，建议优先关注后续可持续性。'
  if ((agent?.lastActiveAgeMs ?? Infinity) > 60 * 60 * 1000) return '最近长时间无推进，可能已经停滞。'
  return '当前未见明显风险，可继续观察推进节奏。'
}

function taskUpdateText(agent, session) {
  if (agent?.bootstrapPending) return '刚接入'
  if (!session) return '等待更新'
  return ageText(agent?.lastActiveAgeMs ?? session?.age)
}

function buildTaskBoard(agentCards, hasGlobalError, degraded) {
  const items = agentCards.map((agent) => {
    const session = agent.latestSession || null
    const meta = agentMeta(agent.id)
    const [statusLabel, statusTone] = taskStatusFromSession(session, agent)
    const updates = (agent.sessions || []).slice(0, 3)
    return {
      id: agent.id,
      meta,
      owner: taskOwnerText(agent),
      statusLabel,
      statusTone,
      type: taskTypeText(agent),
      priority: taskPriorityText(agent, session),
      stage: taskStageText(agent, session),
      current: taskCurrentText(agent),
      progress: taskProgressText(agent, session),
      risk: taskRiskText(agent, session, hasGlobalError, degraded),
      updateText: taskUpdateText(agent, session),
      session,
      agent,
      tokens: agent.totalTokens || 0,
      context: session?.percentUsed,
      updates,
    }
  })

  return items.sort((a, b) => {
    const order = { warn: 0, active: 1, warm: 2, idle: 3 }
    const toneDiff = (order[a.statusTone] ?? 9) - (order[b.statusTone] ?? 9)
    if (toneDiff !== 0) return toneDiff
    return (b.tokens || 0) - (a.tokens || 0)
  })
}

function taskRiskCount(tasks) {
  return tasks.filter((task) => task.statusTone === 'warn' || /风险|异常|停滞|缓存/.test(task.risk)).length
}

function taskStateBreakdown(tasks) {
  return {
    executing: tasks.filter((task) => task.statusTone === 'active' || task.statusTone === 'warm').length,
    attention: tasks.filter((task) => task.statusTone === 'warn').length,
    idle: tasks.filter((task) => task.statusTone === 'idle').length,
  }
}

function overviewStatus(summary, error, degraded) {
  if (error) return ['接口异常', 'warn']
  if (degraded) return ['缓存模式', 'warn']
  if ((summary?.activeAgents || 0) > 0) return ['运行正常', 'active']
  return ['等待信号', 'idle']
}

function pageCopy(pageMeta) {
  const copy = {
    overview: {
      title: '总览 / 平台入口',
      description: '先看平台整体，再决定要下钻到智能体还是任务。这里回答“现在整体怎么样”。',
    },
    agents: {
      title: '智能体 / 角色视角',
      description: '从总览进入智能体层，理解“是谁在承担工作、状态怎样、职责是什么”。',
    },
    tasks: {
      title: '任务 / 推进视角',
      description: '从智能体层继续进入任务层，理解“现在在做什么、谁在做、推进到哪”。',
    },
    runtime: {
      title: '运行 / 底层视角',
      description: '从任务层继续进入运行层，理解“当前运行是否健康、占用多高、风险在哪里”。',
    },
  }
  return copy[pageMeta?.key] || {
    title: `${pageMeta?.title || '页面'} / 后续扩展`,
    description: pageMeta?.description || '当前页先作为后续扩展入口。',
  }
}

function hierarchyCards(summary, activeAgents, riskSignals, totalTokens, runtimeRiskSignals) {
  return [
    {
      key: 'overview',
      level: 'L1',
      title: '总览',
      question: '现在平台整体怎么样？',
      answer: `当前可见 ${number(summary?.totalAgents || 0)} 个智能体，活跃 ${number(activeAgents)} 个，风险信号 ${number(riskSignals)} 个。`,
    },
    {
      key: 'agents',
      level: 'L2',
      title: '智能体',
      question: '是谁在承担当前工作？',
      answer: '进入智能体层后，可以逐个看角色、职责、模型、活跃度与运行轨迹。',
    },
    {
      key: 'tasks',
      level: 'L3',
      title: '任务',
      question: '当前任务是怎么推进的？',
      answer: `最近累计输出 ${number(totalTokens)} 资源，可继续下钻看负责人、阶段和风险。`,
    },
    {
      key: 'runtime',
      level: 'L4',
      title: '运行',
      question: '底层运行现在是否健康？',
      answer: `当前可见 ${number(runtimeRiskSignals)} 个运行关注点，可继续看占用、资源与轨迹。`,
    },
  ]
}

function pageHeroSummary(activePage, selectedAgentCard, selectedTaskCard, focusMeta, selectedMeta) {
  if (activePage === 'agents') {
    return {
      label: '当前层级：L2 / 智能体',
      title: `${focusMeta.name} 正在承担当前链路`,
      text: selectedAgentCard
        ? `${focusMeta.name} 负责 ${focusMeta.role}，当前可继续下钻看它承接的任务。`
        : '等待智能体进入当前视图。',
    }
  }
  if (activePage === 'tasks') {
    return {
      label: '当前层级：L3 / 任务',
      title: `${selectedTaskCard?.meta?.name || '任务'} 的当前推进`,
      text: selectedTaskCard
        ? `${selectedTaskCard.current} 可回看负责人 ${selectedTaskCard.owner} 与最近推进。`
        : '等待任务进入当前视图。',
    }
  }
  return {
    label: '当前层级：L1 / 总览',
    title: '先判断平台全貌，再决定往下看谁与什么任务',
    text: `${selectedMeta.name} 只是当前焦点之一；总览负责先给出全局判断。`,
  }
}

function eventPriority(type = '') {
  if (type.includes('created')) return 1
  if (type.includes('status')) return 2
  if (type.includes('risk')) return 3
  if (type.includes('context')) return 4
  if (type.includes('session')) return 5
  if (type.includes('summary')) return 6
  if (type.includes('priority')) return 7
  if (type.includes('stage')) return 8
  if (type.startsWith('run_')) return 9
  return 20
}

function taskEventTitle(event) {
  if (event?.title) return event.title
  const type = event?.raw?.type || ''
  const map = {
    task_created: '任务已建立',
    status_changed: '任务状态已变化',
    priority_changed: '任务优先级已变化',
    stage_changed: '任务阶段已变化',
    summary_changed: '任务摘要已变化',
    status_reason_changed: '状态原因已变化',
    context_changed: '任务上下文占用变化',
    session_changed: '任务负责会话已切换',
    status_reason_updated: '状态原因已更新',
  }
  if (type.startsWith('run_')) return '运行事件'
  return map[type] || '任务事件'
}

function taskEventGroupLabel(event) {
  const type = event?.raw?.type || ''
  if (type.startsWith('run_')) return '运行层'
  if (type.includes('status') || type.includes('stage') || type.includes('priority')) return '任务状态'
  if (type.includes('context') || type.includes('risk')) return '风险 / 上下文'
  if (type.includes('session')) return '会话'
  if (type.includes('summary')) return '摘要'
  return '其他'
}

function buildTaskTimeline(tasks, selectedTaskId) {
  const source = tasks.find((task) => task.id === selectedTaskId) || tasks[0]
  if (!source) return []

  const items = [
    {
      key: `${source.id}-current`,
      time: '当前',
      title: '任务状态',
      detail: `${source.statusLabel} · ${source.current}`,
    },
    {
      key: `${source.id}-progress`,
      time: source.updateText,
      title: '最近推进',
      detail: source.progress,
    },
    {
      key: `${source.id}-risk`,
      time: '观察',
      title: '风险提示',
      detail: source.risk,
    },
  ]

  source.updates
    .slice()
    .sort((a, b) => eventPriority(a?.raw?.type || '') - eventPriority(b?.raw?.type || ''))
    .forEach((item, index) => {
      items.push({
        key: item.sessionId || `${source.id}-${index}`,
        time: ageText(item.age),
        title: `${taskEventGroupLabel(item)} · ${taskEventTitle(item)}`,
        detail: item.detail || `${shortText(item.model, '模型待同步')} · ${number(item.totalTokens || 0)} 资源 · ${item.percentUsed != null ? `上下文 ${item.percentUsed}%` : '上下文待同步'}`,
        raw: item,
      })
    })

  return items.slice(0, 6)
}

function runtimeRiskTone(agent, hasGlobalError, degraded) {
  if (hasGlobalError) return ['接口异常', 'warn']
  if (degraded) return ['缓存模式', 'warn']
  if (agent?.bootstrapPending) return ['启动观察', 'warn']
  if ((agent?.latestSession?.percentUsed || 0) >= 85) return ['高占用', 'warn']
  if ((agent?.lastActiveAgeMs ?? Infinity) > 60 * 60 * 1000) return ['长时静默', 'idle']
  if ((agent?.lastActiveAgeMs ?? Infinity) < 5 * 60 * 1000) return ['稳定运行', 'active']
  return ['轻载运行', 'warm']
}

function runtimeResourceLevel(agent) {
  const tokens = agent?.totalTokens || 0
  if (tokens >= 15000) return '高资源消耗'
  if (tokens >= 6000) return '中等资源消耗'
  if (tokens > 0) return '轻量资源消耗'
  return '暂无明显资源消耗'
}

function runtimeContextText(agent) {
  if (agent?.latestSession?.percentUsed == null) return '上下文待同步'
  if (agent.latestSession.percentUsed >= 85) return `上下文 ${agent.latestSession.percentUsed}% · 已接近高压区`
  if (agent.latestSession.percentUsed >= 70) return `上下文 ${agent.latestSession.percentUsed}% · 进入注意区`
  return `上下文 ${agent.latestSession.percentUsed}% · 仍在安全区`
}

function runtimeTrajectory(agent) {
  if (agent?.bootstrapPending) return '刚进入运行页视角，轨迹还在形成。'
  if ((agent?.latestSession?.percentUsed || 0) >= 85) return '当前轨迹呈现连续推进 + 高上下文占用，应重点盯住后续可持续性。'
  if ((agent?.totalTokens || 0) >= 12000) return '当前轨迹偏深度执行，说明它正在承担连续输出链路。'
  if ((agent?.lastActiveAgeMs ?? Infinity) < 5 * 60 * 1000) return '当前轨迹稳定在线，持续留下可观察运行痕迹。'
  return '当前轨迹较弱，更像待命或阶段性收尾。'
}

function buildRuntimeBoard(agentCards, hasGlobalError, degraded) {
  return [...agentCards]
    .map((agent) => {
      const meta = agentMeta(agent.id)
      const [statusLabel, statusState] = getStatus(agent.lastActiveAgeMs, agent.bootstrapPending)
      const [riskLabel, riskTone] = runtimeRiskTone(agent, hasGlobalError, degraded)
      return {
        id: agent.id,
        agent,
        meta,
        statusLabel,
        statusState,
        riskLabel,
        riskTone,
        tokens: agent.totalTokens || 0,
        context: agent.latestSession?.percentUsed,
        model: agent.latestSession?.model || agent.model || '-',
        resourceLevel: runtimeResourceLevel(agent),
        contextText: runtimeContextText(agent),
        trajectory: runtimeTrajectory(agent),
        activeText: currentTaskText(agent),
        updatedAt: ageText(agent.lastActiveAgeMs),
        updates: (agent.sessions || []).slice(0, 4),
      }
    })
    .sort((a, b) => {
      const order = { warn: 0, active: 1, warm: 2, idle: 3 }
      const toneDiff = (order[a.riskTone] ?? 9) - (order[b.riskTone] ?? 9)
      if (toneDiff !== 0) return toneDiff
      return (b.tokens || 0) - (a.tokens || 0)
    })
}

function runtimeEventTitle(event) {
  if (event?.title) return event.title
  const map = {
    run_created: '运行单元已建立',
    status_changed: '运行状态已变化',
    risk_changed: '风险标签已变化',
    context_changed: '上下文占用变化',
    session_changed: '最新会话已切换',
    model_changed: '运行模型已变化',
    session_snapshot: '留下新的运行痕迹',
  }
  return map[event?.raw?.type] || '运行事件'
}

function runtimeEventGroupLabel(event) {
  const type = event?.raw?.type || ''
  if (type.includes('status')) return '运行状态'
  if (type.includes('risk') || type.includes('context')) return '风险 / 上下文'
  if (type.includes('session')) return '会话'
  if (type.includes('model')) return '模型'
  if (type.includes('created')) return '初始化'
  return '运行层'
}

function buildRuntimeTimeline(runtimeCard, selectedSessions) {
  if (!runtimeCard) return []
  const base = selectedSessions?.length ? selectedSessions : runtimeCard.updates || []
  const items = [
    {
      key: `${runtimeCard.id}-status`,
      time: '当前',
      title: '运行状态',
      detail: `${runtimeCard.statusLabel} · ${runtimeCard.activeText}`,
    },
    {
      key: `${runtimeCard.id}-context`,
      time: runtimeCard.updatedAt,
      title: '上下文占用',
      detail: runtimeCard.contextText,
    },
    {
      key: `${runtimeCard.id}-risk`,
      time: '观察',
      title: '风险信号',
      detail: `${runtimeCard.riskLabel} · ${runtimeCard.trajectory}`,
    },
  ]

  base
    .slice()
    .sort((a, b) => eventPriority(a?.raw?.type || '') - eventPriority(b?.raw?.type || ''))
    .forEach((item, index) => {
      items.push({
        key: item.sessionId || `${runtimeCard.id}-${index}`,
        time: ageText(item.age),
        title: `${runtimeEventGroupLabel(item)} · ${runtimeEventTitle(item)}`,
        detail: item.detail || `${shortText(item.model, '模型待同步')} · ${number(item.totalTokens || 0)} 资源 · ${item.percentUsed != null ? `上下文 ${item.percentUsed}%` : '上下文待同步'}`,
        raw: item,
      })
    })

  return items.slice(0, 6)
}

function navigateToLayer(setActivePage, options = {}) {
  const { page, setSelectedAgent, agentId, setSelectedTask, taskId } = options
  if (agentId && typeof setSelectedAgent === 'function') setSelectedAgent(agentId)
  if (taskId && typeof setSelectedTask === 'function') setSelectedTask(taskId)
  if (page) setActivePage(page)
}

export default function App() {
  const [data, setData] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState('')
  const [selectedAgent, setSelectedAgent] = useState('main')
  const [selectedSession, setSelectedSession] = useState(null)
  const [agentDetail, setAgentDetail] = useState(null)
  const [agentProfiles, setAgentProfiles] = useState(null)
  const [agentFilter, setAgentFilter] = useState('all')
  const [taskFilter, setTaskFilter] = useState('all')
  const [runtimeFilter, setRuntimeFilter] = useState('all')
  const [selectedTask, setSelectedTask] = useState('main')
  const [activePage, setActivePage] = useState('overview')
  const [tasksData, setTasksData] = useState(null)
  const [runsData, setRunsData] = useState(null)
  const [runDetail, setRunDetail] = useState(null)
  const [runEvents, setRunEvents] = useState([])
  const [taskDetail, setTaskDetail] = useState(null)
  const [taskEvents, setTaskEvents] = useState([])
  const [taskSaving, setTaskSaving] = useState(false)
  const [taskActionMessage, setTaskActionMessage] = useState('')
  const [taskForm, setTaskForm] = useState({
    title: '',
    ownerAgentId: 'main',
    summary: '',
    status: 'queued',
    statusReason: '',
    priority: 'P2',
    stage: '新建',
    type: 'general',
  })
  const [taskEditForm, setTaskEditForm] = useState({
    summary: '',
    status: 'queued',
    statusReason: '',
  })

  async function load(silent = false) {
    try {
      if (silent) setRefreshing(true)
      setError('')
      const res = await fetch(`${API_BASE}/api/overview`)
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || '加载失败')
      setData(json)
      setLastUpdated(new Date().toLocaleString())
    } catch (err) {
      setError(err.message || '请求失败')
    } finally {
      setRefreshing(false)
    }
  }

  async function loadTasks() {
    try {
      const res = await fetch(`${API_BASE}/api/tasks`)
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || '加载任务失败')
      setTasksData(json)
    } catch (err) {
      setTasksData({ ok: false, error: err.message || '加载失败', items: [] })
    }
  }

  async function loadAgentProfiles() {
    try {
      const res = await fetch(`${API_BASE}/api/agents`)
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || '加载智能体档案失败')
      setAgentProfiles(json)
    } catch (err) {
      setAgentProfiles({ ok: false, error: err.message || '加载失败', items: [] })
    }
  }

  async function loadRuns() {
    try {
      const res = await fetch(`${API_BASE}/api/runs`)
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || '加载运行数据失败')
      setRunsData(json)
    } catch (err) {
      setRunsData({ ok: false, error: err.message || '加载失败', items: [] })
    }
  }

  async function loadTaskDetail(taskId) {
    try {
      const [detailRes, eventsRes] = await Promise.all([
        fetch(`${API_BASE}/api/tasks/${encodeURIComponent(taskId)}`),
        fetch(`${API_BASE}/api/tasks/${encodeURIComponent(taskId)}/events`),
      ])
      const detailJson = await detailRes.json()
      const eventsJson = await eventsRes.json()
      if (!detailRes.ok || !detailJson.ok) throw new Error(detailJson.error || '加载任务详情失败')
      if (!eventsRes.ok || !eventsJson.ok) throw new Error(eventsJson.error || '加载任务事件失败')
      setTaskDetail(detailJson)
      setTaskEvents(eventsJson.items || [])
    } catch (err) {
      setTaskDetail({ ok: false, error: err.message || '加载失败' })
      setTaskEvents([])
    }
  }

  async function loadRunDetail(runId) {
    try {
      const [detailRes, eventsRes] = await Promise.all([
        fetch(`${API_BASE}/api/runs/${encodeURIComponent(runId)}`),
        fetch(`${API_BASE}/api/runs/${encodeURIComponent(runId)}/events`),
      ])
      const detailJson = await detailRes.json()
      const eventsJson = await eventsRes.json()
      if (!detailRes.ok || !detailJson.ok) throw new Error(detailJson.error || '加载运行详情失败')
      if (!eventsRes.ok || !eventsJson.ok) throw new Error(eventsJson.error || '加载运行事件失败')
      setRunDetail(detailJson)
      setRunEvents(eventsJson.items || [])
    } catch (err) {
      setRunDetail({ ok: false, error: err.message || '加载失败' })
      setRunEvents([])
    }
  }

  async function loadAgentDetail(agentId) {
    try {
      const res = await fetch(`${API_BASE}/api/agents/${encodeURIComponent(agentId)}/profile`)
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || '加载 agent 档案失败')
      setAgentDetail(json)
    } catch (err) {
      setAgentDetail({ ok: false, error: err.message || '加载失败' })
    }
  }

  async function createManualTask() {
    if (!taskForm.title.trim()) {
      setTaskActionMessage('请先填写任务标题')
      return
    }

    try {
      setTaskSaving(true)
      setTaskActionMessage('')
      const res = await fetch(`${API_BASE}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...taskForm,
          title: taskForm.title.trim(),
          summary: taskForm.summary.trim(),
          statusReason: taskForm.statusReason.trim(),
          stage: taskForm.stage.trim(),
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || '新建任务失败')

      setTaskActionMessage('手工任务已创建')
      setTaskForm({
        title: '',
        ownerAgentId: taskForm.ownerAgentId || 'main',
        summary: '',
        status: 'queued',
        statusReason: '',
        priority: taskForm.priority || 'P2',
        stage: '新建',
        type: taskForm.type || 'general',
      })
      await loadTasks()
      if (json.item?.id) setSelectedTask(json.item.id)
    } catch (err) {
      setTaskActionMessage(err.message || '新建任务失败')
    } finally {
      setTaskSaving(false)
    }
  }

  async function updateManualTask(taskId) {
    if (!taskId) return

    try {
      setTaskSaving(true)
      setTaskActionMessage('')
      const res = await fetch(`${API_BASE}/api/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: taskEditForm.summary.trim(),
          status: taskEditForm.status,
          statusReason: taskEditForm.statusReason.trim(),
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || '更新任务失败')

      setTaskActionMessage('手工任务已更新')
      await loadTasks()
      await loadTaskDetail(taskId)
    } catch (err) {
      setTaskActionMessage(err.message || '更新任务失败')
    } finally {
      setTaskSaving(false)
    }
  }

  useEffect(() => {
    load(false)
    loadTasks()
    loadAgentProfiles()
    loadRuns()
    const timer = setInterval(() => {
      load(true)
      loadTasks()
      loadAgentProfiles()
      loadRuns()
    }, 15000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (selectedAgent) loadAgentDetail(selectedAgent)
  }, [selectedAgent])

  useEffect(() => {
    if (selectedTask) loadTaskDetail(selectedTask)
  }, [selectedTask])

  useEffect(() => {
    const currentRun = (runsData?.items || []).find((item) => item.agentId === selectedAgent) || (runsData?.items || [])[0]
    if (currentRun?.id) loadRunDetail(currentRun.id)
  }, [selectedAgent, runsData])

  const summary = data?.summary || {}
  const usage = data?.usage || {}
  const agents = data?.agents || []
  const recentSessions = data?.recentSessions || []
  const cacheState = data?.cacheState || {}

  const agentCards = useMemo(() => {
    const profileMap = new Map((agentProfiles?.items || []).map((item) => [item.id, item]))
    return agents.map((agent) => {
      const sessions = recentSessions.filter((item) => item.agentId === agent.id)
      const totalTokens = sessions.reduce((sum, item) => sum + (item.totalTokens || 0), 0)
      const model = sessions[0]?.model || agent.model || '-'
      const latestSession = sessions[0] || null
      const profile = profileMap.get(agent.id) || null
      return {
        ...agent,
        sessions,
        totalTokens,
        model,
        latestSession,
        profile,
        displayName: profile?.name || agent.name || agent.id,
        displayRole: profile?.role || agentMeta(agent.id).role,
        displayMission: profile?.mission || agentMeta(agent.id).mission,
        displayCapability: profile?.capability || agentMeta(agent.id).capability,
        displayStyle: profile?.style || agentMeta(agent.id).style,
        displayResponsibilities: profile?.responsibilities || responsibilityItems(agent.id),
        displayHeadline: profile?.headline || null,
        displaySummary: profile?.summary || null,
        displayCurrentTask: profile?.currentTask || null,
        displayBehavior: profile?.behavior || null,
        displayRuntimeSignal: profile?.runtimeSignal || null,
        displayState: profile?.state || null,
        displayStateLabel: profile?.stateLabel || null,
      }
    })
  }, [agents, recentSessions, agentProfiles])

  useEffect(() => {
    if (!agentCards.length) return
    const exists = agentCards.some((item) => item.id === selectedAgent)
    if (!exists) setSelectedAgent(agentCards[0].id)
  }, [agentCards, selectedAgent])

  const selectedAgentCard = useMemo(
    () => agentCards.find((agent) => agent.id === selectedAgent) || agentCards[0] || null,
    [agentCards, selectedAgent],
  )

  const selectedMeta = selectedAgentCard?.profile
    ? {
        avatar: selectedAgentCard.profile.avatar,
        name: selectedAgentCard.profile.name,
        role: selectedAgentCard.profile.role,
        color: agentMeta(selectedAgentCard.id).color,
        mission: selectedAgentCard.profile.mission,
        capability: selectedAgentCard.profile.capability,
        style: selectedAgentCard.profile.style,
      }
    : selectedAgentCard
      ? agentMeta(selectedAgentCard.id)
      : agentMeta('main')
  const [selectedStatusLabel, selectedStatus] = selectedAgentCard?.profile?.stateLabel
    ? [selectedAgentCard.profile.stateLabel, selectedAgentCard.profile.state]
    : selectedAgentCard
      ? getStatus(selectedAgentCard.lastActiveAgeMs, selectedAgentCard.bootstrapPending)
      : ['离线', 'off']

  const selectedSessions = agentDetail?.item?.latestSession
    ? [agentDetail.item.latestSession, ...(selectedAgentCard?.sessions || []).filter((item) => item.sessionId !== agentDetail.item.latestSession.sessionId)]
    : agentDetail?.sessions || selectedAgentCard?.sessions || []
  const primarySession = selectedSessions[0] || selectedAgentCard?.latestSession || null
  const selectedContext = primarySession?.percentUsed != null ? `${primarySession.percentUsed}%` : '—'
  const selectedTokens = number(selectedAgentCard?.totalTokens || 0)
  const selectedLastActive = ageText(selectedAgentCard?.lastActiveAgeMs)

  const activeAgents = useMemo(
    () => agentCards.filter((agent) => (agent.lastActiveAgeMs ?? Infinity) < 5 * 60 * 1000).length,
    [agentCards],
  )
  const totalTokens = useMemo(
    () => recentSessions.reduce((sum, item) => sum + (item.totalTokens || 0), 0),
    [recentSessions],
  )
  const riskSignals = useMemo(() => {
    let count = 0
    if (error || cacheState?.degraded) count += 1
    count += recentSessions.filter((item) => (item.percentUsed || 0) >= 80).length
    count += agentCards.filter((agent) => agent.bootstrapPending).length
    return count
  }, [error, cacheState, recentSessions, agentCards])

  const modelBars = useMemo(
    () => Object.entries(usage?.byModel || {}).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    [usage],
  )

  const agentFilterOptions = [
    { key: 'all', label: '全部' },
    { key: 'active', label: '活跃' },
    { key: 'attention', label: '高占用' },
    { key: 'main', label: '主控' },
  ]

  const filteredAgents = useMemo(() => {
    return agentCards.filter((agent) => {
      if (agentFilter === 'active') return (agent.lastActiveAgeMs ?? Infinity) < 5 * 60 * 1000
      if (agentFilter === 'attention') return agent.bootstrapPending || agent.sessions.some((item) => (item.percentUsed || 0) >= 80)
      if (agentFilter === 'main') return agent.id === 'main'
      return true
    })
  }, [agentCards, agentFilter])

  const selectedTimeline = useMemo(() => {
    const items = selectedSessions.length ? selectedSessions : selectedAgentCard?.sessions || []
    return items.slice(0, 4).map((item, index) => ({
      key: item.sessionId || `${selectedAgent}-${index}`,
      time: ageText(item.age),
      title: item.totalTokens ? '留下新的运行痕迹' : '进入可见运行队列',
      detail: `${shortText(item.model, '模型待同步')} · ${number(item.totalTokens || 0)} 资源 · ${item.percentUsed != null ? `上下文 ${item.percentUsed}%` : '上下文待同步'}`,
      raw: item,
    }))
  }, [selectedSessions, selectedAgentCard, selectedAgent])

  const selectedJourney = useMemo(() => {
    if (!selectedAgentCard) return []
    const attention = primarySession?.percentUsed >= 80
    const items = [
      {
        key: 'role',
        time: '当前',
        title: '身份定位',
        detail: `${selectedMeta.name}负责${selectedMeta.role}，在平台中承担“${selectedMeta.style}”职责。`,
      },
      {
        key: 'mission',
        time: selectedLastActive,
        title: '当前职责',
        detail: currentTaskText(selectedAgentCard),
      },
      {
        key: 'signal',
        time: '运行中',
        title: '运行信号',
        detail: runtimeSignal(selectedAgentCard),
      },
      {
        key: 'risk',
        time: '观察',
        title: '关注重点',
        detail: error
          ? '接口当前异常，需先恢复数据可见性。'
          : selectedAgentCard.bootstrapPending
            ? '优先确认是否顺利进入稳定状态。'
            : attention
              ? '优先关注上下文占用变化，避免后续链路受阻。'
              : '当前风险较低，可继续观察后续任务变化。',
      },
    ]
    return items
  }, [selectedAgentCard, selectedMeta, selectedLastActive, primarySession, error])

  const rightDetailRows = [
    { label: '角色', value: selectedMeta.role },
    { label: '职责风格', value: selectedMeta.style },
    { label: '当前模型', value: primarySession?.model || selectedAgentCard?.model || summary.defaultModel || '-' },
    { label: '最近活跃', value: selectedLastActive },
    { label: '当前状态', value: selectedStatusLabel },
    { label: '会话数', value: selectedSessions.length || selectedAgentCard?.sessionsCount || selectedAgentCard?.sessions?.length || 0 },
    { label: '累计资源', value: selectedTokens },
    { label: '上下文占用', value: selectedContext },
    { label: '当前风险', value: error ? '接口异常' : cacheState?.degraded ? '缓存模式' : selectedStatus === 'pending' ? '启动中需观察' : primarySession?.percentUsed >= 80 ? '上下文偏高' : '低风险' },
  ]

  const taskBoard = useMemo(() => {
    const apiItems = tasksData?.items || []
    if (!apiItems.length) {
      return buildTaskBoard(agentCards, Boolean(error), cacheState?.degraded)
    }

    return apiItems.map((task) => {
      const ownerAgent = agentCards.find((agent) => agent.id === task.ownerAgentId) || null
      const meta = agentMeta(task.ownerAgentId)
      const [labelFromStatus, toneFromStatus] = taskStatusMeta(task.status)
      const detailItem = taskDetail?.item?.id === task.id ? taskDetail.item : null
      const detailEvents = selectedTask === task.id
        ? ((taskEvents || []).length ? taskEvents : (detailItem?.events || []))
        : []
      return {
        id: task.id,
        taskId: task.id,
        meta,
        owner: ownerAgent ? `${meta.name} · ${meta.role}` : task.ownerAgentId || '待分配',
        statusLabel: labelFromStatus,
        statusTone: toneFromStatus,
        type: task.title || task.type || '通用任务',
        priority: task.priority ? `${task.priority} / ${task.priority === 'P0' ? '当前焦点' : task.priority === 'P1' ? '优先处理' : task.priority === 'P2' ? '稳定推进' : '待命观察'}` : 'P3 / 待命观察',
        stage: task.stage || '排队中',
        current: task.summary || '等待任务进入当前视图。',
        progress: (task.status === 'blocked' || task.status === 'paused') && task.statusReason
          ? task.statusReason
          : task.lastSession
            ? `本轮累计 ${number(task.totalTokens || 0)} 资源，最近活跃 ${ageText(task.lastActiveAgeMs)}。`
            : '暂无最近会话，等待新的任务动作。',
        statusReason: task.statusReason || '',
        risk: task.status === 'at_risk'
          ? '上下文占用偏高，建议优先关注后续可持续性。'
          : task.status === 'blocked'
            ? '当前任务进入阻塞状态，建议优先排查卡点。'
            : task.status === 'preparing'
              ? '启动中的任务可能还会继续变化。'
              : task.status === 'paused'
                ? '当前任务已暂停，等待后续恢复。'
                : task.status === 'done'
                  ? '当前任务已完成，主要关注结果是否稳定。'
                  : error
                    ? '接口异常，当前任务状态可能不完整。'
                    : cacheState?.degraded
                      ? '当前处于缓存模式，任务信息可能略旧。'
                      : '当前未见明显风险，可继续观察推进节奏。',
        updateText: ageText(task.lastActiveAgeMs),
        session: task.lastSession || null,
        agent: ownerAgent || { id: task.ownerAgentId, bootstrapPending: task.status === 'preparing', lastActiveAgeMs: task.lastActiveAgeMs },
        tokens: task.totalTokens || 0,
        context: task.latestContextPercent,
        writable: Boolean(task.writable),
        rawStatus: task.status || 'queued',
        allowedTransitions: task.allowedTransitions || [],
        updates: detailEvents.map((event, index) => ({
          sessionId: event.sessionId || `${task.id}-${index}`,
          age: task.lastSession?.age ?? task.lastActiveAgeMs ?? null,
          model: task.lastSession?.model || '模型待同步',
          totalTokens: task.totalTokens || 0,
          percentUsed: task.latestContextPercent,
          detail: event.detail,
          title: event.title,
          raw: event,
        })),
      }
    })
  }, [tasksData, taskDetail, taskEvents, selectedTask, agentCards, error, cacheState])

  useEffect(() => {
    if (!taskBoard.length) return
    const exists = taskBoard.some((item) => item.id === selectedTask)
    if (!exists) setSelectedTask(taskBoard[0].id)
  }, [taskBoard, selectedTask])

  const taskFilterOptions = [
    { key: 'all', label: '全部任务' },
    { key: 'executing', label: '推进中' },
    { key: 'attention', label: '需关注' },
    { key: 'idle', label: '待命' },
  ]

  const filteredTasks = useMemo(() => {
    return taskBoard.filter((task) => {
      if (taskFilter === 'executing') return task.statusTone === 'active' || task.statusTone === 'warm'
      if (taskFilter === 'attention') return task.statusTone === 'warn'
      if (taskFilter === 'idle') return task.statusTone === 'idle'
      return true
    })
  }, [taskBoard, taskFilter])

  const selectedTaskCard = useMemo(
    () => taskBoard.find((task) => task.id === selectedTask) || taskBoard[0] || null,
    [taskBoard, selectedTask],
  )

  useEffect(() => {
    if (!selectedTaskCard?.taskId || !selectedTaskCard.writable) {
      setTaskEditForm({ summary: '', status: 'queued', statusReason: '' })
      return
    }

    setTaskEditForm({
      summary: selectedTaskCard.current || '',
      status: selectedTaskCard.rawStatus || 'queued',
      statusReason: selectedTaskCard.statusReason || '',
    })
  }, [selectedTaskCard?.taskId, selectedTaskCard?.current, selectedTaskCard?.rawStatus, selectedTaskCard?.writable])

  const taskBreakdown = useMemo(() => taskStateBreakdown(taskBoard), [taskBoard])
  const taskTimeline = useMemo(() => buildTaskTimeline(taskBoard, selectedTask), [taskBoard, selectedTask])
  const runtimeBoard = useMemo(() => {
    const apiItems = runsData?.items || []
    if (!apiItems.length) {
      return buildRuntimeBoard(agentCards, Boolean(error), cacheState?.degraded)
    }

    return apiItems.map((item) => {
      const meta = {
        ...agentMeta(item.agentId),
        avatar: item.profile?.avatar || agentMeta(item.agentId).avatar,
        name: item.agentName || agentMeta(item.agentId).name,
        role: item.agentRole || agentMeta(item.agentId).role,
        style: item.profile?.style || agentMeta(item.agentId).style,
        mission: item.profile?.mission || agentMeta(item.agentId).mission,
      }

      const toneMap = {
        bootstrapping: 'warn',
        idle: 'idle',
        active: 'warm',
        running: 'active',
        high_pressure: 'warn',
      }
      const stateMap = {
        bootstrapping: 'pending',
        idle: 'idle',
        active: 'warm',
        running: 'active',
        high_pressure: 'active',
      }

      return {
        id: item.agentId,
        runId: item.id,
        agent: agentCards.find((agent) => agent.id === item.agentId) || null,
        meta,
        statusLabel: item.statusLabel,
        statusState: stateMap[item.status] || 'idle',
        riskLabel: item.riskLabel,
        riskTone: toneMap[item.status] || 'idle',
        tokens: item.totalTokens || 0,
        context: item.contextPercent,
        model: item.model || '-',
        resourceLevel: item.totalTokens >= 15000 ? '高资源消耗' : item.totalTokens >= 6000 ? '中等资源消耗' : item.totalTokens > 0 ? '轻量资源消耗' : '暂无明显资源消耗',
        contextText: item.contextPercent == null ? '上下文待同步' : item.contextPercent >= 85 ? `上下文 ${item.contextPercent}% · 已接近高压区` : item.contextPercent >= 70 ? `上下文 ${item.contextPercent}% · 进入注意区` : `上下文 ${item.contextPercent}% · 仍在安全区`,
        trajectory: item.summary,
        activeText: item.profile?.mission || currentTaskText(agentCards.find((agent) => agent.id === item.agentId) || {}),
        updatedAt: ageText(item.lastActiveAgeMs),
        updates: ((runDetail?.item?.id === item.id ? runEvents : item.events) || []).map((event) => ({
          sessionId: event.sessionId || event.id,
          age: event.at ? Date.now() - new Date(event.at).getTime() : null,
          model: item.model,
          totalTokens: item.totalTokens || 0,
          percentUsed: item.contextPercent,
          title: event.title,
          detail: event.detail,
          raw: event,
        })),
      }
    })
  }, [runsData, runDetail, runEvents, agentCards, error, cacheState])
  const runtimeFilterOptions = [
    { key: 'all', label: '全部运行单元' },
    { key: 'active', label: '活跃中' },
    { key: 'attention', label: '高风险' },
    { key: 'idle', label: '轻载 / 静默' },
  ]
  const filteredRuntime = useMemo(() => {
    return runtimeBoard.filter((item) => {
      if (runtimeFilter === 'active') return item.statusState === 'active' || item.statusState === 'warm'
      if (runtimeFilter === 'attention') return item.riskTone === 'warn'
      if (runtimeFilter === 'idle') return item.statusState === 'idle' || item.statusState === 'off'
      return true
    })
  }, [runtimeBoard, runtimeFilter])
  const selectedRuntimeCard = useMemo(
    () => runtimeBoard.find((item) => item.id === selectedAgent) || runtimeBoard[0] || null,
    [runtimeBoard, selectedAgent],
  )
  const runtimeTimeline = useMemo(
    () => buildRuntimeTimeline(selectedRuntimeCard, selectedSessions),
    [selectedRuntimeCard, selectedSessions],
  )
  const runtimeRiskCount = useMemo(
    () => runtimeBoard.filter((item) => item.riskTone === 'warn').length,
    [runtimeBoard],
  )
  const runtimeHotCount = useMemo(
    () => runtimeBoard.filter((item) => item.statusState === 'active' || item.statusState === 'warm').length,
    [runtimeBoard],
  )
  const hotAgents = agentCards.slice(0, 3)
  const primaryFocusAgent = useMemo(
    () => agentCards.find((agent) => (agent.lastActiveAgeMs ?? Infinity) < 5 * 60 * 1000) || agentCards.find((agent) => agent.bootstrapPending) || agentCards[0] || null,
    [agentCards],
  )
  const focusAgent = selectedAgentCard || primaryFocusAgent || null
  const focusMeta = focusAgent ? agentMeta(focusAgent.id) : agentMeta('main')
  const focusModel = focusAgent?.latestSession?.model || focusAgent?.model || summary.defaultModel || '-'
  const focusState = focusAgent ? getStatus(focusAgent.lastActiveAgeMs, focusAgent.bootstrapPending)[1] : 'off'
  const focusStatusText = focusAgent?.displayHeadline || (focusAgent ? roleTitle(focusState) : '当前暂无可见智能体状态')
  const focusSummaryText = focusAgent?.displaySummary
    || (focusAgent
      ? stateDescription(focusState)
      : '当前没有可展示的智能体状态，请等待数据刷新。')
  const selectedResponsibilities = agentDetail?.item?.responsibilities || selectedAgentCard?.displayResponsibilities || responsibilityItems(selectedAgentCard?.id)
  const selectedBehaviorText = agentDetail?.item?.behavior || selectedAgentCard?.displayBehavior || behaviorSummary(selectedAgentCard || {})
  const selectedHeadline = agentDetail?.item?.headline || selectedAgentCard?.displayHeadline || agentHeadline(selectedMeta, selectedStatus)
  const selectedSessionCount = selectedSessions.length || selectedAgentCard?.sessionsCount || selectedAgentCard?.sessions?.length || 0
  const activeFilterCount = filteredAgents.length

  const pageMeta = NAV_ITEMS.find((item) => item.key === activePage) || NAV_ITEMS[0]
  const pageSummary = pageCopy(pageMeta)
  const flowItems = NAV_ITEMS.filter((item) => CORE_PAGE_FLOW.includes(item.key))
  const currentFlowIndex = flowItems.findIndex((item) => item.key === activePage)
  const hierarchySummary = useMemo(
    () => hierarchyCards(summary, activeAgents, riskSignals, totalTokens, runtimeRiskCount),
    [summary, activeAgents, riskSignals, totalTokens, runtimeRiskCount],
  )
  const [overviewStateLabel, overviewStateTone] = overviewStatus(summary, error, cacheState?.degraded)
  const heroSummary = pageHeroSummary(activePage, selectedAgentCard, selectedTaskCard, focusMeta, selectedMeta)

  return (
    <div className="platform-shell">
      <div className="shell-grid">
        <aside className="sidebar-panel">
          <div className="brand">
            <div className="logo">✦</div>
            <div>
              <strong>智能体视界</strong>
              <small>智能体可视化平台</small>
            </div>
          </div>

          <h4>平台导航</h4>
          {NAV_ITEMS.map((item) => {
            const isCore = CORE_PAGE_FLOW.includes(item.key)
            return (
              <button
                key={item.key}
                className={`nav-item ${activePage === item.key ? 'active' : ''} ${isCore ? 'core' : 'extra'}`}
                onClick={() => setActivePage(item.key)}
              >
                <div className="nav-copy">
                  <b>{item.title}</b>
                  <span>{item.subtitle}</span>
                </div>
                <em>{item.level}</em>
              </button>
            )
          })}

          <div className="sidebar-flow-card">
            <div className="sidebar-spotlight-label">四层主路径</div>
            {flowItems.map((item, index) => (
              <button
                key={item.key}
                className={`flow-step ${activePage === item.key ? 'active' : ''} ${index < currentFlowIndex ? 'done' : ''}`}
                onClick={() => setActivePage(item.key)}
              >
                <div className="flow-step-index">{item.level}</div>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="sidebar-spotlight">
            <div className="sidebar-spotlight-label">当前焦点</div>
            <strong>{focusMeta.name}</strong>
            <p>{focusSummaryText}</p>
            <div className="sidebar-spotlight-meta">{focusMeta.role} · {focusMeta.style}</div>
            <div className={`pill ${statusTone(selectedStatus)}`}>{focusStatusText}</div>
          </div>

          <h4>热点智能体</h4>
          {hotAgents.length ? hotAgents.map((agent) => {
            const meta = agentMeta(agent.id)
            const [label, state] = getStatus(agent.lastActiveAgeMs, agent.bootstrapPending)
            return (
              <button
                key={agent.id}
                className={`agent-mini ${selectedAgent === agent.id ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedAgent(agent.id)
                  setActivePage('agents')
                }}
              >
                <div className="agent-mini-top">
                  <div className="agent-mini-name">
                    <div className="agent-mini-avatar" style={{ background: `${meta.color}1a`, color: meta.color }}>{meta.avatar}</div>
                    <div>
                      <strong>{meta.name}</strong>
                      <div className="tiny muted">{meta.role}</div>
                    </div>
                  </div>
                  <div className={`pill ${statusTone(state)}`}>{label}</div>
                </div>
                <div className="tiny muted">{roleTitle(state)}</div>
              </button>
            )
          }) : <EmptyState title="暂无智能体" hint="等待 /api/overview 返回智能体列表" />}
        </aside>

        <main className="main-panel">
          <section className="topbar-panel">
            <div className="title-block">
              <div className="header-badge">{pageSummary.title}</div>
              <h1>{pageSummary.title}</h1>
              <p>{pageSummary.description}</p>
            </div>
            <div className="toolbar">
              <div className="tool">默认模型：{summary.defaultModel || '-'}</div>
              <div className={`tool status-tool ${overviewStateTone}`}>平台：{overviewStateLabel}</div>
              <div className="tool">更新：{formatTime(lastUpdated)}</div>
              <button className="tool primary" onClick={() => load(false)} disabled={refreshing}>
                {refreshing ? '刷新中…' : '刷新视图'}
              </button>
            </div>
          </section>

          <section className="hierarchy-strip">
            <div className="hierarchy-hero">
              <span className="eyebrow">平台主路径</span>
              <strong>{heroSummary.title}</strong>
              <p>{heroSummary.text}</p>
            </div>
            <div className="hierarchy-grid">
              {hierarchySummary.map((item) => (
                <button
                  key={item.key}
                  className={`hierarchy-card ${activePage === item.key ? 'active' : ''}`}
                  onClick={() => setActivePage(item.key)}
                >
                  <div className="hierarchy-top">
                    <span className="hierarchy-level">{item.level}</span>
                    <strong>{item.title}</strong>
                  </div>
                  <p className="hierarchy-question">{item.question}</p>
                  <p className="hierarchy-answer">{item.answer}</p>
                </button>
              ))}
            </div>
          </section>

          {error ? <div className="banner banner-danger">数据请求失败：{error}</div> : null}
          {cacheState?.degraded && !error ? <div className="banner banner-warn">当前处于缓存 / 降级模式，数据可能不是最新。</div> : null}

          {activePage === 'overview' ? (
            <>
              <section className="page-switch-strip overview-switch-strip">
                <div className="page-switch-copy">
                  <span className="eyebrow">总览视角</span>
                  <strong>先给用户一个清晰入口：先看平台全貌，再顺着四层路径逐级下钻</strong>
                  <p>总览不再和智能体页、任务页、运行页抢主角。它只负责回答三个问题：整体状态如何、当前焦点是谁、下一步该进入哪一层。</p>
                </div>
                <div className="page-switch-meta">
                  <div className="switch-chip active">当前页：总览</div>
                  <div className="switch-chip">主路径：总览 → 智能体 → 任务 → 运行</div>
                </div>
              </section>

              <section className="hero-stage overview-hero-stage">
                <div className="hero-stage-main">
                  <div className="hero-stage-head hero-stage-head-deep">
                    <div className="hero-identity-band">
                      <div className="hero-agent-mark overview-mark" style={{ '--agent-color': focusMeta.color }}>
                        <div className="hero-agent-avatar">✦</div>
                        <div className="hero-agent-ring" />
                      </div>
                      <div>
                        <div className="eyebrow">总览入口</div>
                        <h2>现在平台整体怎么样</h2>
                        <strong className="hero-headline">先看总量、活跃、风险，再决定进入智能体层还是任务层</strong>
                        <p>这层只做全局判断：当前可见 {number(summary.totalAgents || agentCards.length)} 个智能体，活跃 {number(activeAgents)} 个，累计输出 {number(totalTokens)} 资源。</p>
                      </div>
                    </div>
                    <div className="hero-stage-status hero-stage-status-card">
                      <div className={`pill large ${overviewStateTone}`}>{overviewStateLabel}</div>
                      <span>{heroSummary.label}</span>
                      <div className="hero-status-meta">风险信号：{number(riskSignals)} · 自动刷新：15 秒</div>
                    </div>
                  </div>

                  <div className="hero-stage-grid hero-stage-grid-deep overview-hero-grid">
                    <div className="hero-stage-card summary-card summary-card-primary summary-card-deep">
                      <span className="hero-card-label">平台判断</span>
                      <strong>{error ? '当前优先恢复数据可见性' : cacheState?.degraded ? '当前先按缓存状态理解平台' : '当前平台可正常用于判断整体运行'}</strong>
                      <p>{error ? '接口异常会影响后续所有层级判断。' : cacheState?.degraded ? '缓存模式下可以看趋势，但不适合做高精度判断。' : '可以继续从总览进入智能体与任务层，做更细的观察。'}</p>
                      <div className="hero-inline-meta">
                        <span>默认模型：{summary.defaultModel || '-'}</span>
                        <span>当前焦点：{focusMeta.name}</span>
                        <span>最新更新：{formatTime(lastUpdated)}</span>
                      </div>
                    </div>
                    <div className="hero-stage-card overview-glance-card">
                      <span className="hero-card-label">当前焦点智能体</span>
                      <strong>{focusMeta.name}</strong>
                      <p>{focusSummaryText}</p>
                    </div>
                    <div className="hero-stage-card overview-glance-card">
                      <span className="hero-card-label">建议下一步</span>
                      <strong>{activeAgents > 0 ? '先进入智能体层看角色分工' : '先观察总览是否出现新的活跃信号'}</strong>
                      <p>{riskSignals > 0 ? '有风险信号，建议先看谁在承担压力。' : '风险较低，可以继续下钻。'}</p>
                    </div>
                    <div className="hero-stage-card overview-glance-card">
                      <span className="hero-card-label">当前任务线索</span>
                      <strong>{selectedTaskCard?.current || '等待任务进入可见队列'}</strong>
                      <p>{selectedTaskCard ? `负责人：${selectedTaskCard.owner}` : '总览先只给线索，不替代任务页。'}</p>
                    </div>
                    <div className="hero-stage-card overview-glance-card">
                      <span className="hero-card-label">四层关系</span>
                      <strong>总览看全局，智能体看角色，任务看推进，运行看底层</strong>
                      <p>四层职责已经拆开，不再混在一页里。</p>
                    </div>
                  </div>
                </div>

                <div className="hero-stage-side overview-hero-side">
                  <div className="section-mini-title">建议浏览顺序</div>
                  {flowItems.map((item, index) => (
                    <div className="journey-item" key={item.key}>
                      <div className="journey-time">{item.level}</div>
                      <div className="journey-line" />
                      <div className="journey-body">
                        <strong>{index + 1}. {item.title}</strong>
                        <p>{item.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="stats-grid softened-stats">
                <StatCard label="平台可见智能体" value={number(summary.totalAgents || agentCards.length)} hint="总览层先看规模与可见范围" />
                <StatCard label="当前活跃智能体" value={number(activeAgents)} hint="决定是否值得继续进入智能体层观察" />
                <StatCard label="风险信号" value={number(riskSignals)} hint="缓存 / 高占用 / 启动中等信号" />
                <StatCard label="最近累计输出" value={number(totalTokens)} hint="帮助判断任务层是否有明显推进" />
              </section>

              <section className="board-grid overview-board-grid">
                <section className="main-card-panel main-card-panel-wide">
                  <div className="section-head page-section-head">
                    <div>
                      <h2>四层总览卡</h2>
                      <p>先说明每层回答什么问题，再引导用户逐层进入。</p>
                    </div>
                  </div>

                  <div className="overview-layer-grid">
                    {hierarchySummary.map((item) => (
                      <button
                        key={item.key}
                        className={`overview-layer-card ${activePage === item.key ? 'active' : ''}`}
                        onClick={() => setActivePage(item.key)}
                      >
                        <div className="overview-layer-top">
                          <span>{item.level}</span>
                          <strong>{item.title}</strong>
                        </div>
                        <p className="overview-layer-question">{item.question}</p>
                        <p className="overview-layer-answer">{item.answer}</p>
                        <div className="action">进入这一层</div>
                      </button>
                    ))}
                  </div>

                  <div className="overview-focus-grid">
                    <div className="overview-focus-card">
                      <span className="hero-card-label">当前焦点智能体</span>
                      <strong>{focusMeta.name}</strong>
                      <p>{focusMeta.mission}</p>
                      <button className="ghost-link" onClick={() => navigateToLayer(setActivePage, { page: 'agents', setSelectedAgent, agentId: focusAgent?.id || 'main' })}>去看智能体详情</button>
                    </div>
                    <div className="overview-focus-card">
                      <span className="hero-card-label">当前焦点任务</span>
                      <strong>{selectedTaskCard?.type || '暂无任务'}</strong>
                      <p>{selectedTaskCard?.current || '等待任务形成可见推进。'}</p>
                      <button className="ghost-link" onClick={() => navigateToLayer(setActivePage, { page: 'tasks', setSelectedAgent, agentId: selectedTaskCard?.agent?.id || focusAgent?.id || 'main', setSelectedTask, taskId: selectedTaskCard?.id })}>去看任务推进</button>
                    </div>
                  </div>
                </section>

                <aside className="detail-card-panel detail-card-panel-sticky">
                  <div className="section-head detail-head">
                    <div>
                      <h3>总览说明</h3>
                      <p>这一栏不展开过多细节，只帮助用户快速决定下一步要去哪一层。</p>
                    </div>
                    <div className={`pill ${overviewStateTone}`}>{overviewStateLabel}</div>
                  </div>

                  <section className="detail-block detail-profile detail-profile-home">
                    <div className="detail-home-top">
                      <div className="detail-profile-top">
                        <div className="detail-avatar detail-avatar-large" style={{ color: focusMeta.color }}>✦</div>
                        <div>
                          <strong>总览只回答全局问题</strong>
                          <p>不和智能体页、任务页、运行页抢内容，避免四层页面各自为战。</p>
                        </div>
                      </div>
                      <div className={`pill large ${overviewStateTone}`}>L1</div>
                    </div>
                    <div className="detail-home-panels">
                      <div className="detail-home-panel">
                        <span>这一层看什么</span>
                        <strong>整体状态、当前焦点、下一步该进入哪一层。</strong>
                      </div>
                      <div className="detail-home-panel">
                        <span>不在这里做什么</span>
                        <strong>不在总览里堆满所有智能体详情和任务细节。</strong>
                      </div>
                    </div>
                  </section>

                  <section className="detail-block">
                    <h4>当前判断</h4>
                    <div className="detail-note-stack">
                      <div className="detail-note detail-note-strong">
                        <span>平台状态</span>
                        <strong>{overviewStateLabel}</strong>
                      </div>
                      <div className="detail-note">
                        <span>下一步建议</span>
                        <strong>{activeAgents > 0 ? '进入“智能体”层，看当前是谁在承担工作。' : '当前可先查看智能体层，确认各智能体的实际状态。'}</strong>
                      </div>
                      <div className="detail-note">
                        <span>任务提示</span>
                        <strong>{selectedTaskCard?.current || '暂无明确任务提示。'}</strong>
                      </div>
                    </div>
                  </section>
                </aside>
              </section>
            </>
          ) : activePage === 'agents' ? (
            <>
              <section className="page-switch-strip">
                <div className="page-switch-copy">
                  <span className="eyebrow">页面结构</span>
                  <strong>当前已进入第二层：智能体</strong>
                  <p>总览负责先看全局；进入这一层后，主区域专门回答“是谁在承担工作、状态如何、职责是什么”，并为任务层与运行层提供入口。</p>
                </div>
                <div className="page-switch-meta">
                  <div className="switch-chip active">当前页：L2 / 智能体</div>
                  <div className="switch-chip">上一层：总览 · 下一层：任务 / 运行</div>
                </div>
              </section>

              <section className="hero-stage agents-page-hero">
                <div className="hero-stage-main">
                  <div className="hero-stage-head hero-stage-head-deep">
                    <div className="hero-identity-band">
                      <div className="hero-agent-mark" style={{ '--agent-color': selectedMeta.color }}>
                        <div className="hero-agent-avatar">{selectedMeta.avatar}</div>
                        <div className="hero-agent-ring" />
                      </div>
                      <div>
                        <div className="eyebrow">当前聚焦智能体</div>
                        <h2>{focusMeta.name}</h2>
                        <strong className="hero-headline">{selectedHeadline}</strong>
                        <p>{focusMeta.mission}</p>
                      </div>
                    </div>
                    <div className="hero-stage-status hero-stage-status-card">
                      <div className={`pill large ${statusTone(selectedStatus)}`}>{selectedStatusLabel}</div>
                      <span>{focusStatusText}</span>
                      <div className="hero-status-meta">{focusMeta.role} · {focusMeta.style}</div>
                    </div>
                  </div>

                  <div className="hero-stage-grid hero-stage-grid-compact hero-stage-grid-deep">
                    <div className="hero-stage-card summary-card summary-card-primary summary-card-deep">
                      <span className="hero-card-label">身份摘要</span>
                      <strong>{focusSummaryText}</strong>
                      <p>最近活跃 {selectedLastActive} · 当前累计资源 {selectedTokens} · 上下文 {selectedContext}</p>
                      <div className="hero-inline-meta">
                        <span>{focusModel}</span>
                        <span>{selectedSessionCount} 个会话</span>
                        <span>{activeFilterCount} 个智能体正在当前视图中</span>
                      </div>
                    </div>
                    <div className="hero-stage-card identity-card">
                      <span className="hero-card-label">职责定位</span>
                      <strong>{focusMeta.role}</strong>
                      <p>{focusMeta.capability}</p>
                    </div>
                    <div className="hero-stage-card mission-card">
                      <span className="hero-card-label">当前任务</span>
                      <strong>{currentTaskText(focusAgent || {})}</strong>
                      <p>{runtimeSignal(focusAgent || {})}</p>
                    </div>
                    <div className="hero-stage-card signal-card">
                      <span className="hero-card-label">近期行为</span>
                      <strong>{selectedBehaviorText}</strong>
                      <p>{focusMeta.style} · 当前视图已接入实时刷新状态</p>
                    </div>
                    <div className="hero-stage-card responsibility-card">
                      <span className="hero-card-label">职责清单</span>
                      <div className="responsibility-list">
                        {selectedResponsibilities.map((item) => (
                          <div className="responsibility-item" key={item}>{item}</div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="hero-stage-side hero-stage-side-home">
                  <div className="section-mini-title">运行轨迹摘要</div>
                  {selectedJourney.map((item) => (
                    <div className="journey-item" key={item.key}>
                      <div className="journey-time">{item.time}</div>
                      <div className="journey-line" />
                      <div className="journey-body">
                        <strong>{item.title}</strong>
                        <p>{item.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="stats-grid softened-stats">
                <StatCard label="智能体总数" value={number(summary.totalAgents || agentCards.length)} hint="当前可见智能体总数" />
                <StatCard label="当前活跃" value={number(activeAgents)} hint="最近 5 分钟持续活跃的智能体" />
                <StatCard label="风险信号" value={number(riskSignals)} hint="缓存 / 高占用 / 启动中等信号" />
                <StatCard label="累计输出" value={number(totalTokens)} hint="最近会话累计生成资源" />
              </section>

              <section className="board-grid agents-board-grid">
                <section className="main-card-panel main-card-panel-wide">
                  <div className="section-head page-section-head">
                    <div>
                      <h2>智能体矩阵</h2>
                      <p>先浏览角色矩阵，再决定进入任务层还是运行层。</p>
                    </div>
                    <div className="tabs">
                      {agentFilterOptions.map((item) => (
                        <button
                          key={item.key}
                          className={`tab ${agentFilter === item.key ? 'active' : ''}`}
                          onClick={() => setAgentFilter(item.key)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {filteredAgents.length ? (
                    <div className="agent-grid agent-grid-wide">
                      {filteredAgents.map((agent) => {
                        const meta = agentMeta(agent.id)
                        const [label, state] = getStatus(agent.lastActiveAgeMs, agent.bootstrapPending)
                        const currentModel = agent.latestSession?.model || agent.model || '-'
                        const contextText = agent.latestSession?.percentUsed != null ? `${agent.latestSession.percentUsed}%` : '—'
                        const isHero = agent.id === selectedAgent
                        return (
                          <button
                            key={agent.id}
                            className={`agent-card ${isHero ? 'hero selected' : ''}`}
                            onClick={() => setSelectedAgent(agent.id)}
                          >
                            <div className="agent-top">
                              <div className="agent-identity">
                                <div className="avatar" style={{ color: meta.color }}>{meta.avatar}</div>
                                <div>
                                  <strong>{meta.name}</strong>
                                  <span>{meta.role}</span>
                                </div>
                              </div>
                              <div className={`pill ${statusTone(state)}`}>{label}</div>
                            </div>

                            <div className="card-priority-block">
                              <span className="story-label">当前判断</span>
                              <strong>{agentHeadline(meta, state, agent)}</strong>
                              <p>{stateDescription(state)}</p>
                            </div>

                            <div className="agent-story-block">
                              <div>
                                <span className="story-label">职责</span>
                                <p>{meta.mission}</p>
                              </div>
                              <div>
                                <span className="story-label">当前任务</span>
                                <p>{currentTaskText(agent)}</p>
                              </div>
                              <div>
                                <span className="story-label">近期行为</span>
                                <p>{behaviorSummary(agent)}</p>
                              </div>
                            </div>

                            <div className="summary-block summary-chip-row">
                              <div className="summary-chip">最近活跃：{ageText(agent.lastActiveAgeMs)}</div>
                              <div className="summary-chip">会话数：{number(agent.sessions.length || agent.sessionsCount || 0)}</div>
                              <div className="summary-chip">累计资源：{number(agent.totalTokens)}</div>
                            </div>

                            <div className="glow-line" />

                            <div className="metric-row compact-metric-row">
                              <div className="metric-box"><span>模型</span><strong>{currentModel}</strong></div>
                              <div className="metric-box"><span>职责风格</span><strong>{meta.style}</strong></div>
                              <div className="metric-box"><span>上下文</span><strong>{contextText}</strong></div>
                            </div>

                            <div className="card-foot">
                              <div className={`risk ${agent.latestSession?.percentUsed >= 80 ? 'danger' : ''}`}>
                                {agent.bootstrapPending
                                  ? '⚠ 启动中'
                                  : agent.latestSession?.percentUsed >= 80
                                    ? '⚠ 上下文偏高'
                                    : isHero
                                      ? '◎ 当前选中'
                                      : '✓ 运行平稳'}
                              </div>
                              <div className="action-row">
                                <button
                                  type="button"
                                  className="ghost-link compact-link"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    const linkedTask = taskBoard.find((item) => item.agent?.id === agent.id || item.id === selectedTask)
                                    navigateToLayer(setActivePage, { page: 'tasks', setSelectedAgent, agentId: agent.id, setSelectedTask, taskId: linkedTask?.id })
                                  }}
                                >
                                  看任务
                                </button>
                                <button
                                  type="button"
                                  className="ghost-link compact-link"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    navigateToLayer(setActivePage, { page: 'runtime', setSelectedAgent, agentId: agent.id })
                                  }}
                                >
                                  看运行
                                </button>
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <EmptyState title="当前筛选下暂无智能体" hint="可以切回全部查看完整矩阵。" />
                  )}
                </section>

                <aside className="detail-card-panel detail-card-panel-sticky">
                  <div className="section-head detail-head">
                    <div>
                      <h3>智能体详情</h3>
                      <p>右侧详情区聚焦当前选中智能体的身份、职责与运行轨迹。</p>
                    </div>
                    <div className={`pill ${statusTone(selectedStatus)}`}>{selectedMeta.name}</div>
                  </div>

                  <section className="detail-block detail-profile detail-profile-home">
                    <div className="detail-home-top">
                      <div className="detail-profile-top">
                        <div className="detail-avatar detail-avatar-large" style={{ color: selectedMeta.color }}>{selectedMeta.avatar}</div>
                        <div>
                          <strong>{selectedMeta.name}</strong>
                          <p>{selectedMeta.mission}</p>
                        </div>
                      </div>
                      <div className={`pill large ${statusTone(selectedStatus)}`}>{selectedStatusLabel}</div>
                    </div>
                    <div className="detail-profile-tags">
                      <span>{selectedMeta.role}</span>
                      <span>{selectedMeta.style}</span>
                      <span>{focusModel}</span>
                    </div>
                    <div className="detail-home-panels">
                      <div className="detail-home-panel">
                        <span>当前身份感</span>
                        <strong>{selectedHeadline}</strong>
                      </div>
                      <div className="detail-home-panel">
                        <span>近期行为判断</span>
                        <strong>{selectedBehaviorText}</strong>
                      </div>
                    </div>
                  </section>

                  <section className="detail-block">
                    <h4>基础信息</h4>
                    <div className="list">
                      {rightDetailRows.slice(0, 5).map((item) => (
                        <div className="line" key={item.label}><span className="muted">{item.label}</span><strong>{item.value}</strong></div>
                      ))}
                    </div>
                  </section>

                  <section className="detail-block">
                    <h4>运行数据</h4>
                    <div className="list">
                      {rightDetailRows.slice(5).map((item) => (
                        <div className="line" key={item.label}><span className="muted">{item.label}</span><strong>{item.value}</strong></div>
                      ))}
                    </div>
                  </section>

                  <section className="detail-block detail-task-focus">
                    <h4>当前任务解读</h4>
                    <div className="detail-note-stack">
                      <div className="detail-note detail-note-strong">
                        <span>当前任务</span>
                        <strong>{currentTaskText(selectedAgentCard || {})}</strong>
                      </div>
                      <div className="detail-note">
                        <span>运行判断</span>
                        <strong>{runtimeSignal(selectedAgentCard || {})}</strong>
                      </div>
                      <div className="detail-note">
                        <span>近期行为</span>
                        <strong>{selectedBehaviorText}</strong>
                      </div>
                    </div>
                  </section>

                  <section className="detail-block">
                    <h4>职责主页</h4>
                    <div className="detail-note-stack">
                      <div className="detail-note">
                        <span>核心职责</span>
                        <strong>{selectedMeta.mission}</strong>
                      </div>
                      <div className="detail-note">
                        <span>能力倾向</span>
                        <strong>{selectedMeta.capability}</strong>
                      </div>
                    </div>
                    <div className="detail-duty-list">
                      {selectedResponsibilities.map((item) => (
                        <div className="detail-duty-item" key={item}>{item}</div>
                      ))}
                    </div>
                  </section>

                  <section className="detail-block">
                    <h4>最近行为时间线</h4>
                    {selectedTimeline.length ? (
                      <div className="timeline">
                        {selectedTimeline.map((item) => (
                          <button key={item.key} className="timeline-item" onClick={() => setSelectedSession(item.raw)}>
                            <div className="tiny muted">{item.time}</div>
                            <div className="dot" />
                            <div>
                              <strong>{item.title}</strong>
                              <div className="tiny muted">{item.detail}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <EmptyState title="暂无时间线" hint="等待该智能体产生可见会话。" />
                    )}
                  </section>

                  <section className="detail-block">
                    <h4>模型分布</h4>
                    {modelBars.length ? (
                      <div className="usage-list compact-usage">
                        {modelBars.slice(0, 4).map((item) => {
                          const max = Math.max(...modelBars.map((entry) => entry.value || 0), 1)
                          return (
                            <div className="usage-row" key={item.label}>
                              <div className="usage-row-top">
                                <span>{item.label}</span>
                                <strong>{number(item.value)}</strong>
                              </div>
                              <div className="usage-track">
                                <div className="usage-fill" style={{ width: `${Math.max((item.value / max) * 100, 6)}%` }} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <EmptyState title="暂无模型统计" />
                    )}
                  </section>
                </aside>
              </section>
            </>
          ) : activePage === 'tasks' ? (
            <>
              <section className="page-switch-strip task-switch-strip">
                <div className="page-switch-copy">
                  <span className="eyebrow">任务视角</span>
                  <strong>当前已进入第三层：任务</strong>
                  <p>任务页已优先接入真实 task 数据 v1，用最小后端语义对象回答“现在在做什么、谁在做、推进到哪”，并自然衔接到运行层。</p>
                </div>
                <div className="page-switch-meta">
                  <div className="switch-chip active">当前页：L3 / 任务</div>
                  <div className="switch-chip">上一层：智能体 · 下一层：运行</div>
                </div>
              </section>

              <section className="hero-stage task-hero-stage">
                <div className="hero-stage-main">
                  <div className="hero-stage-head hero-stage-head-deep">
                    <div className="hero-identity-band">
                      <div className="hero-agent-mark task-agent-mark" style={{ '--agent-color': selectedTaskCard?.meta?.color || '#39d0ff' }}>
                        <div className="hero-agent-avatar">{selectedTaskCard?.meta?.avatar || '🧩'}</div>
                        <div className="hero-agent-ring" />
                      </div>
                      <div>
                        <div className="eyebrow">当前焦点任务</div>
                        <h2>{selectedTaskCard ? `${selectedTaskCard.type} · ${selectedTaskCard?.meta?.name || '任务'}` : '暂无任务'}</h2>
                        <strong className="hero-headline">{selectedTaskCard?.current || '等待任务进入可见队列'}</strong>
                        <p>{selectedTaskCard ? `负责人：${selectedTaskCard.owner} · 当前阶段：${selectedTaskCard.stage} · 优先级：${selectedTaskCard.priority}` : '等待 overview 返回可见任务数据。'}</p>
                      </div>
                    </div>
                    <div className="hero-stage-status hero-stage-status-card">
                      <div className={`pill large ${selectedTaskCard ? selectedTaskCard.statusTone : 'idle'}`}>{selectedTaskCard?.statusLabel || '待分配'}</div>
                      <span>{selectedTaskCard?.risk || '当前没有可见风险提示。'}</span>
                      <div className="hero-status-meta">最近推进：{selectedTaskCard?.updateText || '等待更新'}</div>
                    </div>
                  </div>

                  <div className="hero-stage-grid hero-stage-grid-deep task-hero-grid">
                    <div className="hero-stage-card summary-card summary-card-primary summary-card-deep">
                      <span className="hero-card-label">任务总览</span>
                      <strong>{selectedTaskCard?.progress || '等待任务形成推进信号。'}</strong>
                      <p>{selectedTaskCard?.risk || '当前未见明显风险，可继续观察。'}</p>
                      <div className="hero-inline-meta">
                        <span>负责人：{selectedTaskCard?.meta?.name || '待定'}</span>
                        <span>上下文：{selectedTaskCard?.context != null ? `${selectedTaskCard.context}%` : '—'}</span>
                        <span>累计资源：{number(selectedTaskCard?.tokens || 0)}</span>
                      </div>
                    </div>
                    <div className="hero-stage-card task-glance-card">
                      <span className="hero-card-label">当前在做什么</span>
                      <strong>{selectedTaskCard?.current || '暂无可见任务说明'}</strong>
                      <p>当前阶段：{selectedTaskCard?.stage || '排队中'} · 类型：{selectedTaskCard?.type || '通用任务'}</p>
                    </div>
                    <div className="hero-stage-card task-glance-card">
                      <span className="hero-card-label">谁在做</span>
                      <strong>{selectedTaskCard?.owner || '待分配'}</strong>
                      <p>{selectedTaskCard?.meta?.mission || '等待任务负责人进入视图。'}</p>
                    </div>
                    <div className="hero-stage-card task-glance-card">
                      <span className="hero-card-label">任务状态</span>
                      <strong>{selectedTaskCard?.statusLabel || '待观察'}</strong>
                      <p>优先级：{selectedTaskCard?.priority || 'P3 / 待命观察'}</p>
                    </div>
                    <div className="hero-stage-card task-glance-card">
                      <span className="hero-card-label">风险提示</span>
                      <strong>{selectedTaskCard?.risk || '暂无风险'}</strong>
                      <p>系统会随 15 秒自动刷新一起更新任务判断。</p>
                    </div>
                  </div>
                </div>

                <div className="hero-stage-side task-hero-side">
                  <div className="section-mini-title">最近推进</div>
                  {taskTimeline.length ? taskTimeline.map((item) => (
                    <div className="journey-item" key={item.key}>
                      <div className="journey-time">{item.time}</div>
                      <div className="journey-line" />
                      <div className="journey-body">
                        <strong>{item.title}</strong>
                        <p>{item.detail}</p>
                      </div>
                    </div>
                  )) : <EmptyState title="暂无推进记录" hint="等待任务产生可见更新。" />}
                </div>
              </section>

              <section className="stats-grid softened-stats">
                <StatCard label="可见任务" value={number(taskBoard.length)} hint="优先来自 /api/tasks 的真实任务数" />
                <StatCard label="推进中" value={number(taskBreakdown.executing)} hint="当前仍在连续推进的任务" />
                <StatCard label="需关注" value={number(taskRiskCount(taskBoard))} hint="高占用 / 异常 / 缓存等风险提示" />
                <StatCard label="待命中" value={number(taskBreakdown.idle)} hint="当前没有明显推进动作的任务" />
              </section>

              <section className="task-write-strip">
                <div className="task-write-card task-write-card-create">
                  <div className="task-write-head">
                    <div>
                      <span className="eyebrow">最小写入口</span>
                      <strong>新建手工任务</strong>
                      <p>只补最值入口：补一条手工任务，让任务页可以开始写。</p>
                    </div>
                    <div className="task-write-pill">POST /api/tasks</div>
                  </div>

                  <div className="task-write-grid">
                    <label className="field">
                      <span>任务标题</span>
                      <input
                        value={taskForm.title}
                        onChange={(event) => setTaskForm((prev) => ({ ...prev, title: event.target.value }))}
                        placeholder="例如：补任务页最小写入口"
                      />
                    </label>
                    <label className="field">
                      <span>负责人</span>
                      <select
                        value={taskForm.ownerAgentId}
                        onChange={(event) => setTaskForm((prev) => ({ ...prev, ownerAgentId: event.target.value }))}
                      >
                        {agentCards.map((agent) => (
                          <option key={agent.id} value={agent.id}>{agentMeta(agent.id).name}</option>
                        ))}
                        <option value="main">龙龙</option>
                      </select>
                    </label>
                    <label className="field field-wide">
                      <span>任务摘要</span>
                      <textarea
                        rows="3"
                        value={taskForm.summary}
                        onChange={(event) => setTaskForm((prev) => ({ ...prev, summary: event.target.value }))}
                        placeholder="一句话写清当前要推进什么"
                      />
                    </label>
                    <label className="field field-wide">
                      <span>状态原因</span>
                      <textarea
                        rows="2"
                        value={taskForm.statusReason}
                        onChange={(event) => setTaskForm((prev) => ({ ...prev, statusReason: event.target.value }))}
                        placeholder="如果是 blocked / paused，可以顺手写清原因"
                      />
                    </label>
                    <label className="field">
                      <span>状态</span>
                      <select
                        value={taskForm.status}
                        onChange={(event) => setTaskForm((prev) => ({ ...prev, status: event.target.value }))}
                      >
                        <option value="queued">排队中</option>
                        <option value="preparing">准备中</option>
                        <option value="in_progress">处理中</option>
                        <option value="running">深度执行中</option>
                        <option value="blocked">阻塞中</option>
                        <option value="paused">已暂停</option>
                        <option value="done">已完成</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>优先级</span>
                      <select
                        value={taskForm.priority}
                        onChange={(event) => setTaskForm((prev) => ({ ...prev, priority: event.target.value }))}
                      >
                        <option value="P0">P0</option>
                        <option value="P1">P1</option>
                        <option value="P2">P2</option>
                        <option value="P3">P3</option>
                      </select>
                    </label>
                  </div>

                  <div className="task-write-actions">
                    <button className="tool primary" onClick={createManualTask} disabled={taskSaving}>
                      {taskSaving ? '提交中…' : '新建手工任务'}
                    </button>
                    <div className="task-write-hint">新建后会出现在任务列表，并自动变成可编辑任务。</div>
                  </div>
                </div>

                <div className="task-write-card task-write-card-edit">
                  <div className="task-write-head">
                    <div>
                      <span className="eyebrow">手工任务编辑</span>
                      <strong>{selectedTaskCard?.writable ? '更新当前手工任务' : '当前任务不可编辑'}</strong>
                      <p>{selectedTaskCard?.writable ? '仅支持更新摘要和状态，避免把任务页做重。' : '只对 writable=true 的手工任务显示编辑能力。'}</p>
                    </div>
                    <div className={`task-write-pill ${selectedTaskCard?.writable ? 'is-live' : ''}`}>{selectedTaskCard?.writable ? 'writable=true' : '只读任务'}</div>
                  </div>

                  {selectedTaskCard?.writable ? (
                    <>
                      <div className="task-write-grid">
                        <label className="field field-wide">
                          <span>任务摘要</span>
                          <textarea
                            rows="4"
                            value={taskEditForm.summary}
                            onChange={(event) => setTaskEditForm((prev) => ({ ...prev, summary: event.target.value }))}
                            placeholder="补充当前手工任务摘要"
                          />
                        </label>
                        <label className="field field-wide">
                          <span>状态原因</span>
                          <textarea
                            rows="3"
                            value={taskEditForm.statusReason}
                            onChange={(event) => setTaskEditForm((prev) => ({ ...prev, statusReason: event.target.value }))}
                            placeholder="例如：依赖接口未返回 / 等待确认 / 人工暂停原因"
                          />
                        </label>
                        <label className="field">
                          <span>状态</span>
                          <select
                            value={taskEditForm.status}
                            onChange={(event) => setTaskEditForm((prev) => ({ ...prev, status: event.target.value }))}
                          >
                            <option value={selectedTaskCard?.rawStatus || 'queued'}>{taskStatusMeta(selectedTaskCard?.rawStatus || 'queued')[0]}（当前）</option>
                            {(selectedTaskCard?.allowedTransitions || allowedTaskTransitions(selectedTaskCard?.rawStatus || 'queued')).map((status) => (
                              <option key={status} value={status}>{taskStatusMeta(status)[0]}</option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="task-write-actions">
                        <button className="tool primary" onClick={() => updateManualTask(selectedTaskCard.taskId)} disabled={taskSaving}>
                          {taskSaving ? '保存中…' : '保存当前任务'}
                        </button>
                        <div className="task-write-hint">当前选中：{selectedTaskCard.type}</div>
                      </div>
                    </>
                  ) : (
                    <div className="task-write-readonly">
                      <strong>当前选中任务来自运行态推导</strong>
                      <p>为了不破坏现有结构，这类任务保持只读。请先新建一个手工任务，再在这里更新摘要或状态。</p>
                    </div>
                  )}
                </div>
              </section>

              {taskActionMessage ? <div className="banner banner-info">{taskActionMessage}</div> : null}

              <section className="board-grid task-board-grid">
                <section className="main-card-panel main-card-panel-wide">
                  <div className="section-head page-section-head">
                    <div>
                      <h2>任务列表</h2>
                      <p>先看当前在做什么、由谁推进，再决定是否进入运行层。</p>
                    </div>
                    <div className="tabs">
                      {taskFilterOptions.map((item) => (
                        <button
                          key={item.key}
                          className={`tab ${taskFilter === item.key ? 'active' : ''}`}
                          onClick={() => setTaskFilter(item.key)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {filteredTasks.length ? (
                    <div className="task-grid">
                      {filteredTasks.map((task) => (
                        <button
                          key={task.id}
                          className={`task-card ${selectedTask === task.id ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedTask(task.id)
                            if (task.agent?.id) setSelectedAgent(task.agent.id)
                          }}
                        >
                          <div className="task-card-top">
                            <div className="task-owner-mark" style={{ background: `${task.meta.color}1a`, color: task.meta.color }}>{task.meta.avatar}</div>
                            <div className="task-card-title-group">
                              <div className="task-card-eyebrow">{task.type}</div>
                              <strong>{task.meta.name} 的当前任务</strong>
                              <span>{task.owner}</span>
                            </div>
                            <div className={`pill ${task.statusTone}`}>{task.statusLabel}</div>
                          </div>

                          <div className="task-card-body">
                            <div className="task-card-section">
                              <span className="story-label">当前在做什么</span>
                              <strong>{task.current}</strong>
                            </div>
                            <div className="task-card-section two-col">
                              <div>
                                <span className="story-label">最近推进</span>
                                <p>{task.progress}</p>
                              </div>
                              <div>
                                <span className="story-label">状态原因</span>
                                <p>{task.statusReason || task.risk}</p>
                              </div>
                            </div>
                          </div>

                          <div className="task-chip-row">
                            <div className="summary-chip">阶段：{task.stage}</div>
                            <div className="summary-chip">优先级：{task.priority}</div>
                            <div className="summary-chip">最近更新：{task.updateText}</div>
                          </div>

                          <div className="glow-line" />

                          <div className="task-metric-row">
                            <div className="metric-box"><span>累计资源</span><strong>{number(task.tokens)}</strong></div>
                            <div className="metric-box"><span>上下文</span><strong>{task.context != null ? `${task.context}%` : '—'}</strong></div>
                            <div className="metric-box"><span>最近会话</span><strong>{number(task.updates.length)}</strong></div>
                          </div>

                          <div className="card-foot card-foot-task">
                            <div className={`risk ${task.statusTone === 'warn' ? 'danger' : ''}`}>
                              {selectedTask === task.id ? '◎ 当前选中' : '→ 可继续下钻'}
                            </div>
                            <div className="action-row">
                              <button
                                type="button"
                                className="ghost-link compact-link"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  navigateToLayer(setActivePage, { page: 'agents', setSelectedAgent, agentId: task.agent?.id || 'main' })
                                }}
                              >
                                看智能体
                              </button>
                              <button
                                type="button"
                                className="ghost-link compact-link"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  navigateToLayer(setActivePage, { page: 'runtime', setSelectedAgent, agentId: task.agent?.id || 'main', setSelectedTask, taskId: task.id })
                                }}
                              >
                                看运行
                              </button>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="当前筛选下暂无任务" hint="可以切回全部任务查看完整列表。" />
                  )}
                </section>

                <aside className="detail-card-panel detail-card-panel-sticky">
                  <div className="section-head detail-head">
                    <div>
                      <h3>任务详情</h3>
                      <p>右侧详情区专门回答：谁在做、做到哪、最近怎么推进、当前有什么风险。</p>
                    </div>
                    <div className={`pill ${selectedTaskCard ? selectedTaskCard.statusTone : 'idle'}`}>{selectedTaskCard?.meta?.name || '任务'}</div>
                  </div>

                  <section className="detail-block detail-profile task-detail-profile">
                    <div className="detail-home-top">
                      <div className="detail-profile-top">
                        <div className="detail-avatar detail-avatar-large" style={{ color: selectedTaskCard?.meta?.color || '#39d0ff' }}>
                          {selectedTaskCard?.meta?.avatar || '🧩'}
                        </div>
                        <div>
                          <strong>{selectedTaskCard ? `${selectedTaskCard.type} · ${selectedTaskCard?.meta?.name || '任务'}` : '暂无任务'}</strong>
                          <p>{selectedTaskCard?.current || '等待任务进入当前视图。'}</p>
                        </div>
                      </div>
                      <div className={`pill large ${selectedTaskCard ? selectedTaskCard.statusTone : 'idle'}`}>{selectedTaskCard?.statusLabel || '待观察'}</div>
                    </div>
                    <div className="detail-profile-tags">
                      <span>{selectedTaskCard?.owner || '待分配'}</span>
                      <span>{selectedTaskCard?.stage || '排队中'}</span>
                      <span>{selectedTaskCard?.priority || 'P3 / 待命观察'}</span>
                    </div>
                  </section>

                  <section className="detail-block">
                    <h4>任务信息</h4>
                    <div className="list">
                      <div className="line"><span className="muted">负责人</span><strong>{selectedTaskCard?.owner || '待分配'}</strong></div>
                      <div className="line"><span className="muted">任务类型</span><strong>{selectedTaskCard?.type || '通用任务'}</strong></div>
                      <div className="line"><span className="muted">当前阶段</span><strong>{selectedTaskCard?.stage || '排队中'}</strong></div>
                      <div className="line"><span className="muted">当前状态</span><strong>{selectedTaskCard?.statusLabel || '待观察'}</strong></div>
                      <div className="line"><span className="muted">最近更新</span><strong>{selectedTaskCard?.updateText || '等待更新'}</strong></div>
                    </div>
                  </section>

                  <section className="detail-block">
                    <h4>推进判断</h4>
                    <div className="detail-note-stack">
                      <div className="detail-note detail-note-strong">
                        <span>当前在做什么</span>
                        <strong>{selectedTaskCard?.current || '暂无可见推进说明。'}</strong>
                      </div>
                      <div className="detail-note">
                        <span>最近推进</span>
                        <strong>{selectedTaskCard?.progress || '暂无最近推进记录。'}</strong>
                      </div>
                      <div className="detail-note">
                        <span>风险提示</span>
                        <strong>{selectedTaskCard?.risk || '暂无风险提示。'}</strong>
                      </div>
                      <div className="detail-note">
                        <span>状态原因</span>
                        <strong>{selectedTaskCard?.statusReason || '当前没有补充状态原因。'}</strong>
                      </div>
                      <div className="detail-note">
                        <span>允许迁移到</span>
                        <strong>{(selectedTaskCard?.allowedTransitions || []).length ? selectedTaskCard.allowedTransitions.map((status) => taskStatusMeta(status)[0]).join(' / ') : '当前状态不可继续迁移'}</strong>
                      </div>
                    </div>
                  </section>

                  <section className="detail-block">
                    <h4>最近推进时间线</h4>
                    {taskTimeline.length ? (
                      <div className="timeline">
                        {taskTimeline.map((item) => (
                          <button key={item.key} className="timeline-item" onClick={() => item.raw && setSelectedSession(item.raw)}>
                            <div className="tiny muted">{item.time}</div>
                            <div className="dot" />
                            <div>
                              <strong>{item.title}</strong>
                              <div className="tiny muted">{item.detail}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <EmptyState title="暂无时间线" hint="等待任务产生新的推进记录。" />
                    )}
                  </section>

                  <section className="detail-block">
                    <h4>任务资源</h4>
                    <div className="task-resource-grid">
                      <div className="metric-box"><span>累计资源</span><strong>{number(selectedTaskCard?.tokens || 0)}</strong></div>
                      <div className="metric-box"><span>上下文</span><strong>{selectedTaskCard?.context != null ? `${selectedTaskCard.context}%` : '—'}</strong></div>
                    </div>
                  </section>
                </aside>
              </section>
            </>
          ) : activePage === 'runtime' ? (
            <>
              <section className="page-switch-strip runtime-switch-strip">
                <div className="page-switch-copy">
                  <span className="eyebrow">运行视角</span>
                  <strong>当前已进入第四层：运行</strong>
                  <p>直接复用 agents / recentSessions / summary / cacheState / agentDetail 数据，把四层路径最后一层统一成“底层运行观察”：看活跃状态、上下文占用、风险信号、资源消耗和运行轨迹。</p>
                </div>
                <div className="page-switch-meta">
                  <div className="switch-chip active">当前页：L4 / 运行</div>
                  <div className="switch-chip">上一层：任务 · 保持 15 秒自动刷新</div>
                </div>
              </section>

              <section className="hero-stage runtime-hero-stage">
                <div className="hero-stage-main">
                  <div className="hero-stage-head hero-stage-head-deep">
                    <div className="hero-identity-band">
                      <div className="hero-agent-mark runtime-agent-mark" style={{ '--agent-color': selectedRuntimeCard?.meta?.color || '#39d0ff' }}>
                        <div className="hero-agent-avatar">{selectedRuntimeCard?.meta?.avatar || '⚙️'}</div>
                        <div className="hero-agent-ring" />
                      </div>
                      <div>
                        <div className="eyebrow">当前运行焦点</div>
                        <h2>{selectedRuntimeCard ? `${selectedRuntimeCard?.meta?.name || '运行单元'} · 运行单元` : '暂无运行单元'}</h2>
                        <strong className="hero-headline">{selectedRuntimeCard?.trajectory || '等待新的运行信号进入视图。'}</strong>
                        <p>{selectedRuntimeCard ? `${selectedRuntimeCard?.meta?.role || '运行角色'} · ${selectedRuntimeCard.activeText}` : '等待 overview 提供可见运行数据。'}</p>
                      </div>
                    </div>
                    <div className="hero-stage-status hero-stage-status-card">
                      <div className={`pill large ${selectedRuntimeCard ? selectedRuntimeCard.riskTone : 'idle'}`}>{selectedRuntimeCard?.riskLabel || '待观察'}</div>
                      <span>{selectedRuntimeCard?.contextText || '上下文占用待同步'}</span>
                      <div className="hero-status-meta">最近活动：{selectedRuntimeCard?.updatedAt || '等待更新'}</div>
                    </div>
                  </div>

                  <div className="hero-stage-grid hero-stage-grid-deep runtime-hero-grid">
                    <div className="hero-stage-card summary-card summary-card-primary summary-card-deep runtime-summary-card">
                      <span className="hero-card-label">运行总览</span>
                      <strong>{selectedRuntimeCard?.resourceLevel || '暂无运行负载判断'}</strong>
                      <p>{selectedRuntimeCard?.trajectory || '等待形成连续运行轨迹后再做判断。'}</p>
                      <div className="hero-inline-meta">
                        <span>活跃单元：{number(runtimeHotCount)}</span>
                        <span>高风险信号：{number(runtimeRiskCount)}</span>
                        <span>累计资源：{number(totalTokens)}</span>
                      </div>
                    </div>
                    <div className="hero-stage-card runtime-glance-card">
                      <span className="hero-card-label">活跃状态</span>
                      <strong>{selectedRuntimeCard?.statusLabel || '待观察'}</strong>
                      <p>{selectedRuntimeCard?.activeText || '暂无当前运行说明。'}</p>
                    </div>
                    <div className="hero-stage-card runtime-glance-card">
                      <span className="hero-card-label">上下文占用</span>
                      <strong>{selectedRuntimeCard?.context != null ? `${selectedRuntimeCard.context}%` : '—'}</strong>
                      <p>{selectedRuntimeCard?.contextText || '上下文待同步。'}</p>
                    </div>
                    <div className="hero-stage-card runtime-glance-card">
                      <span className="hero-card-label">风险信号</span>
                      <strong>{selectedRuntimeCard?.riskLabel || '暂无风险'}</strong>
                      <p>{selectedRuntimeCard?.riskTone === 'warn' ? '建议继续紧盯下一轮刷新变化。' : '当前未见明显运行阻塞。'}</p>
                    </div>
                    <div className="hero-stage-card runtime-glance-card">
                      <span className="hero-card-label">资源消耗</span>
                      <strong>{number(selectedRuntimeCard?.tokens || 0)}</strong>
                      <p>{selectedRuntimeCard?.model || '-'} · {selectedRuntimeCard?.resourceLevel || '等待资源数据'}</p>
                    </div>
                  </div>
                </div>

                <div className="hero-stage-side runtime-hero-side">
                  <div className="section-mini-title">运行轨迹</div>
                  {runtimeTimeline.length ? runtimeTimeline.map((item) => (
                    <div className="journey-item" key={item.key}>
                      <div className="journey-time">{item.time}</div>
                      <div className="journey-line" />
                      <div className="journey-body">
                        <strong>{item.title}</strong>
                        <p>{item.detail}</p>
                      </div>
                    </div>
                  )) : <EmptyState title="暂无运行轨迹" hint="等待新的运行痕迹进入当前视图。" />}
                </div>
              </section>

              <section className="stats-grid softened-stats runtime-stats-grid">
                <StatCard label="运行单元" value={number(runtimeBoard.length)} hint="当前可见智能体都映射为运行观察单元" />
                <StatCard label="活跃状态" value={number(runtimeHotCount)} hint="最近仍在持续运行或保持在线的单元" />
                <StatCard label="风险信号" value={number(runtimeRiskCount)} hint="高占用 / 启动中 / 缓存 / 接口异常等信号" />
                <StatCard label="资源消耗" value={number(totalTokens)} hint="按 recentSessions 汇总的累计资源消耗" />
              </section>

              <section className="board-grid runtime-board-grid">
                <section className="main-card-panel main-card-panel-wide">
                  <div className="section-head page-section-head">
                    <div>
                      <h2>运行矩阵</h2>
                      <p>从运行视角重看智能体：谁最活跃、谁最紧、谁风险最高。</p>
                    </div>
                    <div className="tabs">
                      {runtimeFilterOptions.map((item) => (
                        <button
                          key={item.key}
                          className={`tab ${runtimeFilter === item.key ? 'active' : ''}`}
                          onClick={() => setRuntimeFilter(item.key)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {filteredRuntime.length ? (
                    <div className="runtime-grid">
                      {filteredRuntime.map((item) => (
                        <button
                          key={item.id}
                          className={`runtime-card ${selectedRuntimeCard?.id === item.id ? 'selected' : ''}`}
                          onClick={() => setSelectedAgent(item.id)}
                        >
                          <div className="runtime-card-top">
                            <div className="runtime-owner-mark" style={{ background: `${item.meta.color}1a`, color: item.meta.color }}>{item.meta.avatar}</div>
                            <div className="runtime-card-title-group">
                              <div className="task-card-eyebrow">{item.meta.role}</div>
                              <strong>{item.meta.name}</strong>
                              <span>{item.model}</span>
                            </div>
                            <div className={`pill ${item.riskTone}`}>{item.riskLabel}</div>
                          </div>

                          <div className="runtime-card-body">
                            <div className="runtime-card-section">
                              <span className="story-label">活跃状态</span>
                              <strong>{item.statusLabel}</strong>
                              <p>{item.activeText}</p>
                            </div>
                            <div className="runtime-card-section two-col">
                              <div>
                                <span className="story-label">上下文占用</span>
                                <p>{item.contextText}</p>
                              </div>
                              <div>
                                <span className="story-label">运行轨迹</span>
                                <p>{shortText(item.trajectory, '暂无运行轨迹')}</p>
                              </div>
                            </div>
                          </div>

                          <div className="task-chip-row">
                            <div className="summary-chip">最近活动：{item.updatedAt}</div>
                            <div className="summary-chip">资源层级：{item.resourceLevel}</div>
                            <div className="summary-chip">会话数：{number(item.updates.length)}</div>
                          </div>

                          <div className="glow-line" />

                          <div className="runtime-metric-row">
                            <div className="metric-box"><span>累计资源</span><strong>{number(item.tokens)}</strong></div>
                            <div className="metric-box"><span>上下文</span><strong>{item.context != null ? `${item.context}%` : '—'}</strong></div>
                            <div className="metric-box"><span>风险等级</span><strong>{item.riskLabel}</strong></div>
                          </div>

                          <div className="card-foot card-foot-task">
                            <div className={`risk ${item.riskTone === 'warn' ? 'danger' : ''}`}>
                              {selectedRuntimeCard?.id === item.id ? '◎ 当前选中' : '→ 可回看上层'}
                            </div>
                            <div className="action-row">
                              <button
                                type="button"
                                className="ghost-link compact-link"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  navigateToLayer(setActivePage, { page: 'agents', setSelectedAgent, agentId: item.id })
                                }}
                              >
                                看智能体
                              </button>
                              <button
                                type="button"
                                className="ghost-link compact-link"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  const linkedTask = taskBoard.find((task) => task.agent?.id === item.id)
                                  navigateToLayer(setActivePage, { page: 'tasks', setSelectedAgent, agentId: item.id, setSelectedTask, taskId: linkedTask?.id })
                                }}
                              >
                                看任务
                              </button>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="当前筛选下暂无运行单元" hint="可以切回全部运行单元查看完整矩阵。" />
                  )}
                </section>

                <aside className="detail-card-panel detail-card-panel-sticky runtime-detail-panel">
                  <div className="section-head detail-head">
                    <div>
                      <h3>运行详情</h3>
                      <p>右侧详情区集中解释这个运行单元现在是否健康、占用多高、最近如何推进。</p>
                    </div>
                    <div className={`pill ${selectedRuntimeCard ? selectedRuntimeCard.riskTone : 'idle'}`}>{selectedRuntimeCard?.meta?.name || '运行单元'}</div>
                  </div>

                  <section className="detail-block detail-profile runtime-detail-profile">
                    <div className="detail-home-top">
                      <div className="detail-profile-top">
                        <div className="detail-avatar detail-avatar-large" style={{ color: selectedRuntimeCard?.meta?.color || '#39d0ff' }}>
                          {selectedRuntimeCard?.meta?.avatar || '⚙️'}
                        </div>
                        <div>
                          <strong>{selectedRuntimeCard ? `${selectedRuntimeCard?.meta?.name || '运行单元'} · ${selectedRuntimeCard?.meta?.role || '运行角色'}` : '暂无运行单元'}</strong>
                          <p>{selectedRuntimeCard?.trajectory || '等待运行轨迹形成。'}</p>
                        </div>
                      </div>
                      <div className={`pill large ${selectedRuntimeCard ? selectedRuntimeCard.riskTone : 'idle'}`}>{selectedRuntimeCard?.riskLabel || '待观察'}</div>
                    </div>
                    <div className="detail-profile-tags">
                      <span>{selectedRuntimeCard?.statusLabel || '待观察'}</span>
                      <span>{selectedRuntimeCard?.model || '-'}</span>
                      <span>{selectedRuntimeCard?.resourceLevel || '资源待同步'}</span>
                    </div>
                  </section>

                  <section className="detail-block">
                    <h4>运行信息</h4>
                    <div className="list">
                      <div className="line"><span className="muted">活跃状态</span><strong>{selectedRuntimeCard?.statusLabel || '待观察'}</strong></div>
                      <div className="line"><span className="muted">最近活动</span><strong>{selectedRuntimeCard?.updatedAt || '等待更新'}</strong></div>
                      <div className="line"><span className="muted">当前模型</span><strong>{selectedRuntimeCard?.model || '-'}</strong></div>
                      <div className="line"><span className="muted">风险信号</span><strong>{selectedRuntimeCard?.riskLabel || '暂无风险'}</strong></div>
                      <div className="line"><span className="muted">上下文占用</span><strong>{selectedRuntimeCard?.context != null ? `${selectedRuntimeCard.context}%` : '—'}</strong></div>
                    </div>
                  </section>

                  <section className="detail-block">
                    <h4>运行判断</h4>
                    <div className="detail-note-stack">
                      <div className="detail-note detail-note-strong">
                        <span>当前状态</span>
                        <strong>{selectedRuntimeCard?.activeText || '暂无当前运行说明。'}</strong>
                      </div>
                      <div className="detail-note">
                        <span>上下文判断</span>
                        <strong>{selectedRuntimeCard?.contextText || '上下文占用待同步。'}</strong>
                      </div>
                      <div className="detail-note">
                        <span>轨迹判断</span>
                        <strong>{selectedRuntimeCard?.trajectory || '暂无轨迹判断。'}</strong>
                      </div>
                    </div>
                  </section>

                  <section className="detail-block">
                    <h4>运行轨迹时间线</h4>
                    {runtimeTimeline.length ? (
                      <div className="timeline">
                        {runtimeTimeline.map((item) => (
                          <button key={item.key} className="timeline-item" onClick={() => item.raw && setSelectedSession(item.raw)}>
                            <div className="tiny muted">{item.time}</div>
                            <div className="dot" />
                            <div>
                              <strong>{item.title}</strong>
                              <div className="tiny muted">{item.detail}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <EmptyState title="暂无运行时间线" hint="等待新的会话痕迹进入运行页。" />
                    )}
                  </section>

                  <section className="detail-block">
                    <h4>资源消耗</h4>
                    <div className="task-resource-grid runtime-resource-grid">
                      <div className="metric-box"><span>累计资源</span><strong>{number(selectedRuntimeCard?.tokens || 0)}</strong></div>
                      <div className="metric-box"><span>上下文</span><strong>{selectedRuntimeCard?.context != null ? `${selectedRuntimeCard.context}%` : '—'}</strong></div>
                    </div>
                    <div className="action-row detail-action-row">
                      <button
                        type="button"
                        className="ghost-link compact-link"
                        onClick={() => navigateToLayer(setActivePage, { page: 'agents', setSelectedAgent, agentId: selectedRuntimeCard?.id || 'main' })}
                      >
                        去看智能体
                      </button>
                      <button
                        type="button"
                        className="ghost-link compact-link"
                        onClick={() => {
                          const linkedTask = taskBoard.find((task) => task.agent?.id === (selectedRuntimeCard?.id || 'main'))
                          navigateToLayer(setActivePage, { page: 'tasks', setSelectedAgent, agentId: selectedRuntimeCard?.id || 'main', setSelectedTask, taskId: linkedTask?.id })
                        }}
                      >
                        去看任务
                      </button>
                    </div>
                  </section>
                </aside>
              </section>
            </>
          ) : (
            <section className="page-placeholder-panel">
              <div className="page-placeholder-head">
                <div>
                  <span className="eyebrow">下一阶段</span>
                  <h2>{pageMeta.title}</h2>
                  <p>{pageMeta.subtitle} 已进入平台层级，但当前版本先把资源集中在“智能体”和“任务”页面，不扩展后端与接口。</p>
                </div>
                <div className="page-placeholder-badge">占位中</div>
              </div>

              <div className="placeholder-grid">
                <div className="placeholder-card">
                  <span className="hero-card-label">当前策略</span>
                  <strong>先做页面分层，再逐步填充内容</strong>
                  <p>本页当前只承担结构占位，避免继续把所有信息都塞回首页。</p>
                </div>
                <div className="placeholder-card">
                  <span className="hero-card-label">数据策略</span>
                  <strong>不改接口 / 不改自动刷新</strong>
                  <p>现有 overview 与 agent 详情接口继续服务智能体与任务主页面，其余栏目后续按需接入。</p>
                </div>
                <div className="placeholder-card full">
                  <span className="hero-card-label">当前已完成的层级感</span>
                  <strong>平台导航 → 总览 / 智能体 / 任务 → 详情侧栏</strong>
                  <p>这版先把“任务”也从占位页升级成真实页面；运行、协作、系统保留为下一轮正式页面入口。</p>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>

      {selectedSession ? (
        <div className="drawer-backdrop" onClick={() => setSelectedSession(null)}>
          <aside className="drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-head">
              <div>
                <h3>会话详情</h3>
                <p>{agentMeta(selectedSession.agentId).name} · {shortText(selectedSession.model, '-')}</p>
              </div>
              <button className="drawer-close" onClick={() => setSelectedSession(null)}>关闭</button>
            </div>

            <div className="drawer-summary">
              <div className="detail-row"><span>智能体</span><strong>{agentMeta(selectedSession.agentId).name}</strong></div>
              <div className="detail-row"><span>模型</span><strong>{selectedSession.model || '-'}</strong></div>
              <div className="detail-row"><span>资源</span><strong>{number(selectedSession.totalTokens || 0)}</strong></div>
              <div className="detail-row"><span>最近活跃</span><strong>{ageText(selectedSession.age)}</strong></div>
            </div>

            <div className="drawer-story">
              <div className="drawer-story-card primary">
                <span>状态判断</span>
                <strong>{selectedSession.totalTokens ? '本轮会话正在留下运行痕迹' : '当前会话偏安静，等待下一步输入'}</strong>
                <small>{selectedSession.percentUsed != null ? `上下文占用 ${selectedSession.percentUsed}%` : '上下文占用暂未同步'}</small>
              </div>
              <div className="drawer-story-card">
                <span>查看建议</span>
                <strong>先看模型、上下文和活跃时间，再判断它在整条任务链里处于什么位置。</strong>
                <small>{selectedSession.sessionId ? '会话 ID 已记录' : '当前未提供会话 ID'}</small>
              </div>
            </div>

            <div className="drawer-footnote">这里只保留会话摘要，接口结构与自动刷新机制保持不变。</div>
          </aside>
        </div>
      ) : null}
    </div>
  )
}
