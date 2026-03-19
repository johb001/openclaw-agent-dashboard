import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API_BASE = ''

/* ── helpers ─────────────────────────────────────────────── */
function StatCard({ title, value, hint }) {
  return (
    <div className="card stat-card">
      <div className="stat-title">{title}</div>
      <div className="stat-value">{value}</div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </div>
  )
}

function SectionCard({ title, children, extra }) {
  return (
    <div className="card section-card">
      <div className="section-head">
        <h2>{title}</h2>
        {extra}
      </div>
      <div>{children}</div>
    </div>
  )
}

function formatJson(value) {
  if (value == null) return '暂无数据'
  return JSON.stringify(value, null, 2)
}

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

function agentRole(agentId) {
  const map = { main: '主控', builder: '构建', planner: '规划', qa: '质检' }
  return map[agentId] || 'Agent'
}

function sessionState(item) {
  if (!item) return 'unknown'
  if (item.abortedLastRun) return 'aborted'
  if ((item.age || 0) < 5 * 60 * 1000) return 'active'
  if ((item.age || 0) < 60 * 60 * 1000) return 'warm'
  return 'idle'
}

/* ── 状态徽章组件 ─────────────────────────────────────────── */
function StatusBadge({ status }) {
  if (status === 'loading') {
    return <span className="badge badge-loading">◌ 正在加载…</span>
  }
  if (status === 'refreshing') {
    return <span className="badge badge-refreshing">↻ 正在刷新缓存</span>
  }
  if (status === 'stale') {
    return <span className="badge badge-stale">⏱ 显示上次缓存</span>
  }
  if (status === 'error') {
    return <span className="badge badge-error">⚠ 数据异常</span>
  }
  return null
}

/* ── 空状态组件 ───────────────────────────────────────────── */
function EmptyState({ message, sub }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">📭</div>
      <div className="empty-msg">{message}</div>
      {sub && <div className="empty-sub">{sub}</div>}
    </div>
  )
}

/* ── 加载骨架行 ───────────────────────────────────────────── */
function SkeletonRow({ cols = 5 }) {
  return (
    <tr>
      {Array.from({ length: cols }, (_, i) => (
        <td key={i}>
          <span className="skeleton-line" style={{ width: `${60 + Math.random() * 40}%` }} />
        </td>
      ))}
    </tr>
  )
}

/* ── 主应用 ───────────────────────────────────────────────── */
function App() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)   // 正在后台刷新
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState('')
  const [selectedAgent, setSelectedAgent] = useState('main')
  const [agentDetail, setAgentDetail] = useState(null)
  const [agentDetailLoading, setAgentDetailLoading] = useState(false)
  const [selectedSession, setSelectedSession] = useState(null)

  const firstLoadDone = useRef(false)

  async function load(isBackgroundRefresh = false) {
    if (isBackgroundRefresh) {
      setRefreshing(true)
    } else {
      setError('')
    }

    try {
      const res = await fetch(`${API_BASE}/api/overview`)
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || '加载失败')

      setData(json)
      setLastUpdated(new Date().toLocaleString('zh-CN'))
      setError('')
      firstLoadDone.current = true
    } catch (err) {
      if (isBackgroundRefresh && firstLoadDone.current) {
        // 后台刷新失败：保留旧数据，显示 stale 提示
        setError('刷新失败，已显示上次缓存数据')
      } else {
        setError(err.message || '请求失败')
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  async function loadAgentDetail(agentId) {
    setAgentDetailLoading(true)
    setAgentDetail(null)
    try {
      const res = await fetch(`${API_BASE}/api/agent/${encodeURIComponent(agentId)}`)
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || '加载 agent 详情失败')
      setAgentDetail(json)
    } catch (err) {
      setAgentDetail({ ok: false, error: err.message || '加载失败' })
    } finally {
      setAgentDetailLoading(false)
    }
  }

  /* 首次加载 + 每 5 秒后台刷新 */
  useEffect(() => {
    load(false)
    const timer = setInterval(() => load(true), 5000)
    return () => clearInterval(timer)
  }, [])

  /* 切换 agent 时加载详情 */
  useEffect(() => {
    if (selectedAgent) loadAgentDetail(selectedAgent)
  }, [selectedAgent])

  /* 手动刷新 */
  function handleRefresh() {
    setRefreshing(true)
    load(false)
  }

  /* 派生状态 */
  const agents = useMemo(() => data?.agents || [], [data])
  const recentSessions = useMemo(() => data?.recentSessions || [], [data])
  const usage = data?.usage
  const summary = data?.summary

  /* 计算当前页面状态 */
  const pageStatus = loading
    ? 'loading'
    : error && !data
    ? 'error'
    : error && data
    ? 'stale'
    : null

  const lanes = useMemo(() => {
    const bucket = { active: [], warm: [], idle: [], aborted: [] }
    for (const item of recentSessions) {
      bucket[sessionState(item)]?.push(item)
    }
    return bucket
  }, [recentSessions])

  return (
    <div className="app-shell">
      {/* ── 顶栏 ── */}
      <header className="topbar">
        <div>
          <p className="eyebrow">OpenClaw Dashboard</p>
          <h1>智能体工作台</h1>
          <p className="subtitle">实时查看状态、使用情况、配置和多智能体活动</p>
        </div>
        <div className="topbar-actions">
          <StatusBadge status={pageStatus} />
          <div className="topbar-row">
            <button onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? '刷新中…' : '立即刷新'}
            </button>
            <span className="muted">
              {lastUpdated
                ? `更新于 ${lastUpdated}`
                : loading
                ? '等待首次加载'
                : '暂无数据'}
            </span>
          </div>
        </div>
      </header>

      {/* ── 全局提示 ── */}
      {error && pageStatus === 'error' ? (
        <div className="banner error">
          <strong>⚠ 服务异常：</strong>{error}
          &nbsp;&nbsp;<span className="muted">请检查 Gateway 是否在线</span>
        </div>
      ) : null}
      {error && pageStatus === 'stale' ? (
        <div className="banner warn">
          <strong>⏱ {error}</strong>
          &nbsp;&nbsp;<span className="muted">数据可能不是最新的，请稍后重试</span>
        </div>
      ) : null}

      {/* ── 统计卡片 ── */}
      <section className="stats-grid">
        <StatCard
          title="智能体总数"
          value={summary?.totalAgents ?? (data ? 0 : '-')}
          hint={data ? `默认 agent：${summary?.defaultAgent || '-'}` : ''}
        />
        <StatCard
          title="总会话数"
          value={summary?.totalSessions ?? (data ? 0 : '-')}
          hint={data ? `默认模型：${summary?.defaultModel || '-'}` : ''}
        />
        <StatCard
          title="最近样本 Token"
          value={data ? number(usage?.totals?.totalTokens) : '-'}
          hint={data ? `最近 ${usage?.recentCount || 0} 条 session 样本` : ''}
        />
        <StatCard
          title="Gateway"
          value={data ? (summary?.gatewayReachable ? '在线' : '离线') : '-'}
          hint={summary?.host || (data ? '无法获取' : '')}
        />
      </section>

      {/* ── 团队卡片 ── */}
      <section className="team-grid">
        {loading ? (
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="card team-card skeleton-card">
              <div className="skeleton-line" style={{ width: '60%', height: 20 }} />
              <div className="skeleton-line" style={{ width: '40%', height: 14, marginTop: 8 }} />
              <div className="skeleton-line" style={{ width: '80%', height: 14, marginTop: 16 }} />
            </div>
          ))
        ) : agents.length === 0 ? (
          <div className="team-grid-empty">
            <EmptyState
              message="暂无 agent 数据"
              sub="服务在线，但未检测到任何 Agent，请确认 OpenClaw 是否已启动"
            />
          </div>
        ) : (
          agents.map((agent) => {
            const agentSessions = recentSessions.filter((item) => item.agentId === agent.id)
            const tokenSum = agentSessions.reduce((sum, item) => sum + (item.totalTokens || 0), 0)
            const activeCount = agentSessions.filter((item) => sessionState(item) === 'active').length
            return (
              <button
                key={agent.id}
                className={`card team-card ${selectedAgent === agent.id ? 'team-card-active' : ''}`}
                onClick={() => setSelectedAgent(agent.id)}
              >
                <div className="team-top">
                  <div>
                    <div className="team-name">{agent.name}</div>
                    <div className="team-role">{agentRole(agent.id)}</div>
                  </div>
                  <span className={`dot ${agent.bootstrapPending ? 'dot-warn' : 'dot-ok'}`} />
                </div>
                <div className="team-stats">
                  <div>
                    <strong>{agent.sessionsCount}</strong>
                    <span>会话</span>
                  </div>
                  <div>
                    <strong>{number(tokenSum)}</strong>
                    <span>tokens</span>
                  </div>
                  <div>
                    <strong>{activeCount}</strong>
                    <span>活跃</span>
                  </div>
                </div>
                <div className="team-meta">最近活跃：{ageText(agent.lastActiveAgeMs)}</div>
              </button>
            )
          })
        )}
      </section>

      {/* ── 主网格 ── */}
      <section className="main-grid">
        {/* 泳道视图 */}
        <SectionCard title="团队泳道视图">
          {loading ? (
            <div className="lanes-grid">
              {[['active', '活跃中'], ['warm', '近期活跃'], ['idle', '空闲'], ['aborted', '异常']].map(([key, label]) => (
                <div className="lane" key={key}>
                  <div className="lane-head">{label} · -</div>
                  {[1, 2].map(i => <div key={i} className="lane-item skeleton-lane-item" />)}
                </div>
              ))}
            </div>
          ) : recentSessions.length === 0 ? (
            <EmptyState message="暂无会话数据" sub="泳道将在 Agent 产生会话后自动填充" />
          ) : (
            <div className="lanes-grid">
              {[
                ['active', '活跃中'],
                ['warm', '近期活跃'],
                ['idle', '空闲'],
                ['aborted', '异常'],
              ].map(([key, label]) => (
                <div className="lane" key={key}>
                  <div className="lane-head">{label} · {lanes[key]?.length || 0}</div>
                  <div className="lane-body">
                    {(lanes[key] || []).map((item, idx) => (
                      <button
                        key={item.sessionId || idx}
                        className="lane-item"
                        onClick={() => setSelectedSession(item)}
                      >
                        <div className="lane-item-title">{item.agentId} · {item.model || '-'}</div>
                        <div className="lane-item-sub">{item.key || '-'}</div>
                        <div className="lane-item-meta">{number(item.totalTokens)} tokens · {ageText(item.age)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* 配置总览 */}
        <SectionCard title="配置总览">
          {loading ? (
            <div className="skeleton-pre" />
          ) : summary ? (
            <pre>{formatJson(summary)}</pre>
          ) : (
            <EmptyState message="暂无配置数据" sub="Gateway 在线时配置将自动显示" />
          )}
        </SectionCard>

        {/* 使用情况统计 */}
        <SectionCard title="使用情况统计">
          {loading ? (
            <>
              <div className="usage-grid">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="mini-card skeleton-mini-card" />
                ))}
              </div>
              <div className="skeleton-pre" />
            </>
          ) : usage ? (
            <>
              <div className="usage-grid">
                <div className="mini-card">
                  <div className="mini-title">输入 Tokens</div>
                  <div className="mini-value">{number(usage?.totals?.inputTokens)}</div>
                </div>
                <div className="mini-card">
                  <div className="mini-title">输出 Tokens</div>
                  <div className="mini-value">{number(usage?.totals?.outputTokens)}</div>
                </div>
                <div className="mini-card">
                  <div className="mini-title">Cache Read</div>
                  <div className="mini-value">{number(usage?.totals?.cacheRead)}</div>
                </div>
                <div className="mini-card">
                  <div className="mini-title">Cache Write</div>
                  <div className="mini-value">{number(usage?.totals?.cacheWrite)}</div>
                </div>
              </div>
              <div className="split-2">
                <div>
                  <h3>按模型</h3>
                  <pre>{formatJson(usage?.byModel)}</pre>
                </div>
                <div>
                  <h3>按 Agent</h3>
                  <pre>{formatJson(usage?.byAgent)}</pre>
                </div>
              </div>
            </>
          ) : (
            <EmptyState message="暂无使用统计数据" sub="开始对话后数据将自动生成" />
          )}
        </SectionCard>

        {/* Agent 详情 */}
        <SectionCard title={`Agent 详情：${selectedAgent || '-'}`}>
          {agentDetailLoading ? (
            <div className="skeleton-pre" />
          ) : agentDetail?.error ? (
            <div className="empty">{agentDetail.error}</div>
          ) : (
            <>
              <pre>{formatJson(agentDetail?.agent)}</pre>
              <h3>最近会话</h3>
              {(agentDetail?.sessions || []).length === 0 ? (
                <EmptyState message="暂无会话记录" sub="该 Agent 尚未产生会话" />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Session</th>
                        <th>模型</th>
                        <th>Token</th>
                        <th>最近活跃</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(agentDetail?.sessions || []).map((item, idx) => (
                        <tr key={item.sessionId || idx} onClick={() => setSelectedSession(item)}>
                          <td>{item.key || item.sessionId || '-'}</td>
                          <td>{item.model || '-'}</td>
                          <td>{number(item.totalTokens)}</td>
                          <td>{ageText(item.age)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </SectionCard>

        {/* 最近会话样本 */}
        <SectionCard
          title="最近会话样本"
          extra={<span className="pill">{loading ? '-' : recentSessions.length} 条</span>}
        >
          {loading ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Agent</th><th>Session Key</th><th>模型</th><th>Token</th><th>上下文占用</th></tr>
                </thead>
                <tbody>
                  <SkeletonRow cols={5} />
                  <SkeletonRow cols={5} />
                  <SkeletonRow cols={5} />
                </tbody>
              </table>
            </div>
          ) : recentSessions.length === 0 ? (
            <EmptyState
              message="暂无会话样本"
              sub="所有 Agent 暂无 session 记录，数据将在首次对话后出现"
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Session Key</th>
                    <th>模型</th>
                    <th>Token</th>
                    <th>上下文占用</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSessions.map((item, idx) => (
                    <tr key={item.sessionId || idx} onClick={() => setSelectedSession(item)}>
                      <td>{item.agentId || '-'}</td>
                      <td>{item.key || '-'}</td>
                      <td>{item.model || '-'}</td>
                      <td>{number(item.totalTokens)}</td>
                      <td>{item.percentUsed != null ? `${item.percentUsed}%` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </section>

      {/* ── 会话详情抽屉 ── */}
      {selectedSession ? (
        <div className="drawer-backdrop" onClick={() => setSelectedSession(null)}>
          <aside className="drawer card" onClick={(e) => e.stopPropagation()}>
            <div className="section-head">
              <h2>会话详情</h2>
              <button onClick={() => setSelectedSession(null)}>关闭</button>
            </div>
            <pre>{formatJson(selectedSession)}</pre>
          </aside>
        </div>
      ) : null}
    </div>
  )
}

export default App
