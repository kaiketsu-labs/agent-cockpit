'use strict'

const STATUS = {
  blocked: { label: 'needs input', icon: 'bell-dot', color: 'charts.yellow', rank: 0 },
  working: { label: 'working', icon: 'sync~spin', color: 'charts.blue', rank: 1 },
  failed: { label: 'failed', icon: 'error', color: 'charts.red', rank: 2 },
  idle: { label: 'idle', icon: 'debug-pause', rank: 3 },
  done: { label: 'done', icon: 'check', color: 'disabledForeground', rank: 4 },
}

// Interactive sessions report waiting, busy or idle instead of a job state.
const interactiveState = status => ({ waiting: 'blocked', busy: 'working' })[status] ?? 'idle'

// From /proc/<pid>/stat: the parent pid is the second field after the parenthesised command.
const parentPid = stat => Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])

const ancestorPids = (pid, readStat) => {
  const pids = []
  for (let current = pid; current > 1 && pids.length < 32; current = parentPid(readStat(current))) pids.push(current)
  return pids
}

const normalizeTicket = ticket => {
  const trimmed = ticket.trim()
  return trimmed.includes('#') ? trimmed : trimmed.toUpperCase()
}

// Supports Jira/Linear keys (PROJ-123) and GitHub/GitLab issue refs (#42, owner/repo#42);
// TICKET_PROJECTS narrows Jira keys (any case), or customPattern overrides the regex.
const ticketPattern = (projects = [], customPattern = '') => {
  if (customPattern) {
    return {
      key: new RegExp(customPattern),
      suffix: new RegExp(`\\s*\\((${customPattern})\\)\\s*$`),
    }
  }
  if (projects.length > 0) {
    const key = `(?:${projects.join('|')})-\\d+`
    return { key: new RegExp(`\\b${key}\\b`, 'i'), suffix: new RegExp(`\\s*\\((${key})\\)\\s*$`, 'i') }
  }
  const key = '(?:\\b[A-Z][A-Z0-9]+-\\d+\\b|\\b[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+#\\d+\\b|(?<![A-Za-z0-9_.-])#\\d+\\b)'
  const suffixKey = '(?:[A-Z][A-Z0-9]+-\\d+|(?:[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+)?#\\d+)'
  return { key: new RegExp(key), suffix: new RegExp(`\\s*\\((${suffixKey})\\)\\s*$`) }
}

const firstTicket = (texts, pattern) => {
  for (const text of texts) {
    const match = text?.match(pattern.key)
    if (match) return normalizeTicket(match[0])
  }
  return undefined
}

const withoutTicketSuffix = (name, pattern) => name.replace(pattern.suffix, '')

const assignTicket = (name, ticket, pattern) => {
  const base = withoutTicketSuffix(name, pattern).trim()
  const key = ticket ? normalizeTicket(ticket) : ''
  return key ? `${base} (${key})` : base
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare

// Moved items keep the order they were dragged into; the rest follow alphabetically.
const sortByOrder = (items, keyOf, labelOf, order = []) => {
  const rank = item => {
    const index = order.indexOf(keyOf(item))
    return index === -1 ? Infinity : index
  }
  return [...items].sort((a, b) => rank(a) - rank(b) || byName(labelOf(a), labelOf(b)))
}

// Moving an item rewrites only its siblings' places in the order; other lists keep theirs.
const moveBefore = (order, siblings, moved, target) => {
  const rest = siblings.filter(key => key !== moved)
  const at = target === undefined ? rest.length : rest.indexOf(target)
  if (at === -1) return order
  rest.splice(at, 0, moved)
  return [...order.filter(key => !rest.includes(key)), ...rest]
}

const groupSessions = (sessions, order = [], options = {}) => {
  const opts = Array.isArray(order) ? options : order
  const orderList = Array.isArray(order) ? order : []
  const { unticketedSort } = opts
  const byTicket = new Map()
  for (const session of sessions) {
    const key = session.ticket ?? null
    byTicket.set(key, [...(byTicket.get(key) ?? []), session])
  }
  const groups = [...byTicket].map(([ticket, members]) => {
    const counts = Object.entries(STATUS)
      .map(([state, { label }]) => ({ label, count: members.filter(s => s.state === state).length }))
      .filter(({ count }) => count > 0)
    const sorted =
      ticket === null && unticketedSort === 'age'
        ? [...members].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || byName(a.name, b.name))
        : sortByOrder(members, s => s.id, s => s.name, orderList)
    return {
      ticket,
      sessions: sorted,
      counts,
      isActive: members.some(s => s.state !== 'done'),
    }
  })
  const ticketed = groups.filter(group => group.ticket !== null)
  return [...sortByOrder(ticketed, g => g.ticket, g => g.ticket, orderList), ...groups.filter(group => group.ticket === null)]
}

// GitHub search allows five OR operators, so six keys a query. Titles only: release PRs list every key in their body.
const searchQueries = (keys, size = 6) => {
  const queries = []
  for (let i = 0; i < keys.length; i += size) queries.push(`is:pr is:open in:title ${keys.slice(i, i + size).join(' OR ')}`)
  return queries
}

const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const keyInTitle = (title, key) => {
  const escaped = escapeRegExp(key)
  const bound = key.startsWith('#') ? `(?<![A-Za-z0-9_.-])${escaped}\\b` : `\\b${escaped}\\b`
  return new RegExp(bound, 'i').test(title)
}

const prsByTicket = (items, keys) => {
  const byTicket = {}
  for (const item of items) {
    for (const key of keys.filter(key => keyInTitle(item.title, key))) {
      const pr = {
        repo: item.repository_url.split('/').pop(),
        number: item.number,
        title: item.title,
        url: item.html_url,
        isDraft: item.draft === true,
      }
      byTicket[key] = [...(byTicket[key] ?? []), pr]
    }
  }
  return byTicket
}

// Tracker status category: new, indeterminate or done. A ticket the tracker didn't answer for stays active.
const isClosed = issue => issue?.category === 'done'

const HIDE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

// A working session stays in the list; else a hand-set flag wins, then closed tickets and a week without a turn hide it.
const isHidden = (session, now, isTicketClosed, flag) => {
  if (session.state === 'working') return false
  return flag ?? (isTicketClosed || now - session.updatedAt > HIDE_AFTER_MS)
}

const ticketOf = (name, pattern) => {
  const match = name?.match(pattern.suffix)?.[1]
  return match ? normalizeTicket(match) : undefined
}

const worktreeTicket = (cwd, pattern) => {
  const segment = cwd?.split('/.claude/worktrees/')[1]?.split('/')[0]
  return segment ? firstTicket([segment], pattern) : undefined
}

// Live sessions come from claude agents, the rest from the files the claude-deck plugin writes for every session.
// A bg session that left claude agents was deleted with claude rm; an interactive one ended and can be resumed.
const mergeSessions = (agents, files, pattern) => {
  const fileOf = new Map(files.map(file => [file.sessionId, file]))
  const withTicket = (session, fileTicket) => ({
    ...session,
    ticket:
      ticketOf(session.name, pattern) ??
      (fileTicket ? normalizeTicket(fileTicket) : undefined) ??
      worktreeTicket(session.cwd, pattern),
  })
  const live = agents.map(agent => {
    const file = fileOf.get(agent.sessionId) ?? {}
    const isBg = agent.id !== undefined
    return withTicket(
      {
        id: isBg ? agent.id : agent.sessionId,
        sessionId: agent.sessionId,
        pid: isBg ? undefined : agent.pid,
        name: (isBg ? file.name || agent.name : file.name || file.prompt || agent.name) || agent.sessionId.slice(0, 8),
        state: isBg ? agent.state : interactiveState(agent.status),
        detail: file.detail,
        updatedAt: file.lastTurnEndAt ?? agent.startedAt ?? 0,
        lastWriteAt: file.lastTurnEndAt,
        cwd: agent.cwd ?? file.cwd,
        interactive: !isBg,
      },
      file.ticket,
    )
  })
  const liveIds = new Set(agents.map(agent => agent.sessionId))
  const ended = files
    .filter(file => file.kind === 'interactive' && !liveIds.has(file.sessionId) && (file.name || file.prompt))
    .map(file =>
      withTicket(
        {
          id: file.sessionId,
          sessionId: file.sessionId,
          name: file.name || file.prompt,
          state: 'done',
          updatedAt: file.lastTurnEndAt ?? file.startedAt,
          cwd: file.cwd,
          ended: true,
        },
        file.ticket,
      ),
    )
  return [...live, ...ended]
}

// Mirrors Claude Code's choice of prompt cache TTL for the main thread: 5 minutes unless set to an hour.
const cacheTtlMs = env => {
  const ttl = env.CLAUDE_CODE_PROMPT_CACHE_TTL ?? (env.ENABLE_PROMPT_CACHING_1H || env.ENABLE_PROMPT_CACHING_1H_BEDROCK ? '1h' : '5m')
  return ttl === '1h' ? 60 * 60_000 : 5 * 60_000
}

const cacheLeft = (lastWriteMs, ttlMs, now) => Math.max(0, lastWriteMs + ttlMs - now)

const clock = ms => {
  const seconds = Math.ceil(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const age = ms => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

module.exports = {
  STATUS,
  normalizeTicket,
  ticketPattern,
  firstTicket,
  withoutTicketSuffix,
  assignTicket,
  sortByOrder,
  moveBefore,
  groupSessions,
  searchQueries,
  prsByTicket,
  isClosed,
  isHidden,
  ticketOf,
  mergeSessions,
  interactiveState,
  parentPid,
  ancestorPids,
  cacheTtlMs,
  cacheLeft,
  clock,
  age,
}
