import http from 'node:http'
import { exec as execCb } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execCb)
const PORT = process.env.PORT || 3456
const ROOT = process.cwd()
const REFRESH_MS = 15000
const STATUS_TIMEOUT_MS = 3500
const MIN_REFRESH_GAP_MS = 5000

async function runCommand(cmd, options = {}) {
  const timeout = options.timeout ?? 12000
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

function send(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(data))
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
      pollingMs: 5000,
      refreshMs: REFRESH_MS,
      statusTimeoutMs: STATUS_TIMEOUT_MS,
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
      pollingMs: 5000,
      refreshMs: REFRESH_MS,
      statusTimeoutMs: STATUS_TIMEOUT_MS,
    },
    cacheState: getCacheState(),
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {})

  if (req.url === '/api/health') {
    ensureRefreshForRequest()
    return send(res, 200, {
      ok: true,
      service: 'agent-dashboard-api',
      cacheUpdatedAt: cache.updatedAt,
      refreshing: cache.refreshing,
      cacheState: getCacheState(),
    })
  }

  ensureRefreshForRequest()

  if (req.url === '/api/refresh') {
    scheduleRefresh(true)
    return send(res, 202, {
      ok: true,
      scheduled: true,
      cacheUpdatedAt: cache.updatedAt,
      cacheState: getCacheState(),
    })
  }

  if (req.url === '/api/overview') {
    if (cache.hasEverSucceeded || cache.statusJson) {
      return send(res, 200, getOverviewPayload())
    }
    return send(res, 200, buildFallbackOverview())
  }

  if (req.url === '/api/agents') {
    return send(res, 200, {
      ok: true,
      cacheUpdatedAt: cache.updatedAt,
      items: getAgentRows(cache.statusJson),
      cacheState: getCacheState(),
    })
  }

  if (req.url?.startsWith('/api/agent/')) {
    const id = decodeURIComponent(req.url.split('/api/agent/')[1] || '')
    const byAgent = cache.statusJson?.sessions?.byAgent || []
    const agent = (cache.statusJson?.agents?.agents || []).find((a) => a.id === id)
    const sessions = byAgent.find((a) => a.agentId === id)

    if (!agent) {
      return send(res, 404, { ok: false, error: 'Agent not found', cacheState: getCacheState() })
    }

    return send(res, 200, {
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
      sessions: sessions?.recent || [],
    })
  }

  send(res, 404, { ok: false, error: 'Not found' })
})

server.listen(PORT, () => {
  console.log(`Agent dashboard API listening on http://localhost:${PORT}`)
  scheduleRefresh(true)
  setInterval(() => {
    scheduleRefresh()
  }, REFRESH_MS)
})
