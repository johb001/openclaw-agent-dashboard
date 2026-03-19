import { useEffect, useMemo, useState } from 'react'
import './App.css'

const API_BASE = ''

function number(value) {
  return new Intl.NumberFormat('zh-CN').format(value || 0)
}

function ageText(ms) {
  if (!ms && ms !== 0) return '-'
  const min = Math.floor(ms / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  return `${Math.floor(hour / 24)} 天前`
}

function formatJson(value) {
  if (!value) return '暂无数据'
  return JSON.stringify(value, null, 2)
}

function agentMeta(agentId) {
  const metas = {
    main: { avatar: '🐉', name: '龙龙', role: '主控智能体', color: '#7c3aed' },
    builder: { avatar: '🔧', name: '构建者', role: '代码构建', color: '#0891b2' },
    planner: { avatar: '📋', name: '规划师', role: '任务规划', color: '#059669' },
    qa: { avatar: '🔍', name: '质检员', role: '质量检查', color: '#dc2626' },
  }
  return metas[agentId] || { avatar: '🤖', name: agentId, role: 'Agent', color: '#6b7280' }
}

function sessionState(item) {
  if (!item) return 'unknown'
  if (item.abortedLastRun) return 'aborted'
  if ((item.age || 0) < 5 * 60 * 1000) return 'active'
  if ((item.age || 0) < 60 * 60 * 1000) return 'warm'
  return 'idle'
}

function statusDotClass(state) {
  if (state === 'active') return 'on'
  if (state === 'warm') return 'warm'
  return 'off'
}

function getStatus(lastActiveAgeMs, bootstrapPending) {
  if (bootstrapPending) return ['启动中', 'pending']
  if (!lastActiveAgeMs) return ['离线', 'off']
  if (lastActiveAgeMs < 5 * 60 * 1000) return ['活跃', 'active']
  if (lastActiveAgeMs < 60 * 60 * 1000) return ['温热', 'warm']
  return ['空闲', 'idle']
}

function EmptyState({ title, hint }) {
  return (
    <div className="app-empty">
      <strong>{title}</strong>
      {hint ? <div className="app-empty-sub">{hint}</div> : null}
    </div>
  )
}

function BarList({ title, items, formatter = (v) => number(v) }) {
  const max = Math.max(...items.map((i) => i.value || 0), 1)
  return (
    <div className="app-feature-card">
      <div className="app-feature-head"><h3>{title}</h3><span className="af-cnt">{items.length}</span></div>
      <div className="app-feature-body">
        {items.length ? (
          <div className="bar-list">
            {items.map((item) => (
              <div className="bar-row" key={item.label}>
                <div className="bar-row-top">
                  <span>{item.label}</span>
                  <strong>{formatter(item.value)}</strong>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${Math.max((item.value / max) * 100, 6)}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="暂无数据" hint="后续会自动生成" />
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [data, setData] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState('')
  const [agentDetail, setAgentDetail] = useState(null)
  const [activeTab, setActiveTab] = useState('monitor')
  const [selectedAgent, setSelectedAgent] = useState('main')
  const [selectedSession, setSelectedSession] = useState(null)
  const [memoryView, setMemoryView] = useState('logs')

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

  async function loadAgentDetail(agentId) {
    try {
      const res = await fetch(`${API_BASE}/api/agent/${encodeURIComponent(agentId)}`)
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || '加载 agent 详情失败')
      setAgentDetail(json)
    } catch (err) {
      setAgentDetail({ ok: false, error: err.message || '加载失败' })
    }
  }

  useEffect(() => {
    load(false)
    const timer = setInterval(() => load(true), 15000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (selectedAgent) loadAgentDetail(selectedAgent)
  }, [selectedAgent, data])

  const summary = data?.summary || {}
  const usage = data?.usage || {}
  const agents = data?.agents || []
  const recentSessions = data?.recentSessions || []
  const cacheState = data?.cacheState || {}

  const agentCards = useMemo(() => {
    return agents.map((agent) => {
      const sessions = recentSessions.filter((item) => item.agentId === agent.id)
      const totalTokens = sessions.reduce((sum, item) => sum + (item.totalTokens || 0), 0)
      const activeCount = sessions.filter((item) => sessionState(item) === 'active').length
      return {
        ...agent,
        totalTokens,
        activeCount,
        model: sessions[0]?.model || '-',
      }
    })
  }, [agents, recentSessions])

  const selectedAgentCard = useMemo(() => agentCards.find((a) => a.id === selectedAgent) || null, [agentCards, selectedAgent])
  const onlineAgents = useMemo(() => agentCards.filter((a) => !a.bootstrapPending && (a.lastActiveAgeMs || Infinity) < 60 * 60 * 1000).length, [agentCards])
  const currentSession = useMemo(() => recentSessions.find((s) => s.agentId === selectedAgent) || null, [recentSessions, selectedAgent])
  const modelBars = useMemo(() => Object.entries(usage?.byModel || {}).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value), [usage])
  const agentBars = useMemo(() => Object.entries(usage?.byAgent || {}).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value), [usage])
  const recentFeed = useMemo(() => recentSessions.slice(0, 8), [recentSessions])
  const logEntries = useMemo(() => recentSessions.slice(0, 20), [recentSessions])

  const navItems = [
    ['monitor', '📡', '实时监控'],
    ['memory', '🧠', '记忆中心'],
    ['sessions', '💬', '会话管理'],
    ['stats', '📈', '数据统计'],
  ]

  const selectedMeta = selectedAgentCard ? agentMeta(selectedAgentCard.id) : { avatar: '🤖', name: '未选择', role: 'Agent' }
  const [selectedStatusLabel, selectedStatusClass] = selectedAgentCard ? getStatus(selectedAgentCard.lastActiveAgeMs, selectedAgentCard.bootstrapPending) : ['未选择', 'off']

  return (
    <div className="dashboard-shell">
      <header className="header-refined">
        <div className="header-main">
          <div className="header-brand-row">
            <div className="header-brand-mark">🦞</div>
            <div className="header-brand-copy">
              <div className="header-kicker">AI Team Console</div>
              <h1>AI Team 调度中心</h1>
              <p>更清晰地查看当前 Agent、模型状态与团队在线情况</p>
            </div>
          </div>
          <div className="header-tabs-refined">
            {navItems.map(([tab, icon, label]) => (
              <button key={tab} className={`tab-btn${activeTab === tab ? ' active' : ''}`} onClick={() => setActiveTab(tab)}>
                <span className="tab-icon">{icon}</span>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="header-side">
          <div className="header-summary-grid">
            <div className="topbar-info-card">
              <div className="topbar-card-label">团队状态</div>
              <div className="topbar-pill-row">
                <span className="topbar-pill topbar-pill-success">在线 {onlineAgents}/{agents.length || 0}</span>
                <span className={`topbar-pill ${error ? 'topbar-pill-danger' : 'topbar-pill-info'}`}>{error ? '连接异常' : cacheState?.degraded ? '缓存模式' : '同步正常'}</span>
              </div>
              <div className="topbar-inline-meta">
                <span className={`live-dot${error ? ' is-off' : ''}`}></span>
                <span>{lastUpdated ? `更新于 ${lastUpdated}` : '等待加载'}</span>
              </div>
            </div>

            <div className="topbar-info-card">
              <div className="topbar-card-label">当前焦点</div>
              <div className="topbar-focus-row">
                <div className="topbar-focus-agent" style={{ '--agent-accent': selectedMeta.color }}>
                  <span className="focus-avatar">{selectedMeta.avatar}</span>
                  <div className="focus-copy">
                    <strong>{selectedMeta.name}</strong>
                    <span>{selectedMeta.role}</span>
                  </div>
                </div>
                <span className={`topbar-status-pill status-${selectedStatusClass}`}>{selectedStatusLabel}</span>
              </div>
              <div className="topbar-metric-row">
                <div className="topbar-mini-metric"><span>模型</span><strong>{currentSession?.model || selectedAgentCard?.model || '-'}</strong></div>
                <div className="topbar-mini-metric"><span>会话</span><strong>{selectedAgentCard?.sessionsCount || 0}</strong></div>
              </div>
            </div>
          </div>

          <div className="header-strip">
            <div className="header-strip-item"><span className="strip-label">当前 Agent</span><span className="strip-badge strip-badge-agent">{selectedMeta.avatar} {selectedMeta.name}</span></div>
            <div className="header-strip-item"><span className="strip-label">运行模型</span><span className="strip-badge strip-badge-model">{currentSession?.model || selectedAgentCard?.model || '-'}</span></div>
            <div className="header-strip-item"><span className="strip-label">在线数</span><span className="strip-badge strip-badge-online">{onlineAgents}/{agents.length || 0}</span></div>
            <div className="header-strip-item"><span className="strip-label">当前状态</span><span className={`strip-badge status-${selectedStatusClass}`}>{selectedStatusLabel}</span></div>
          </div>

          <div className="topbar-actions-card">
            <button className="topbar-refresh-btn" onClick={() => load(false)} disabled={refreshing}>{refreshing ? '刷新中…' : '↻ 刷新'}</button>
          </div>
        </div>
      </header>

      {error ? <div className="banner danger">数据请求失败：{error}</div> : null}
      {cacheState?.degraded && !error ? <div className="banner warn">当前处于降级/缓存模式</div> : null}

      <div className="app-container">
        <aside className="app-sidebar">
          <div className="app-sidebar-section">
            <div className="app-sidebar-label">当前智能体</div>
            {agentCards.length ? agentCards.map((agent) => {
              const meta = agentMeta(agent.id)
              const [, statusClass] = getStatus(agent.lastActiveAgeMs, agent.bootstrapPending)
              return (
                <button key={agent.id} className={`app-sidebar-item${selectedAgent === agent.id ? ' active' : ''}`} onClick={() => setSelectedAgent(agent.id)}>
                  <span className="si-icon">{meta.avatar}</span>
                  <span className="si-name">{meta.name}</span>
                  <span className={`si-dot ${statusDotClass(statusClass)}`}></span>
                </button>
              )
            }) : <div className="app-sidebar-empty">暂无 agent</div>}
          </div>
          <div className="app-sidebar-divider"></div>
          <div className="app-sidebar-section">
            <div className="app-sidebar-label">快捷导航</div>
            {navItems.map(([tab, icon, label]) => (
              <button key={tab} className={`app-sidebar-item${activeTab === tab ? ' active' : ''}`} onClick={() => setActiveTab(tab)}>
                <span className="si-icon">{icon}</span>
                <span className="si-name">{label}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="app-content">
          {activeTab === 'monitor' && (
            <>
              <div className="app-section-header"><div><h2 className="app-section-title">实时监控</h2><p className="app-section-sub">当前 Agent / Session / 最近动态一眼看清</p></div></div>
              <div className="app-status-grid">
                <div className="app-status-card ok"><div className="as-label">ONLINE</div><div className="as-value">{onlineAgents}</div><div className="as-sub">在线智能体</div></div>
                <div className="app-status-card info"><div className="as-label">CURRENT</div><div className="as-value">{selectedMeta.name}</div><div className="as-sub">当前 Agent</div></div>
                <div className="app-status-card warn"><div className="as-label">SESSION</div><div className="as-value">{selectedAgentCard?.sessionsCount || 0}</div><div className="as-sub">当前会话数</div></div>
                <div className="app-status-card info"><div className="as-label">TOTAL</div><div className="as-value">{summary.totalSessions || 0}</div><div className="as-sub">总会话数</div></div>
              </div>
              <div className="app-feature-grid">
                <div className="app-feature-card"><div className="app-feature-head"><h3>🤖 Agent Fleet</h3><span className="af-cnt">{agentCards.length}</span></div><div className="app-feature-body">{agentCards.length ? agentCards.map((agent) => { const meta=agentMeta(agent.id); const [label, cls]=getStatus(agent.lastActiveAgeMs, agent.bootstrapPending); return <div key={agent.id} className={`fleet-card${selectedAgent===agent.id?' selected':''}`} onClick={() => setSelectedAgent(agent.id)}><div className="fleet-top"><span className="fleet-avatar">{meta.avatar}</span><div><strong>{meta.name}</strong><div className="fleet-sub">{meta.role}</div></div><span className={`fleet-status status-${cls}`}>{label}</span></div><div className="fleet-metrics"><span>{agent.sessionsCount || 0} 会话</span><span>{agent.activeCount || 0} 活跃</span><span>{number(agent.totalTokens)} tokens</span></div></div>}) : <EmptyState title="暂无数据" />}</div></div>
                <div className="app-feature-card"><div className="app-feature-head"><h3>📋 最近动态</h3><span className="af-cnt">{recentFeed.length}</span></div><div className="app-feature-body">{recentFeed.length ? recentFeed.map((item, idx) => <button key={item.sessionId || idx} className="feed-row" onClick={() => setSelectedSession(item)}><div className="feed-row-top"><span>{item.agentId}</span><span>{ageText(item.age)}</span></div><div className="feed-row-main">{item.model || '-'}</div><div className="feed-row-sub">{number(item.totalTokens || 0)} tokens</div></button>) : <EmptyState title="暂无动态" />}</div></div>
                <div className="app-feature-card"><div className="app-feature-head"><h3>🪪 当前 Agent 详情</h3><span className="af-cnt">focus</span></div><div className="app-feature-body">{selectedAgentCard ? <div className="focus-panel"><div className="focus-panel-top"><span className="focus-avatar big">{selectedMeta.avatar}</span><div><strong>{selectedMeta.name}</strong><div className="fleet-sub">{selectedMeta.role}</div></div></div><div className="focus-kpis"><div><span>模型</span><strong>{currentSession?.model || selectedAgentCard.model || '-'}</strong></div><div><span>会话</span><strong>{selectedAgentCard.sessionsCount || 0}</strong></div><div><span>Token</span><strong>{number(selectedAgentCard.totalTokens)}</strong></div></div></div> : <EmptyState title="未选择 Agent" />}</div></div>
                <div className="app-feature-card"><div className="app-feature-head"><h3>📡 操作日志</h3><span className="af-cnt">{logEntries.length}</span></div><div className="app-feature-body">{logEntries.length ? logEntries.map((s, i) => <div key={s.sessionId || i} className="log-row"><span className={`log-tag ${sessionState(s)}`}>{sessionState(s)}</span><div className="log-main"><strong>{s.agentId}</strong><span>{s.model || '-'}</span></div><span className="log-time">{ageText(s.age)}</span></div>) : <EmptyState title="暂无日志" />}</div></div>
              </div>
            </>
          )}

          {activeTab === 'memory' && (
            <>
              <div className="app-section-header"><div><h2 className="app-section-title">记忆中心</h2><p className="app-section-sub">日志与用量分开看</p></div><div className="memory-switch"><button className={memoryView==='logs'?'active':''} onClick={() => setMemoryView('logs')}>记忆日志</button><button className={memoryView==='usage'?'active':''} onClick={() => setMemoryView('usage')}>记忆用量</button></div></div>
              {memoryView === 'logs' ? (
                <div className="app-feature-card"><div className="app-feature-head"><h3>🪵 记忆日志</h3><span className="af-cnt">{logEntries.length}</span></div><div className="app-feature-body">{logEntries.length ? logEntries.map((s, i) => <div key={s.sessionId || i} className="memory-row"><strong>{s.agentId}</strong><span>{s.model || '-'}</span><span>{ageText(s.age)}</span></div>) : <EmptyState title="暂无记忆日志" />}</div></div>
              ) : (
                <div className="app-feature-grid"><BarList title="模型使用分布" items={modelBars} /><BarList title="Agent 使用分布" items={agentBars} /></div>
              )}
            </>
          )}

          {activeTab === 'sessions' && (
            <>
              <div className="app-section-header"><div><h2 className="app-section-title">会话管理</h2><p className="app-section-sub">当前所有 session 列表</p></div></div>
              <div className="app-feature-card"><div className="app-feature-head"><h3>💬 Sessions</h3><span className="af-cnt">{recentSessions.length}</span></div><div className="app-feature-body">{recentSessions.length ? recentSessions.map((s, i) => <button key={s.sessionId || i} className="session-row-card" onClick={() => setSelectedSession(s)}><div className="session-row-top"><div className="session-row-title">{s.agentId} · {s.key || s.sessionId || '-'}</div><div className="session-row-time">{ageText(s.age)}</div></div><div className="session-row-meta">模型：{s.model || '-'} · Token：{number(s.totalTokens || 0)} · Context：{s.percentUsed != null ? `${s.percentUsed}%` : '-'}</div></button>) : <EmptyState title="暂无会话" />}</div></div>
            </>
          )}

          {activeTab === 'stats' && (
            <>
              <div className="app-section-header"><div><h2 className="app-section-title">数据统计</h2><p className="app-section-sub">总体指标与分布</p></div></div>
              <div className="app-status-grid">
                <div className="app-status-card info"><div className="as-label">TOKENS</div><div className="as-value">{number(usage?.totals?.totalTokens)}</div><div className="as-sub">总 Token</div></div>
                <div className="app-status-card ok"><div className="as-label">SESSIONS</div><div className="as-value">{summary.totalSessions || 0}</div><div className="as-sub">总会话</div></div>
                <div className="app-status-card warn"><div className="as-label">AGENTS</div><div className="as-value">{summary.totalAgents || 0}</div><div className="as-sub">总智能体</div></div>
                <div className="app-status-card info"><div className="as-label">MODEL</div><div className="as-value">{summary.defaultModel || '-'}</div><div className="as-sub">默认模型</div></div>
              </div>
              <div className="app-feature-grid">
                <BarList title="模型使用分布" items={modelBars} />
                <BarList title="Agent 使用分布" items={agentBars} />
                <div className="app-feature-card full"><div className="app-feature-head"><h3>🧾 系统概览</h3><span className="af-cnt">summary</span></div><div className="app-feature-body"><pre>{formatJson(summary)}</pre></div></div>
              </div>
            </>
          )}
        </main>
      </div>

      {selectedSession ? (
        <div className="drawer-backdrop" onClick={() => setSelectedSession(null)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head"><h2>会话详情</h2><button onClick={() => setSelectedSession(null)}>关闭</button></div>
            <pre>{formatJson(selectedSession)}</pre>
          </aside>
        </div>
      ) : null}
    </div>
  )
}
