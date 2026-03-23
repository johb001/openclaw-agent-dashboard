import http from 'node:http'
import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const exec = promisify(execCb)
const PORT = process.env.PORT || 3456
const ROOT = process.cwd()
const REFRESH_MS = 15000
const STATUS_TIMEOUT_MS = 20000
const MIN_REFRESH_GAP_MS = 5000
const WEB_PORT = Number(process.env.WEB_PORT || 4173)
const API_BASE_URL = process.env.API_BASE_URL || `http://127.0.0.1:${PORT}`
const DATA_DIR = path.join(ROOT, '.data')
const TASKS_FILE = path.join(DATA_DIR, 'tasks-v1.json')
const RUNS_FILE = path.join(DATA_DIR, 'runs-v1.json')

async function runCommand(cmd, options = {}) {
  const timeout = options.timeout ?? STATUS_TIMEOUT_MS
  try {
    const { stdout, stderr } = await exec(cmd, {
      cwd: ROOT,
      maxBuffer: 1024 * 1024 * 8,
      timeout,
    })
    return { ok: true, stdout, stderr, command: cmd, timedOut: false }
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || 'Unknown error',
      code: error.code ?? 1,
      command: cmd,
      timedOut: error.killed || /timed out/i.test(error.message || ''),
    }
  }
}

async function runFirst(commands, options = {}) {
  const stopOnTimeout = options.stopOnTimeout ?? false
  let lastResult = null
  for (const cmd of commands) {
    const result = await runCommand(cmd, options)
    lastResult = result
    if (result.ok) return result
    if (stopOnTimeout && result.timedOut) return result
  }
  return lastResult || {
    ok: false,
    stdout: '',
    stderr: 'No commands provided',
    command: '',
    code: 1,
    timedOut: false,
  }
}

function tryParseJson(text) {
  if (!text) return null
  const lines = text.split('\n')
  const startLine = lines.findIndex((line) => line.trim().startsWith('{') || line.trim().startsWith('['))
  if (startLine < 0) return null

  const candidate = lines.slice(startLine).join('\n').trim()

  try {
    return JSON.parse(candidate)
  } catch {
    const firstBrace = candidate.indexOf('{')
    const lastBrace = candidate.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(candidate.slice(firstBrace, lastBrace + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

function corsHeaders(req) {
  const requestHeaders = req?.headers?.['access-control-request-headers']
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': requestHeaders || 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Expose-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

function send(req, res, code, data) {
  const headers = corsHeaders(req)
  if (code === 204) {
    headers['Content-Type'] = 'text/plain; charset=utf-8'
  }
  res.writeHead(code, headers)
  if (code === 204) {
    res.end()
    return
  }
  res.end(JSON.stringify(data))
}

function sendError(req, res, code, error, extra = {}) {
  return send(req, res, code, {
    ok: false,
    error,
    ...extra,
  })
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''

    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1024 * 1024) {
        reject(new Error('Request body too large'))
        req.destroy()
      }
    })

    req.on('end', () => {
      if (!raw) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })

    req.on('error', (error) => {
      reject(error)
    })
  })
}

function summarizeStatus(statusJson) {
  const agents = statusJson?.agents?.agents || []
  const defaults = statusJson?.sessions?.defaults || {}
  return {
    gatewayReachable: statusJson?.gateway?.reachable ?? null,
    gatewayMode: statusJson?.gateway?.mode || null,
    host: statusJson?.gateway?.self?.host || null,
    version: statusJson?.gateway?.self?.version || null,
    defaultAgent: statusJson?.agents?.defaultId || null,
    totalAgents: agents.length,
    totalSessions: statusJson?.agents?.totalSessions ?? statusJson?.sessions?.count ?? null,
    defaultModel: defaults.model || null,
    contextTokens: defaults.contextTokens || null,
    bootstrapPendingCount: statusJson?.agents?.bootstrapPendingCount ?? 0,
    memoryBackend: statusJson?.memory?.backend || null,
  }
}

function getRecentSessions(statusJson) {
  return statusJson?.sessions?.recent || []
}

function getAgentRows(statusJson) {
  return (statusJson?.agents?.agents || []).map((agent) => ({
    id: agent.id,
    name: agent.name || agent.id,
    workspaceDir: agent.workspaceDir,
    sessionsCount: agent.sessionsCount,
    bootstrapPending: agent.bootstrapPending,
    lastUpdatedAt: agent.lastUpdatedAt,
    lastActiveAgeMs: agent.lastActiveAgeMs,
  }))
}

function buildUsage(statusJson) {
  const recent = getRecentSessions(statusJson)
  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
  }
  const byModel = {}
  const byAgent = {}

  for (const item of recent) {
    totals.inputTokens += item.inputTokens || 0
    totals.outputTokens += item.outputTokens || 0
    totals.cacheRead += item.cacheRead || 0
    totals.cacheWrite += item.cacheWrite || 0
    totals.totalTokens += item.totalTokens || 0

    const model = item.model || 'unknown'
    byModel[model] = (byModel[model] || 0) + (item.totalTokens || 0)

    const agent = item.agentId || 'unknown'
    byAgent[agent] = (byAgent[agent] || 0) + (item.totalTokens || 0)
  }

  return {
    totals,
    byModel,
    byAgent,
    recentCount: recent.length,
  }
}

const cache = {
  updatedAt: null,
  refreshing: false,
  statusJson: null,
  statusRaw: '',
  statusError: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastDurationMs: null,
  lastLightweightDurationMs: null,
  stale: true,
  degraded: false,
  hasEverSucceeded: false,
  refreshCount: 0,
  failCount: 0,
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

function readTasksFile() {
  ensureDataDir()
  if (!fs.existsSync(TASKS_FILE)) {
    return {
      version: 2,
      updatedAt: null,
      tasks: [],
    }
  }

  try {
    const raw = fs.readFileSync(TASKS_FILE, 'utf8')
    const data = JSON.parse(raw)
    return {
      version: Number(data?.version) || 2,
      updatedAt: data?.updatedAt || null,
      tasks: Array.isArray(data?.tasks) ? data.tasks : [],
    }
  } catch {
    return {
      version: 2,
      updatedAt: null,
      tasks: [],
    }
  }
}

function writeTasksFile(data) {
  ensureDataDir()
  fs.writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2))
}

function readRunsFile() {
  ensureDataDir()
  if (!fs.existsSync(RUNS_FILE)) {
    return {
      version: 1,
      updatedAt: null,
      runs: [],
    }
  }

  try {
    const raw = fs.readFileSync(RUNS_FILE, 'utf8')
    const data = JSON.parse(raw)
    return {
      version: Number(data?.version) || 1,
      updatedAt: data?.updatedAt || null,
      runs: Array.isArray(data?.runs) ? data.runs : [],
    }
  } catch {
    return {
      version: 1,
      updatedAt: null,
      runs: [],
    }
  }
}

function writeRunsFile(data) {
  ensureDataDir()
  fs.writeFileSync(RUNS_FILE, JSON.stringify(data, null, 2))
}

function buildTaskId(agentId, type) {
  const base = `${agentId || 'unknown'}:${type || 'general'}`
  return `task_${crypto.createHash('md5').update(base).digest('hex').slice(0, 10)}`
}

function inferTaskType(agentId) {
  const map = {
    main: 'goal_orchestration',
    planner: 'plan_breakdown',
    builder: 'implementation',
    qa: 'review',
    reviewer: 'review',
  }
  return map[agentId] || 'general'
}

function inferTaskTitle(agentId) {
  const map = {
    main: '目标统筹',
    planner: '方案拆解',
    builder: '页面落地',
    qa: '回归复核',
    reviewer: '回归复核',
  }
  return map[agentId] || '通用任务'
}

function inferTaskStatus(agent, session) {
  if (agent?.bootstrapPending) return 'preparing'
  if (!session) {
    if ((agent?.lastActiveAgeMs ?? Infinity) > 24 * 60 * 60 * 1000) return 'paused'
    return 'queued'
  }
  if ((agent?.lastActiveAgeMs ?? Infinity) > 2 * 60 * 60 * 1000 && (session?.totalTokens || 0) === 0) return 'blocked'
  if ((session.percentUsed || 0) >= 80) return 'at_risk'
  if ((session.totalTokens || 0) >= 12000) return 'running'
  if ((session.totalTokens || 0) > 0) return 'in_progress'
  return 'queued'
}

function inferTaskPriority(agent, session) {
  if (agent?.id === 'main') return 'P0'
  if (agent?.bootstrapPending) return 'P1'
  if ((session?.percentUsed || 0) >= 80) return 'P1'
  if ((session?.totalTokens || 0) > 0) return 'P2'
  return 'P3'
}

function inferTaskStage(agent, session) {
  if (agent?.bootstrapPending) return '初始化'
  if (!session) return '排队中'
  if ((session.percentUsed || 0) >= 80) return '冲刺中'
  if ((session.totalTokens || 0) >= 12000) return '深度处理'
  if ((session.totalTokens || 0) > 0) return '执行中'
  return '观察中'
}

function inferTaskSummary(agent, session) {
  if (!agent) return '等待任务进入当前视图。'
  if (agent.bootstrapPending) return '正在建立运行上下文，等待任务状态稳定。'
  if ((session?.percentUsed || 0) >= 80) return '正在连续推进任务，同时已出现较高上下文占用。'
  if ((session?.totalTokens || 0) > 0) return '正在推进当前任务，并持续留下运行结果。'
  return '当前没有明显执行痕迹，更像处于待命或轻量跟进。'
}

function inferTaskStatusReason(status, agent, session) {
  if (status === 'preparing') return '智能体仍在启动，任务状态尚未稳定。'
  if (status === 'blocked') return '最近长时间没有形成有效推进，当前更像被卡住。'
  if (status === 'paused') return '当前长时间没有新的任务动作，进入暂停观察。'
  if (status === 'at_risk') return '上下文占用偏高，继续推进可能影响可持续性。'
  if (status === 'running') return '当前已有连续执行痕迹，任务处于深度推进中。'
  if (status === 'in_progress') return '当前已有明确推进，但还未进入深度执行。'
  if (status === 'queued') return '当前还没有进入明确执行链路。'
  if (status === 'done') return '任务已完成，当前主要观察结果是否稳定。'
  if (status === 'cancelled') return '任务已取消，不再继续推进。'
  return '状态原因待补充。'
}

function inferTaskWaitingForUser(status, agent, session) {
  if (!agent || status === 'done' || status === 'cancelled') return false
  if (status === 'blocked' && !session) return true
  return false
}

function inferTaskBlocked(status, agent, session) {
  if (status === 'blocked') return true
  if (!session && (agent?.lastActiveAgeMs ?? Infinity) > 24 * 60 * 60 * 1000) return true
  return false
}

function inferTaskBlockerType(status, agent, session) {
  if (status === 'blocked') {
    if (!session) return 'user_input'
    return 'runtime_stall'
  }
  return null
}

function inferTaskBlockerReason(status, agent, session) {
  const blockerType = inferTaskBlockerType(status, agent, session)
  if (blockerType === 'user_input') return '当前缺少新的用户输入或明确指令，任务先被挂起。'
  if (blockerType === 'runtime_stall') return '运行链路近期没有形成有效推进，任务暂时卡住。'
  return ''
}

function derivePendingActions(task) {
  const actions = []
  if (task.waitingForUser) {
    actions.push({
      key: 'request_user_input',
      type: 'user_input',
      title: '等待用户补充信息',
      detail: task.blockerReason || '需要新的用户输入后才能继续推进。',
      blocking: true,
    })
  }

  if (task.status === 'at_risk') {
    actions.push({
      key: 'reduce_context_pressure',
      type: 'operator_followup',
      title: '关注上下文占用',
      detail: '当前上下文占用偏高，建议尽快收口或切换推进方式。',
      blocking: false,
    })
  }

  if (task.status === 'blocked' && !task.waitingForUser) {
    actions.push({
      key: 'clear_runtime_blocker',
      type: 'operator_followup',
      title: '排查当前阻塞',
      detail: task.blockerReason || task.statusReason || '需要先排查阻塞原因，任务才能恢复推进。',
      blocking: true,
    })
  }

  return actions
}

function mapRunEventToTaskEvent(taskId, runEvent) {
  return {
    id: `${taskId}:run:${runEvent.id}`,
    type: `run_${runEvent.type || 'event'}`,
    title: runEvent.title || '运行事件',
    detail: runEvent.detail || '运行层产生了新的变化。',
    at: runEvent.at || new Date().toISOString(),
    sessionId: runEvent.sessionId || null,
    source: 'run',
    runEventType: runEvent.type || 'event',
  }
}

function sanitizeTaskStatus(status) {
  const allowed = new Set(['queued', 'preparing', 'in_progress', 'running', 'at_risk', 'blocked', 'paused', 'done', 'cancelled'])
  if (!status) return null
  return allowed.has(status) ? status : null
}

function sanitizeTaskPriority(priority) {
  const allowed = new Set(['P0', 'P1', 'P2', 'P3'])
  if (!priority) return null
  return allowed.has(priority) ? priority : null
}

function allowedTaskStatusTransitions(status) {
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

function statusLabelFromValue(status) {
  const map = {
    queued: 'queued',
    preparing: 'preparing',
    in_progress: 'in_progress',
    running: 'running',
    at_risk: 'at_risk',
    blocked: 'blocked',
    done: 'done',
    paused: 'paused',
    cancelled: 'cancelled',
  }
  return map[status] || status || 'queued'
}

function createManualTaskEvent(taskId, title, detail, extra = {}) {
  return {
    id: `${taskId}:${Date.now()}:${crypto.randomBytes(3).toString('hex')}`,
    type: extra.type || 'manual_update',
    title,
    detail,
    at: new Date().toISOString(),
    ...extra,
  }
}

function normalizeManualTaskInput(body = {}) {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const ownerAgentId = typeof body.ownerAgentId === 'string' ? body.ownerAgentId.trim() : 'main'
  const summary = typeof body.summary === 'string' ? body.summary.trim() : ''
  const rawStatus = typeof body.status === 'string' ? body.status.trim() : 'queued'
  const status = sanitizeTaskStatus(rawStatus)
  const statusReason = typeof body.statusReason === 'string' ? body.statusReason.trim() : ''
  const rawPriority = typeof body.priority === 'string' ? body.priority.trim() : 'P2'
  const priority = sanitizeTaskPriority(rawPriority)
  const stage = typeof body.stage === 'string' ? body.stage.trim() : '新建'
  const type = typeof body.type === 'string' && body.type.trim() ? body.type.trim() : 'general'

  if (!title) {
    return { ok: false, error: 'title is required' }
  }

  if (!status) {
    return { ok: false, error: `invalid status: ${rawStatus}` }
  }

  if (!priority) {
    return { ok: false, error: `invalid priority: ${rawPriority}` }
  }

  return {
    ok: true,
    value: {
      title,
      ownerAgentId: ownerAgentId || 'main',
      summary: summary || '等待补充任务摘要。',
      status,
      statusReason: statusReason || '',
      priority,
      stage: stage || '新建',
      type,
    },
  }
}

function pickTaskFieldsFromQuery(searchParams) {
  const raw = searchParams.get('fields') || searchParams.get('include') || ''
  const requested = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  if (!requested.length) return null

  const allowed = new Set(['pendingActions', 'events'])
  return requested.filter((item) => allowed.has(item))
}

function applyTaskResponseFields(item, fields) {
  if (!fields || !fields.length) return item
  const next = { ...item }
  if (fields.includes('pendingActions')) {
    next.pendingActions = derivePendingActions(item)
  }
  if (fields.includes('events')) {
    next.events = item.events || []
  }
  return next
}

function filterTaskItems(items, searchParams) {
  const status = sanitizeTaskStatus(searchParams.get('status') || '')
  const source = (searchParams.get('source') || '').trim()
  const ownerAgentId = (searchParams.get('ownerAgentId') || searchParams.get('agentId') || '').trim()
  const writable = searchParams.get('writable')
  const q = (searchParams.get('q') || '').trim().toLowerCase()
  const limit = Math.max(1, Math.min(Number(searchParams.get('limit') || items.length || 50), 200))

  return items
    .filter((item) => {
      if (status && item.status !== status) return false
      if (source && item.source !== source) return false
      if (ownerAgentId && item.ownerAgentId !== ownerAgentId) return false
      if (writable === 'true' && !item.writable) return false
      if (writable === 'false' && item.writable) return false
      if (q) {
        const haystack = [item.title, item.summary, item.statusReason, item.blockerReason, item.type, item.ownerAgentId]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
    .slice(0, limit)
}

function createTaskAuditEvent(taskId, type, title, detail, extra = {}) {
  return {
    id: `${taskId}:${type}:${Date.now()}:${crypto.randomBytes(3).toString('hex')}`,
    type,
    title,
    detail,
    at: new Date().toISOString(),
    ...extra,
  }
}

function buildTaskAuditEvents(previous, nextTask) {
  const events = []

  if (!previous) {
    events.push(createTaskAuditEvent(nextTask.id, 'task_created', '任务已建立', `${nextTask.stage} · ${nextTask.summary}`))
    return events
  }

  if ((previous.status || '') !== (nextTask.status || '')) {
    events.push(createTaskAuditEvent(nextTask.id, 'status_changed', '任务状态已变化', `${previous.status || '无'} → ${nextTask.status || '无'}`))
  }

  if ((previous.priority || '') !== (nextTask.priority || '')) {
    events.push(createTaskAuditEvent(nextTask.id, 'priority_changed', '任务优先级已变化', `${previous.priority || '无'} → ${nextTask.priority || '无'}`))
  }

  if ((previous.stage || '') !== (nextTask.stage || '')) {
    events.push(createTaskAuditEvent(nextTask.id, 'stage_changed', '任务阶段已变化', `${previous.stage || '无'} → ${nextTask.stage || '无'}`))
  }

  if ((previous.summary || '') !== (nextTask.summary || '')) {
    events.push(createTaskAuditEvent(nextTask.id, 'summary_changed', '任务摘要已变化', nextTask.summary || '摘要已清空'))
  }

  if ((previous.statusReason || '') !== (nextTask.statusReason || '') && nextTask.statusReason) {
    events.push(createTaskAuditEvent(nextTask.id, 'status_reason_changed', '状态原因已变化', nextTask.statusReason))
  }

  if ((previous.latestContextPercent ?? null) !== (nextTask.latestContextPercent ?? null) && nextTask.latestContextPercent != null) {
    events.push(createTaskAuditEvent(nextTask.id, 'context_changed', '任务上下文占用变化', `${previous.latestContextPercent ?? '—'}% → ${nextTask.latestContextPercent}%`))
  }

  if ((previous.ownerSessionId || null) !== (nextTask.ownerSessionId || null) && nextTask.ownerSessionId) {
    events.push(createTaskAuditEvent(nextTask.id, 'session_changed', '任务负责会话已切换', nextTask.ownerSessionId, { sessionId: nextTask.ownerSessionId }))
  }

  return events
}

function eventCategory(type = '') {
  if (type.startsWith('run_')) return 'run'
  if (type.includes('risk')) return 'risk'
  if (type.includes('context')) return 'context'
  if (type.includes('session')) return 'session'
  if (type.includes('status')) return 'status'
  if (type.includes('priority')) return 'priority'
  if (type.includes('stage')) return 'stage'
  if (type.includes('summary')) return 'summary'
  if (type.includes('model')) return 'model'
  return 'other'
}

function dedupeWindowKey(event) {
  const bucket = Math.floor(new Date(event.at || Date.now()).getTime() / (5 * 60 * 1000))
  return `${eventCategory(event.type || '')}:${event.detail || ''}:${event.sessionId || ''}:${bucket}`
}

function mergeTaskEvents(existingEvents = [], nextEvents = []) {
  const merged = [...nextEvents, ...existingEvents]
  const seenIds = new Set()
  const seenWindows = new Set()
  return merged.filter((item) => {
    if (!item?.id || seenIds.has(item.id)) return false
    const windowKey = dedupeWindowKey(item)
    if (seenWindows.has(windowKey)) return false
    seenIds.add(item.id)
    seenWindows.add(windowKey)
    return true
  }).slice(0, 24)
}

function createManualTask(input) {
  const now = new Date().toISOString()
  const id = `task_manual_${crypto.randomBytes(6).toString('hex')}`
  const statusLabel = statusLabelFromValue(input.status)
  const waitingForUser = input.status === 'blocked' && !input.statusReason
  const blocked = input.status === 'blocked'
  const blockerType = blocked ? (waitingForUser ? 'user_input' : 'manual_block') : null
  const blockerReason = blocked
    ? (input.statusReason || (waitingForUser ? '当前缺少新的用户输入或明确指令，任务先被挂起。' : '任务已被手工标记为阻塞。'))
    : ''
  return {
    id,
    version: 2,
    title: input.title,
    type: input.type,
    source: 'manual',
    ownerAgentId: input.ownerAgentId,
    ownerSessionId: null,
    status: input.status,
    waitingForUser,
    blocked,
    blockerType,
    blockerReason,
    priority: input.priority,
    stage: input.stage,
    summary: input.summary,
    statusReason: input.statusReason || '',
    latestContextPercent: null,
    totalTokens: 0,
    sessionCount: 0,
    lastActiveAgeMs: null,
    lastSession: null,
    createdAt: now,
    updatedAt: now,
    events: [
      createManualTaskEvent(id, '任务已创建', `${statusLabel} · ${input.summary}`, { type: 'task_created' }),
    ],
    compatibility: {
      agentId: input.ownerAgentId,
      sessionsCount: 0,
    },
  }
}

function buildTaskStorePayload(tasks, version = 2) {
  return {
    version,
    updatedAt: new Date().toISOString(),
    tasks,
  }
}

function upsertTaskStore(mutator) {
  const file = readTasksFile()
  const currentTasks = Array.isArray(file.tasks) ? file.tasks : []
  const nextTasks = mutator(currentTasks)
  const payload = buildTaskStorePayload(nextTasks, 2)
  writeTasksFile(payload)
  return payload
}

function deriveTasksFromStatus(statusJson, previousTasks = [], runs = []) {
  const agents = getAgentRows(statusJson)
  const recentSessions = getRecentSessions(statusJson)
  const previousById = new Map(previousTasks.map((item) => [item.id, item]))
  const runsByAgentId = new Map((runs || []).map((item) => [item.agentId, item]))

  const tasks = agents.map((agent) => {
    const sessions = recentSessions.filter((item) => item.agentId === agent.id)
    const latestSession = sessions[0] || null
    const taskType = inferTaskType(agent.id)
    const taskId = buildTaskId(agent.id, taskType)
    const previous = previousById.get(taskId)
    const status = inferTaskStatus(agent, latestSession)
    const priority = inferTaskPriority(agent, latestSession)
    const stage = inferTaskStage(agent, latestSession)
    const summary = inferTaskSummary(agent, latestSession)
    const totalTokens = sessions.reduce((sum, item) => sum + (item.totalTokens || 0), 0)
    const waitingForUser = inferTaskWaitingForUser(status, agent, latestSession)
    const blocked = inferTaskBlocked(status, agent, latestSession)
    const blockerType = inferTaskBlockerType(status, agent, latestSession)
    const blockerReason = inferTaskBlockerReason(status, agent, latestSession)
    const nextTaskBase = {
      id: taskId,
      version: 1,
      title: inferTaskTitle(agent.id),
      type: taskType,
      source: 'derived_from_runtime',
      ownerAgentId: agent.id,
      ownerSessionId: latestSession?.sessionId || null,
      status,
      waitingForUser,
      blocked,
      blockerType,
      blockerReason,
      statusReason: inferTaskStatusReason(status, agent, latestSession),
      priority,
      stage,
      summary,
      latestContextPercent: latestSession?.percentUsed ?? null,
      totalTokens,
      sessionCount: sessions.length,
      lastActiveAgeMs: agent.lastActiveAgeMs ?? latestSession?.age ?? null,
      lastSession: latestSession
        ? {
            sessionId: latestSession.sessionId || null,
            model: latestSession.model || null,
            totalTokens: latestSession.totalTokens || 0,
            percentUsed: latestSession.percentUsed ?? null,
            age: latestSession.age ?? null,
          }
        : null,
      createdAt: previous?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      compatibility: {
        agentId: agent.id,
        sessionsCount: sessions.length,
      },
    }
    const run = runsByAgentId.get(agent.id)
    const runEvents = (run?.events || []).slice(0, 8).map((event) => mapRunEventToTaskEvent(taskId, event))
    const auditEvents = buildTaskAuditEvents(previous, nextTaskBase)
    const events = mergeTaskEvents(previous?.events || [], [...auditEvents, ...runEvents])

    return {
      ...nextTaskBase,
      events,
    }
  })

  return tasks
}

function refreshTasksStoreFromCache() {
  const file = readTasksFile()
  const runsStore = getRunsStore()
  const existingTasks = Array.isArray(file.tasks) ? file.tasks : []
  const manualTasks = existingTasks.filter((item) => item?.source === 'manual')
  const derivedTasks = deriveTasksFromStatus(cache.statusJson, existingTasks, runsStore.runs || [])
  const payload = {
    version: 2,
    updatedAt: new Date().toISOString(),
    tasks: [...manualTasks, ...derivedTasks],
  }
  writeTasksFile(payload)
  return payload
}

function getTaskStore() {
  const file = readTasksFile()
  if (cache.statusJson) {
    return refreshTasksStoreFromCache()
  }
  return file
}

function buildTaskResponseItem(task) {
  const normalizedTask = {
    ...task,
    waitingForUser: Boolean(task.waitingForUser),
    blocked: Boolean(task.blocked),
    blockerReason: task.blockerReason || '',
    blockerType: task.blockerType || null,
  }
  const pendingActions = derivePendingActions(normalizedTask)

  return {
    id: task.id,
    version: task.version,
    title: task.title,
    type: task.type,
    source: task.source,
    ownerAgentId: task.ownerAgentId,
    ownerSessionId: task.ownerSessionId,
    status: task.status,
    waitingForUser: normalizedTask.waitingForUser,
    blocked: normalizedTask.blocked,
    blockerReason: normalizedTask.blockerReason,
    blockerType: normalizedTask.blockerType,
    pendingActionsCount: pendingActions.length,
    statusReason: task.statusReason || '',
    allowedTransitions: task.source === 'manual' ? allowedTaskStatusTransitions(task.status) : [],
    priority: task.priority,
    stage: task.stage,
    summary: task.summary,
    latestContextPercent: task.latestContextPercent,
    totalTokens: task.totalTokens,
    sessionCount: task.sessionCount,
    lastActiveAgeMs: task.lastActiveAgeMs,
    lastSession: task.lastSession,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    compatibility: task.compatibility,
    writable: task.source === 'manual',
  }
}

function buildAgentSemanticProfile(agent, sessions = [], tasks = []) {
  const id = agent?.id || 'unknown'
  const latestSession = sessions[0] || null
  const totalTokens = sessions.reduce((sum, item) => sum + (item.totalTokens || 0), 0)
  const ownedTasks = tasks.filter((task) => task.ownerAgentId === id)

  const profiles = {
    main: {
      name: '龙龙',
      avatar: '🐉',
      role: '主控 Agent',
      category: 'orchestrator',
      style: '对外主表达 / 决策中枢',
      mission: '承接用户意图，统筹方向判断与结果输出。',
      capability: '擅长对齐目标、做最终判断、维持整体节奏。',
      responsibilities: ['对齐用户目标', '决定当前方向', '汇总并对外输出结果'],
    },
    planner: {
      name: '规划师',
      avatar: '📋',
      role: '方案 / 拆解',
      category: 'planner',
      style: '策略层 / 结构设计',
      mission: '负责把模糊目标拆成明确结构与执行路径。',
      capability: '擅长信息架构、步骤拆解、优先级规划。',
      responsibilities: ['拆解复杂目标', '设计信息架构', '安排执行顺序'],
    },
    builder: {
      name: '执行者',
      avatar: '🔧',
      role: '开发 / 落地',
      category: 'builder',
      style: '实现层 / 结果生产',
      mission: '把已经确认的方向落成页面、代码和交付结果。',
      capability: '擅长前端实现、视觉细化、快速落地。',
      responsibilities: ['落地界面与代码', '细化视觉与交互', '把方案变成交付'],
    },
    qa: {
      name: '质检员',
      avatar: '🔍',
      role: '检查 / 复核',
      category: 'reviewer',
      style: '复核层 / 质量守门',
      mission: '检查交互、风险和方向偏移，避免页面越做越重。',
      capability: '擅长回归检查、细节复核、风险提示。',
      responsibilities: ['复核方向偏移', '检查页面负担', '补充风险提醒'],
    },
    reviewer: {
      name: '审查',
      avatar: '🔍',
      role: '检查 / 复核',
      category: 'reviewer',
      style: '复核层 / 质量守门',
      mission: '检查交互、风险和方向偏移，避免页面越做越重。',
      capability: '擅长回归检查、细节复核、风险提示。',
      responsibilities: ['复核方向偏移', '检查页面负担', '补充风险提醒'],
    },
  }

  const base = profiles[id] || {
    name: agent?.name || id,
    avatar: '🤖',
    role: 'Agent',
    category: 'general',
    style: '通用角色',
    mission: '承担当前智能体任务。',
    capability: '能力信息待补充。',
    responsibilities: ['承担当前任务', '维持基本输出', '等待更多上下文'],
  }

  let state = 'off'
  let stateLabel = '离线'
  let headline = `${base.name} 当前未进入主可见链路`
  let summary = '当前没有可见活动信号，暂未进入主任务链路。'

  if (agent?.bootstrapPending) {
    state = 'pending'
    stateLabel = '启动中'
    headline = `${base.name} 正在接入并建立运行状态`
    summary = '刚进入运行过程，建议继续观察是否稳定。'
  } else if (agent?.lastActiveAgeMs == null) {
    state = 'off'
    stateLabel = '离线'
    headline = `${base.name} 当前未进入主可见链路`
    summary = '当前没有可见活动信号，暂未进入主任务链路。'
  } else if (agent.lastActiveAgeMs < 5 * 60 * 1000) {
    state = 'active'
    stateLabel = '持续活跃'
    headline = `${base.name} 正在当前链路里承担核心输出`
    summary = '最近持续有输出，处于当前视图的核心位置。'
  } else if (agent.lastActiveAgeMs < 60 * 60 * 1000) {
    state = 'warm'
    stateLabel = '在线'
    headline = `${base.name} 仍在当前链路里持续跟进`
    summary = '近期仍有参与，更多承担协同或跟进角色。'
  } else {
    state = 'idle'
    stateLabel = '空闲'
    headline = `${base.name} 当前处于待命观察位`
    summary = '当前没有连续输出，更接近待命状态。'
  }

  let currentTask = '当前没有明确输出任务，更多承担候场与支援角色。'
  if (agent?.bootstrapPending) {
    currentTask = '正在初始化当前任务环境，等待状态稳定。'
  } else if (latestSession?.totalTokens) {
    currentTask = '正在处理当前任务链路，并持续产出中间结果。'
  }

  let behavior = '最近行为较轻，当前更像在等待下一轮指令。'
  if (agent?.bootstrapPending) {
    behavior = '刚进入运行过程，行为特征还在形成。'
  } else if ((latestSession?.percentUsed || 0) >= 80) {
    behavior = '近期行为偏连续，已经出现明显的高占用信号。'
  } else if (latestSession?.totalTokens) {
    behavior = '最近行为稳定可见，说明它正在任务链里持续留下结果。'
  }

  let runtimeSignal = '当前信号较弱，更像处于待命或轻量活动状态。'
  if (agent?.bootstrapPending) {
    runtimeSignal = '正在启动，建议下一轮刷新继续观察。'
  } else if ((latestSession?.percentUsed || 0) >= 80) {
    runtimeSignal = '上下文占用偏高，后续可能需要压缩或切换任务焦点。'
  } else if (latestSession?.totalTokens) {
    runtimeSignal = '本轮已留下明显运行痕迹，适合继续追踪。'
  }

  return {
    id,
    name: base.name,
    avatar: base.avatar,
    role: base.role,
    category: base.category,
    style: base.style,
    mission: base.mission,
    capability: base.capability,
    responsibilities: base.responsibilities,
    state,
    stateLabel,
    headline,
    summary,
    currentTask,
    behavior,
    runtimeSignal,
    workspaceDir: agent?.workspaceDir || null,
    sessionsCount: agent?.sessionsCount ?? sessions.length,
    bootstrapPending: Boolean(agent?.bootstrapPending),
    lastUpdatedAt: agent?.lastUpdatedAt || null,
    lastActiveAgeMs: agent?.lastActiveAgeMs ?? latestSession?.age ?? null,
    totalTokens,
    latestSession: latestSession
      ? {
          sessionId: latestSession.sessionId || null,
          model: latestSession.model || null,
          totalTokens: latestSession.totalTokens || 0,
          percentUsed: latestSession.percentUsed ?? null,
          age: latestSession.age ?? null,
        }
      : null,
    ownedTasks: ownedTasks.map((task) => ({
      id: task.id,
      title: task.title || task.type || '通用任务',
      status: task.status,
      priority: task.priority,
      stage: task.stage,
      summary: task.summary,
      writable: task.source === 'manual',
      updatedAt: task.updatedAt,
    })),
  }
}

function getAgentProfiles() {
  const agents = getAgentRows(cache.statusJson)
  const byAgent = cache.statusJson?.sessions?.byAgent || []
  const store = getTaskStore()
  return agents.map((agent) => {
    const sessions = byAgent.find((item) => item.agentId === agent.id)?.recent || []
    return buildAgentSemanticProfile(agent, sessions, store.tasks || [])
  })
}

function buildRuntimePreviewLinks() {
  return {
    web: `http://127.0.0.1:${WEB_PORT}/`,
    apiViaWebProxy: `http://127.0.0.1:${WEB_PORT}/api/health`,
    directApi: `${API_BASE_URL}/api/health`,
  }
}

function buildRunStatus(agent, latestSession) {
  if (agent?.bootstrapPending) return 'bootstrapping'
  if (!latestSession) return 'idle'
  if ((latestSession.percentUsed || 0) >= 85) return 'high_pressure'
  if ((latestSession.totalTokens || 0) >= 12000) return 'running'
  if ((latestSession.totalTokens || 0) > 0) return 'active'
  return 'idle'
}

function buildRunRisk(status, agent, latestSession) {
  if (agent?.bootstrapPending) return '启动观察'
  if (status === 'high_pressure') return '高占用'
  if ((agent?.lastActiveAgeMs ?? Infinity) > 60 * 60 * 1000) return '长时静默'
  if ((agent?.lastActiveAgeMs ?? Infinity) < 5 * 60 * 1000) return '稳定运行'
  return '轻载运行'
}

function buildRunSummary(status, agent, latestSession) {
  if (agent?.bootstrapPending) return '刚进入运行过程，轨迹还在形成。'
  if (status === 'high_pressure') return '当前轨迹呈现连续推进 + 高上下文占用，应重点盯住后续可持续性。'
  if ((latestSession?.totalTokens || 0) >= 12000) return '当前轨迹偏深度执行，说明它正在承担连续输出链路。'
  if ((agent?.lastActiveAgeMs ?? Infinity) < 5 * 60 * 1000) return '当前轨迹稳定在线，持续留下可观察运行痕迹。'
  return '当前轨迹较弱，更像待命或阶段性收尾。'
}

function createRunEvent(runId, type, title, detail, extra = {}) {
  return {
    id: `${runId}:${type}:${Date.now()}:${crypto.randomBytes(3).toString('hex')}`,
    type,
    title,
    detail,
    at: new Date().toISOString(),
    ...extra,
  }
}

function buildRunEvents(run, sessions = []) {
  const items = []

  sessions.slice(0, 4).forEach((session, index) => {
    items.push({
      id: `${run.id}:session:${session.sessionId || index}`,
      type: 'session_snapshot',
      title: (session.totalTokens || 0) > 0 ? '留下新的运行痕迹' : '进入运行队列',
      detail: `${session.model || '模型待同步'} · ${session.totalTokens || 0} 资源 · ${session.percentUsed != null ? `上下文 ${session.percentUsed}%` : '上下文待同步'}`,
      at: new Date(Date.now() - (session.age || 0)).toISOString(),
      sessionId: session.sessionId || null,
    })
  })

  return items
}

function buildRunAuditEvents(previous, nextRun) {
  const events = []

  if (!previous) {
    events.push(createRunEvent(nextRun.id, 'run_created', '运行单元已建立', `${nextRun.statusLabel} · ${nextRun.summary}`))
    if (nextRun.riskLabel) {
      events.push(createRunEvent(nextRun.id, 'risk_snapshot', '初始风险快照', nextRun.riskLabel))
    }
    return events
  }

  if (previous.status !== nextRun.status) {
    events.push(createRunEvent(nextRun.id, 'status_changed', '运行状态已变化', `${previous.statusLabel || previous.status} → ${nextRun.statusLabel}`))
  }

  if ((previous.riskLabel || '') !== (nextRun.riskLabel || '')) {
    events.push(createRunEvent(nextRun.id, 'risk_changed', '风险标签已变化', `${previous.riskLabel || '无'} → ${nextRun.riskLabel || '无'}`))
  }

  if ((previous.contextPercent ?? null) !== (nextRun.contextPercent ?? null) && nextRun.contextPercent != null) {
    events.push(createRunEvent(nextRun.id, 'context_changed', '上下文占用变化', `${previous.contextPercent ?? '—'}% → ${nextRun.contextPercent}%`))
  }

  if ((previous.latestSession?.sessionId || null) !== (nextRun.latestSession?.sessionId || null) && nextRun.latestSession?.sessionId) {
    events.push(createRunEvent(nextRun.id, 'session_changed', '最新会话已切换', `${nextRun.latestSession.sessionId}`, { sessionId: nextRun.latestSession.sessionId }))
  }

  if ((previous.model || null) !== (nextRun.model || null) && nextRun.model) {
    events.push(createRunEvent(nextRun.id, 'model_changed', '运行模型已变化', `${previous.model || '未记录'} → ${nextRun.model}`))
  }

  return events
}

function mergeRunEvents(existingEvents = [], nextEvents = []) {
  const merged = [...nextEvents, ...existingEvents]
  const seenIds = new Set()
  const seenWindows = new Set()
  return merged.filter((item) => {
    if (!item?.id || seenIds.has(item.id)) return false
    const windowKey = dedupeWindowKey(item)
    if (seenWindows.has(windowKey)) return false
    seenIds.add(item.id)
    seenWindows.add(windowKey)
    return true
  }).slice(0, 24)
}

function buildRunsStorePayload(runs, version = 1) {
  return {
    version,
    updatedAt: new Date().toISOString(),
    runs,
  }
}

function buildRunsFromStatus(previousRuns = [], tasks = []) {
  const agents = getAgentRows(cache.statusJson)
  const byAgent = cache.statusJson?.sessions?.byAgent || []
  const previousById = new Map(previousRuns.map((item) => [item.id, item]))
  return agents.map((agent) => {
    const sessions = byAgent.find((item) => item.agentId === agent.id)?.recent || []
    const latestSession = sessions[0] || null
    const totalTokens = sessions.reduce((sum, item) => sum + (item.totalTokens || 0), 0)
    const status = buildRunStatus(agent, latestSession)
    const profile = buildAgentSemanticProfile(agent, sessions, tasks || [])
    const riskLabel = buildRunRisk(status, agent, latestSession)
    const summary = buildRunSummary(status, agent, latestSession)
    const statusLabelMap = {
      bootstrapping: '启动中',
      idle: '轻载 / 待命',
      active: '活跃中',
      running: '深度运行中',
      high_pressure: '高压运行中',
    }
    const runId = `run_${agent.id}`
    const previous = previousById.get(runId)
    const nextEvents = buildRunEvents({ id: runId, statusLabel: statusLabelMap[status] || status, summary }, sessions)
    const nextRunBase = {
      id: runId,
      agentId: agent.id,
      agentName: profile.name,
      agentRole: profile.role,
      status,
      statusLabel: statusLabelMap[status] || status,
      riskLabel,
      summary,
      model: latestSession?.model || null,
      totalTokens,
      contextPercent: latestSession?.percentUsed ?? null,
      sessionCount: sessions.length,
      lastActiveAgeMs: agent?.lastActiveAgeMs ?? latestSession?.age ?? null,
      bootstrapPending: Boolean(agent?.bootstrapPending),
      latestSession: latestSession
        ? {
            sessionId: latestSession.sessionId || null,
            model: latestSession.model || null,
            totalTokens: latestSession.totalTokens || 0,
            percentUsed: latestSession.percentUsed ?? null,
            age: latestSession.age ?? null,
          }
        : null,
      createdAt: previous?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      profile: {
        avatar: profile.avatar,
        style: profile.style,
        mission: profile.mission,
      },
    }
    const auditEvents = buildRunAuditEvents(previous, nextRunBase)
    return {
      ...nextRunBase,
      events: mergeRunEvents(previous?.events || [], [...auditEvents, ...nextEvents]),
    }
  })
}

function refreshRunsStoreFromCache() {
  const file = readRunsFile()
  const taskFile = readTasksFile()
  const payload = buildRunsStorePayload(buildRunsFromStatus(file.runs || [], taskFile.tasks || []), 1)
  writeRunsFile(payload)
  return payload
}

function getRunsStore() {
  const file = readRunsFile()
  if (cache.statusJson) {
    return refreshRunsStoreFromCache()
  }
  return file
}

async function refreshCache() {
  if (cache.refreshing) return false
  cache.refreshing = true
  cache.lastAttemptAt = new Date().toISOString()
  const startedAt = Date.now()

  try {
    const statusResult = await runFirst(['openclaw status --json', 'openclaw status'], { timeout: STATUS_TIMEOUT_MS, stopOnTimeout: true })
    const statusJson = tryParseJson(statusResult.stdout)

    cache.lastDurationMs = Date.now() - startedAt
    cache.refreshCount += 1

    if (statusResult.ok && statusJson) {
      cache.updatedAt = new Date().toISOString()
      cache.lastSuccessAt = cache.updatedAt
      cache.statusJson = statusJson
      cache.statusRaw = statusResult.stdout
      cache.statusError = null
      cache.stale = false
      cache.degraded = false
      cache.hasEverSucceeded = true
      refreshTasksStoreFromCache()
      return true
    }

    cache.statusError = statusResult.stderr || 'Failed to refresh status cache'
    cache.failCount += 1
    cache.stale = true
    cache.degraded = true
    return false
  } finally {
    cache.refreshing = false
  }
}

function scheduleRefresh(force = false) {
  if (cache.refreshing) return false

  const now = Date.now()
  const lastAttemptMs = cache.lastAttemptAt ? new Date(cache.lastAttemptAt).getTime() : 0
  if (!force && lastAttemptMs && now - lastAttemptMs < MIN_REFRESH_GAP_MS) return false

  refreshCache().catch((error) => {
    cache.statusError = error?.message || 'Background refresh failed'
    cache.failCount += 1
    cache.stale = true
    cache.degraded = true
    cache.refreshing = false
  })
  return true
}

function ensureRefreshForRequest() {
  if (!cache.updatedAt && !cache.refreshing) {
    scheduleRefresh()
    return
  }

  if (!cache.refreshing && cache.updatedAt) {
    const ageMs = Date.now() - new Date(cache.updatedAt).getTime()
    if (ageMs >= REFRESH_MS) scheduleRefresh()
  }
}

function buildFallbackOverview() {
  return {
    ok: true,
    degraded: true,
    now: new Date().toISOString(),
    cacheUpdatedAt: cache.updatedAt,
    summary: summarizeStatus(cache.statusJson),
    usage: buildUsage(cache.statusJson),
    agents: getAgentRows(cache.statusJson),
    recentSessions: getRecentSessions(cache.statusJson),
    status: {
      parsed: cache.statusJson,
      raw: cache.statusRaw,
      error: cache.statusError || 'Status cache is warming up',
      lightweight: null,
    },
    config: {
      root: ROOT,
      port: Number(PORT),
      webPort: WEB_PORT,
      pollingMs: 5000,
      refreshMs: REFRESH_MS,
      statusTimeoutMs: STATUS_TIMEOUT_MS,
      preview: buildRuntimePreviewLinks(),
    },
    cacheState: getCacheState(),
  }
}

function getCacheState() {
  return {
    updatedAt: cache.updatedAt,
    lastAttemptAt: cache.lastAttemptAt,
    lastSuccessAt: cache.lastSuccessAt,
    refreshing: cache.refreshing,
    stale: cache.stale,
    degraded: cache.degraded,
    hasEverSucceeded: cache.hasEverSucceeded,
    refreshCount: cache.refreshCount,
    failCount: cache.failCount,
    lastDurationMs: cache.lastDurationMs,
    lastLightweightDurationMs: cache.lastLightweightDurationMs,
  }
}

function getOverviewPayload() {
  const statusJson = cache.statusJson
  return {
    ok: true,
    degraded: cache.degraded,
    now: new Date().toISOString(),
    cacheUpdatedAt: cache.updatedAt,
    summary: summarizeStatus(statusJson),
    usage: buildUsage(statusJson),
    agents: getAgentRows(statusJson),
    recentSessions: getRecentSessions(statusJson),
    status: {
      parsed: statusJson,
      raw: cache.statusRaw,
      error: cache.statusError,
    },
    config: {
      root: ROOT,
      port: Number(PORT),
      webPort: WEB_PORT,
      pollingMs: 5000,
      refreshMs: REFRESH_MS,
      statusTimeoutMs: STATUS_TIMEOUT_MS,
      preview: buildRuntimePreviewLinks(),
    },
    cacheState: getCacheState(),
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(req, res, 204, {})

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const pathname = url.pathname

  if (pathname === '/api/tasks' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req)
      const normalized = normalizeManualTaskInput(body)
      if (!normalized.ok) {
        return sendError(req, res, 400, normalized.error)
      }

      const createdTask = createManualTask(normalized.value)
      const store = upsertTaskStore((tasks) => [createdTask, ...tasks])
      return send(req, res, 201, {
        ok: true,
        version: 2,
        updatedAt: store.updatedAt,
        item: {
          ...buildTaskResponseItem(createdTask),
          pendingActions: derivePendingActions(createdTask),
          events: createdTask.events || [],
        },
      })
    } catch (error) {
      return sendError(req, res, 400, error?.message || '创建任务失败')
    }
  }

  if (pathname.startsWith('/api/tasks/') && req.method === 'PATCH') {
    const parts = pathname.split('/').filter(Boolean)
    const taskId = decodeURIComponent(parts[2] || '')
    if (!taskId) {
      return sendError(req, res, 400, 'Task id is required')
    }

    try {
      const body = await readJsonBody(req)
      let updatedTask = null
      let foundTask = null

      const store = upsertTaskStore((tasks) => {
        return tasks.map((task) => {
          if (task.id !== taskId) return task
          foundTask = task

          if (task.source !== 'manual') {
            return task
          }

          const hasSummaryField = Object.prototype.hasOwnProperty.call(body, 'summary')
          const nextSummary = typeof body.summary === 'string' ? body.summary.trim() : null
          const rawNextStatus = typeof body.status === 'string' ? body.status.trim() : null
          const hasStatusField = Object.prototype.hasOwnProperty.call(body, 'status')
          const nextStatus = rawNextStatus ? sanitizeTaskStatus(rawNextStatus) : null
          const nextStatusReason = typeof body.statusReason === 'string' ? body.statusReason.trim() : null
          const nextStage = typeof body.stage === 'string' ? body.stage.trim() : null
          const rawNextPriority = typeof body.priority === 'string' ? body.priority.trim() : null
          const nextPriority = rawNextPriority ? sanitizeTaskPriority(rawNextPriority) : null
          const nextTitle = typeof body.title === 'string' ? body.title.trim() : null
          const nextOwnerAgentId = typeof body.ownerAgentId === 'string' ? body.ownerAgentId.trim() : null

          if (hasStatusField && !nextStatus) {
            throw new Error(`Invalid task status: ${rawNextStatus || '(empty)'}`)
          }

          if (rawNextPriority && !nextPriority) {
            throw new Error(`Invalid task priority: ${rawNextPriority}`)
          }

          if (nextStatus && nextStatus !== task.status) {
            const allowedNext = allowedTaskStatusTransitions(task.status)
            if (!allowedNext.includes(nextStatus)) {
              throw new Error(`Invalid task status transition: ${task.status} -> ${nextStatus}`)
            }
          }

          const patchEvents = []
          const mergedStatus = nextStatus || task.status
          const mergedStatusReason = nextStatusReason !== null ? nextStatusReason : (task.statusReason || '')
          const waitingForUser = mergedStatus === 'blocked' && !mergedStatusReason
          const blocked = mergedStatus === 'blocked'
          const blockerType = blocked ? (waitingForUser ? 'user_input' : 'manual_block') : null
          const blockerReason = blocked
            ? (mergedStatusReason || (waitingForUser ? '当前缺少新的用户输入或明确指令，任务先被挂起。' : '任务已被手工标记为阻塞。'))
            : ''
          const merged = {
            ...task,
            title: nextTitle || task.title,
            ownerAgentId: nextOwnerAgentId || task.ownerAgentId,
            summary: hasSummaryField ? (nextSummary || '等待补充任务摘要。') : task.summary,
            status: mergedStatus,
            waitingForUser,
            blocked,
            blockerType,
            blockerReason,
            statusReason: mergedStatusReason,
            priority: nextPriority || task.priority,
            stage: nextStage || task.stage,
            updatedAt: new Date().toISOString(),
            compatibility: {
              ...(task.compatibility || {}),
              agentId: nextOwnerAgentId || task.ownerAgentId,
            },
          }

          if (hasSummaryField && (nextSummary || '等待补充任务摘要。') !== task.summary) {
            patchEvents.push(createManualTaskEvent(task.id, '摘要已更新', nextSummary || '等待补充任务摘要。', { type: 'summary_updated' }))
          }

          if (nextStatus && nextStatus !== task.status) {
            patchEvents.push(createManualTaskEvent(task.id, '状态已更新', `${task.status} → ${nextStatus}`, { type: 'status_updated' }))
          }

          if (nextStage && nextStage !== task.stage) {
            patchEvents.push(createManualTaskEvent(task.id, '阶段已更新', `${task.stage} → ${nextStage}`, { type: 'stage_updated' }))
          }

          if (nextStatusReason !== null && nextStatusReason !== (task.statusReason || '')) {
            patchEvents.push(createManualTaskEvent(task.id, '状态原因已更新', nextStatusReason || '已清空状态原因', { type: 'status_reason_updated' }))
          }

          if (nextPriority && nextPriority !== task.priority) {
            patchEvents.push(createManualTaskEvent(task.id, '优先级已更新', `${task.priority} → ${nextPriority}`, { type: 'priority_updated' }))
          }

          if (nextTitle && nextTitle !== task.title) {
            patchEvents.push(createManualTaskEvent(task.id, '标题已更新', nextTitle, { type: 'title_updated' }))
          }

          if (nextOwnerAgentId && nextOwnerAgentId !== task.ownerAgentId) {
            patchEvents.push(createManualTaskEvent(task.id, '负责人已更新', `${task.ownerAgentId} → ${nextOwnerAgentId}`, { type: 'owner_updated' }))
          }

          merged.events = mergeTaskEvents(task.events || [], patchEvents)
          updatedTask = merged
          return merged
        })
      })

      if (!foundTask) {
        return sendError(req, res, 404, 'Task not found')
      }

      if (foundTask.source !== 'manual') {
        return sendError(req, res, 409, 'Only manual tasks are writable in v2')
      }

      return send(req, res, 200, {
        ok: true,
        version: 2,
        updatedAt: store.updatedAt,
        item: {
          ...buildTaskResponseItem(updatedTask),
          pendingActions: derivePendingActions(updatedTask),
          events: updatedTask.events || [],
        },
      })
    } catch (error) {
      return sendError(req, res, 400, error?.message || '更新任务失败')
    }
  }

  if (pathname === '/api/health') {
    ensureRefreshForRequest()
    return send(req, res, 200, {
      ok: true,
      service: 'agent-dashboard-api',
      cacheUpdatedAt: cache.updatedAt,
      refreshing: cache.refreshing,
      cacheState: getCacheState(),
    })
  }

  ensureRefreshForRequest()

  if (pathname === '/api/refresh') {
    scheduleRefresh(true)
    return send(req, res, 202, {
      ok: true,
      scheduled: true,
      cacheUpdatedAt: cache.updatedAt,
      cacheState: getCacheState(),
    })
  }

  if (pathname === '/api/overview') {
    if (cache.hasEverSucceeded || cache.statusJson) {
      return send(req, res, 200, getOverviewPayload())
    }
    return send(req, res, 200, buildFallbackOverview())
  }

  if (pathname === '/api/agents') {
    return send(req, res, 200, {
      ok: true,
      cacheUpdatedAt: cache.updatedAt,
      items: getAgentProfiles(),
      cacheState: getCacheState(),
      preview: buildRuntimePreviewLinks(),
    })
  }

  if (pathname.startsWith('/api/agents/') && pathname.endsWith('/profile')) {
    const id = decodeURIComponent(pathname.split('/api/agents/')[1].replace(/\/profile$/, ''))
    const byAgent = cache.statusJson?.sessions?.byAgent || []
    const agent = (cache.statusJson?.agents?.agents || []).find((a) => a.id === id)
    const sessions = byAgent.find((item) => item.agentId === id)?.recent || []
    const store = getTaskStore()

    if (!agent) {
      return sendError(req, res, 404, 'Agent not found', { cacheState: getCacheState() })
    }

    return send(req, res, 200, {
      ok: true,
      cacheUpdatedAt: cache.updatedAt,
      updatedAt: store.updatedAt,
      item: buildAgentSemanticProfile(agent, sessions, store.tasks || []),
      cacheState: getCacheState(),
    })
  }

  if (pathname === '/api/tasks') {
    const store = getTaskStore()
    const fields = pickTaskFieldsFromQuery(url.searchParams) || ['pendingActions']
    const items = filterTaskItems(store.tasks.map(buildTaskResponseItem), url.searchParams)
      .map((item) => applyTaskResponseFields(item, fields))

    return send(req, res, 200, {
      ok: true,
      version: 2,
      cacheUpdatedAt: cache.updatedAt,
      updatedAt: store.updatedAt,
      total: store.tasks.length,
      count: items.length,
      items,
      cacheState: getCacheState(),
    })
  }

  if (pathname === '/api/runs') {
    const store = getRunsStore()
    return send(req, res, 200, {
      ok: true,
      cacheUpdatedAt: cache.updatedAt,
      updatedAt: store.updatedAt,
      items: store.runs || [],
      cacheState: getCacheState(),
    })
  }

  if (pathname.startsWith('/api/runs/')) {
    const parts = pathname.split('/').filter(Boolean)
    const runId = decodeURIComponent(parts[2] || '')
    const sub = parts[3] || ''
    const store = getRunsStore()
    const run = (store.runs || []).find((item) => item.id === runId)

    if (!run) {
      return sendError(req, res, 404, 'Run not found', { cacheState: getCacheState() })
    }

    if (sub === 'events') {
      return send(req, res, 200, {
        ok: true,
        cacheUpdatedAt: cache.updatedAt,
        updatedAt: store.updatedAt,
        runId,
        items: run.events || [],
        cacheState: getCacheState(),
      })
    }

    if (!sub) {
      return send(req, res, 200, {
        ok: true,
        cacheUpdatedAt: cache.updatedAt,
        updatedAt: store.updatedAt,
        item: run,
        cacheState: getCacheState(),
      })
    }
  }

  if (pathname.startsWith('/api/tasks/')) {
    const parts = pathname.split('/').filter(Boolean)
    const taskId = decodeURIComponent(parts[2] || '')
    const sub = parts[3] || ''
    const store = getTaskStore()
    const task = store.tasks.find((item) => item.id === taskId)

    if (!task) {
      return sendError(req, res, 404, 'Task not found', { cacheState: getCacheState() })
    }

    if (sub === 'events') {
      const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') || (task.events || []).length || 24), 100))
      return send(req, res, 200, {
        ok: true,
        cacheUpdatedAt: cache.updatedAt,
        updatedAt: store.updatedAt,
        taskId,
        count: Math.min((task.events || []).length, limit),
        items: (task.events || []).slice(0, limit),
        cacheState: getCacheState(),
      })
    }

    if (!sub) {
      const fields = pickTaskFieldsFromQuery(url.searchParams) || ['pendingActions', 'events']
      const detail = applyTaskResponseFields({
        ...buildTaskResponseItem(task),
        pendingActions: derivePendingActions(task),
        events: task.events || [],
      }, fields)

      return send(req, res, 200, {
        ok: true,
        cacheUpdatedAt: cache.updatedAt,
        updatedAt: store.updatedAt,
        item: detail,
        cacheState: getCacheState(),
      })
    }
  }

  if (pathname.startsWith('/api/agent/')) {
    const id = decodeURIComponent(pathname.split('/api/agent/')[1] || '')
    const byAgent = cache.statusJson?.sessions?.byAgent || []
    const agent = (cache.statusJson?.agents?.agents || []).find((a) => a.id === id)
    const sessions = byAgent.find((a) => a.agentId === id)
    const store = getTaskStore()
    const profile = agent ? buildAgentSemanticProfile(agent, sessions?.recent || [], store.tasks || []) : null

    if (!agent) {
      return sendError(req, res, 404, 'Agent not found', { cacheState: getCacheState() })
    }

    return send(req, res, 200, {
      ok: true,
      cacheUpdatedAt: cache.updatedAt,
      cacheState: getCacheState(),
      agent: {
        id: agent.id,
        name: agent.name || agent.id,
        workspaceDir: agent.workspaceDir,
        sessionsCount: agent.sessionsCount,
        bootstrapPending: agent.bootstrapPending,
        lastUpdatedAt: agent.lastUpdatedAt,
        lastActiveAgeMs: agent.lastActiveAgeMs,
      },
      profile,
      tasks: (store.tasks || []).filter((item) => item.ownerAgentId === id).map(buildTaskResponseItem),
      sessions: sessions?.recent || [],
      preview: buildRuntimePreviewLinks(),
    })
  }

  sendError(req, res, 404, 'Not found')
})

server.listen(PORT, () => {
  console.log(`Agent dashboard API listening on http://localhost:${PORT}`)
  scheduleRefresh(true)
  setInterval(() => {
    scheduleRefresh()
  }, REFRESH_MS)
})
