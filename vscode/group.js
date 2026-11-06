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
      exact: new RegExp(`^(?:${customPattern})$`),
      suffix: new RegExp(`\\s*\\((${customPattern})\\)\\s*$`),
    }
  }
  if (projects.length > 0) {
    const key = `(?:${projects.join('|')})-\\d+`
    return {
      key: new RegExp(`\\b${key}\\b`, 'i'),
      exact: new RegExp(`^${key}$`, 'i'),
      suffix: new RegExp(`\\s*\\((${key})\\)\\s*$`, 'i'),
    }
  }
  const key = '(?:\\b[A-Z][A-Z0-9]+-\\d+\\b|\\b[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+#\\d+\\b|(?<![A-Za-z0-9_.-])#\\d+\\b)'
  const suffixKey = '(?:[A-Z][A-Z0-9]+-\\d+|(?:[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+)?#\\d+)'
  return {
    key: new RegExp(key),
    exact: new RegExp(`^${suffixKey}$`),
    suffix: new RegExp(`\\s*\\((${suffixKey})\\)\\s*$`),
  }
}

const firstTicket = (texts, pattern) => {
  for (const text of texts) {
    const match = text?.match(pattern.key)
    if (match) return normalizeTicket(match[0])
  }
  return undefined
}

const isTicketKey = (folder, pattern = ticketPattern()) =>
  typeof folder === 'string' && Boolean(folder.trim()) && (pattern.exact ?? pattern.key).test(folder.trim())

const folderTicket = (folder, pattern = ticketPattern()) =>
  typeof folder === 'string' ? firstTicket([folder], pattern) : undefined

const normalizeFolder = (folder, pattern = ticketPattern()) => {
  if (!folder || typeof folder !== 'string') return undefined
  const trimmed = folder.trim()
  if (!trimmed) return undefined
  return isTicketKey(trimmed, pattern) ? normalizeTicket(trimmed) : trimmed
}

const withoutTicketSuffix = (name, pattern) => (name ? name.replace(pattern.suffix, '').trim() : '')

const assignTicket = (name, _folder, pattern) => withoutTicketSuffix(name, pattern)

// Encodes an absolute working directory path the way Claude Code names directories under ~/.claude/projects/.
const encodeProjectPath = cwd => String(cwd ?? '').replace(/[^a-zA-Z0-9-]/g, '-')

const customTitleLine = (sessionId, customTitle) => `${JSON.stringify({ type: 'custom-title', customTitle, sessionId })}\n`

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
  const { unticketedSort, folders = [] } = opts
  const byFolder = new Map()
  for (const folder of folders) {
    if (folder) byFolder.set(folder, [])
  }
  for (const session of sessions) {
    const key = session.folder ?? session.ticket ?? null
    byFolder.set(key, [...(byFolder.get(key) ?? []), session])
  }
  const groups = [...byFolder].map(([ticket, members]) => {
    const counts = Object.entries(STATUS)
      .map(([state, { label }]) => ({ label, count: members.filter(s => s.state === state).length }))
      .filter(({ count }) => count > 0)
    const sorted =
      ticket === null && unticketedSort === 'age'
        ? [...members].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || byName(a.name, b.name))
        : sortByOrder(members, s => s.id, s => s.name, orderList)
    return {
      ticket,
      folder: ticket,
      sessions: sorted,
      counts,
      isActive: members.some(s => s.state !== 'done'),
    }
  })
  const grouped = groups.filter(group => group.ticket !== null)
  return [...sortByOrder(grouped, g => g.ticket, g => g.ticket, orderList), ...groups.filter(group => group.ticket === null)]
}

const parseGithubRemote = stdout => {
  if (!stdout) return undefined
  for (const line of stdout.split('\n')) {
    const match = line.match(
      /(?:(?:https?|ssh):\/\/(?:[^@/\s]+@)?|(?:[^@/\s]+@)?)([^/:\s]*(?:github|ghe)[^/:\s]*?)(?::\d+)?[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\s|\(|$)/i,
    )
    if (match) return { repo: `${match[2]}/${match[3]}`, host: match[1].toLowerCase() }
  }
  return undefined
}

// GitHub search allows five OR operators, so six keys a query. Titles only: release PRs list every key in their body.
// When repo scoping is available, queries are scoped to relevant repos to avoid matching random public repos.
const searchQueries = (keys, size = 6, options = {}) => {
  const { reposByTicket = {}, defaultRepos = [], githubOrg } = options
  const hasOptions = Boolean(options.reposByTicket || options.defaultRepos || options.repos || options.githubOrg)
  const fallbackRepos = (options.repos ?? defaultRepos).filter(Boolean)
  const cleanOrg = typeof githubOrg === 'string' && githubOrg.trim() ? githubOrg.trim() : undefined

  if (!hasOptions) {
    const queries = []
    for (let i = 0; i < keys.length; i += size) queries.push(`is:pr is:open in:title ${keys.slice(i, i + size).join(' OR ')}`)
    return queries
  }

  const byScope = new Map()

  for (const key of keys) {
    let repoList = []
    let term = key

    if (key.includes('/') && key.includes('#')) {
      const parts = key.split('#')
      repoList = [parts[0]]
      term = `#${parts[1]}`
    } else if (key.startsWith('#')) {
      // For bare GitHub issues (#12): only match if we are sure about the exact repo
      if (reposByTicket[key]) {
        repoList = [reposByTicket[key]]
      } else {
        // Unknown repo for a bare issue number like #12: skip to avoid matching random public repos globally
        continue
      }
    } else {
      // Jira keys:
      if (cleanOrg) {
        const scopePrefix = `org:${cleanOrg} `
        if (!byScope.has(scopePrefix)) byScope.set(scopePrefix, [])
        byScope.get(scopePrefix).push(term)
        continue
      }
      if (reposByTicket[key]) {
        repoList = Array.isArray(reposByTicket[key]) ? reposByTicket[key] : [reposByTicket[key]]
      } else if (fallbackRepos.length > 0) {
        repoList = fallbackRepos
      } else {
        // No known repos: do NOT search all of GitHub globally
        continue
      }
    }

    for (const repo of repoList) {
      const repoName = typeof repo === 'object' && repo ? repo.repo : repo
      const scopePrefix = repoName && typeof repoName === 'string' && repoName.trim() ? `repo:${repoName.trim()} ` : ''
      if (!scopePrefix) continue
      if (!byScope.has(scopePrefix)) byScope.set(scopePrefix, [])
      byScope.get(scopePrefix).push(term)
    }
  }

  const queries = []
  for (const [scopePrefix, terms] of byScope) {
    for (let i = 0; i < terms.length; i += size) {
      queries.push(`${scopePrefix}is:pr is:open in:title ${terms.slice(i, i + size).join(' OR ')}`)
    }
  }
  return queries
}

const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const keyInTitle = (title, key) => {
  const escaped = escapeRegExp(key)
  const bound = key.startsWith('#') ? `(?<![A-Za-z0-9_.-])${escaped}\\b` : `\\b${escaped}\\b`
  return new RegExp(bound, 'i').test(title)
}

const itemRepoOf = item => {
  const url = item?.repository_url || ''
  const parts = url.split('/')
  return parts.length >= 2 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : parts[parts.length - 1]
}

const prsByTicket = (items, keys, options = {}) => {
  const { reposByTicket = {}, defaultRepos = [], githubOrg } = options
  const fallbackRepos = (options.repos ?? defaultRepos).map(r => (typeof r === 'object' && r ? r.repo : r).toLowerCase())
  const cleanOrg = typeof githubOrg === 'string' && githubOrg.trim() ? githubOrg.trim().toLowerCase() : undefined
  const hasOptions = Boolean(options.reposByTicket || options.defaultRepos || options.repos || options.githubOrg)
  const byTicket = {}

  for (const item of items) {
    const itemRepo = itemRepoOf(item).toLowerCase()
    const itemRepoShort = item.repository_url ? item.repository_url.split('/').pop().toLowerCase() : ''

    for (const key of keys) {
      let expectedRepo
      let term = key

      if (key.includes('/') && key.includes('#')) {
        const parts = key.split('#')
        expectedRepo = parts[0].toLowerCase()
        term = `#${parts[1]}`
      } else if (key.startsWith('#')) {
        // Bare GitHub issues: ONLY match if we are sure about the repo
        if (reposByTicket[key]) {
          const r = reposByTicket[key]
          expectedRepo = (typeof r === 'object' && r ? r.repo : r).toLowerCase()
        } else if (hasOptions) {
          continue
        }
      } else if (reposByTicket[key]) {
        const r = reposByTicket[key]
        expectedRepo = (typeof r === 'object' && r ? r.repo : r).toLowerCase()
      }

      if (expectedRepo) {
        const matchesRepo = itemRepo === expectedRepo || itemRepoShort === expectedRepo || expectedRepo.endsWith('/' + itemRepoShort)
        if (!matchesRepo) continue
      } else if (hasOptions && key.startsWith('#')) {
        continue
      } else if (cleanOrg) {
        // For Jira keys with githubOrg, accept any repo belonging to that organization
        const inOrg = itemRepo.startsWith(`${cleanOrg}/`)
        if (!inOrg) continue
      } else if (hasOptions && fallbackRepos.length > 0) {
        const matchesAny = fallbackRepos.some(r => itemRepo === r || itemRepoShort === r || r.endsWith('/' + itemRepoShort))
        if (!matchesAny) continue
      } else if (hasOptions) {
        continue
      }

      const numMatch = key.startsWith('#') && Number(key.slice(1)) === item.number
      const explicitNumMatch = key.includes('#') && Number(key.split('#')[1]) === item.number
      const titleMatch = keyInTitle(item.title, term) || keyInTitle(item.title, key)

      if (numMatch || explicitNumMatch || titleMatch) {
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

// Live sessions come from claude agents, the rest from the files the agent-cockpit plugin writes for every session.
// A bg session that left claude agents was deleted with claude rm; an interactive one ended and can be resumed.
const mergeSessions = (agents, files, pattern) => {
  const fileOf = new Map(files.map(file => [file.sessionId, file]))
  const withFolder = (session, fileFolder) => {
    const resolved =
      fileFolder === null
        ? null
        : (normalizeFolder(fileFolder, pattern) ??
           ticketOf(session.name, pattern) ??
           worktreeTicket(session.cwd, pattern))
    return {
      ...session,
      name: withoutTicketSuffix(session.name, pattern) || session.name,
      folder: resolved,
      ticket: resolved,
    }
  }
  const live = agents.map(agent => {
    const file = fileOf.get(agent.sessionId) ?? {}
    const isBg = agent.id !== undefined
    const keepWarm = Boolean(file.keepWarm && (!file.keepWarmUntil || file.keepWarmUntil > Date.now()))
    return withFolder(
      {
        id: isBg ? agent.id : agent.sessionId,
        sessionId: agent.sessionId,
        pid: isBg ? undefined : agent.pid,
        name: (isBg ? file.name || agent.name : file.name || file.prompt || agent.name) || agent.sessionId.slice(0, 8),
        hasCustomName: Boolean(file.name),
        state: isBg ? agent.state : interactiveState(agent.status),
        updatedAt: file.lastTurnEndAt ?? agent.startedAt ?? 0,
        lastWriteAt: file.lastTurnEndAt,
        cwd: agent.cwd ?? file.cwd,
        interactive: !isBg,
        keepWarm,
        contextTokens: file.contextTokens,
        model: file.model,
      },
      file.folder ?? file.ticket,
    )
  })
  const liveIds = new Set(agents.map(agent => agent.sessionId))
  const ended = files
    .filter(file => file.kind === 'interactive' && !liveIds.has(file.sessionId) && (file.name || file.prompt))
    .map(file =>
      withFolder(
        {
          id: file.sessionId,
          sessionId: file.sessionId,
          name: file.name || file.prompt,
          state: 'done',
          updatedAt: file.lastTurnEndAt ?? file.startedAt,
          cwd: file.cwd,
          ended: true,
        },
        file.folder ?? file.ticket,
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

const NEEDS_YOU = new Set(['blocked', 'failed'])
const IS_BUSY = new Set(['blocked', 'failed', 'working'])

const inboxRow = (session, { pattern, now, cacheTtl, isHidden }) => {
  const status = STATUS[session.state] ?? { label: session.state }
  const left = session.state !== 'working' && session.lastWriteAt ? cacheLeft(session.lastWriteAt, cacheTtl, now) : 0
  const folder = session.folder ?? session.ticket ?? null
  const ageStr = age(now - session.updatedAt)
  return {
    id: session.id,
    sessionId: session.sessionId,
    name: withoutTicketSuffix(session.name, pattern) || session.name,
    folder,
    ticket: folder,
    state: session.state,
    stateLabel: status.label,
    age: ageStr,
    activity: ageStr,
    cache: left > 0 ? clock(left) : null,
    cachePct: left > 0 && cacheTtl > 0 ? Math.min(100, Math.round((left / cacheTtl) * 100)) : 0,
    keepWarm: Boolean(session.keepWarm),
    contextTokens: session.contextTokens,
    model: session.model,
    isHidden,
  }
}

// What the Inbox webview draws: sessions that need the person first, then one card per folder/ticket.
const inboxModel = ({ groups, hidden, prs, issues, titles, pattern, cacheTtl, now, githubScope }) => {
  const options = { pattern, now, cacheTtl }
  const card = (group, isHidden) => {
    const key = group.ticket
    const ticketKey = folderTicket(key, pattern)
    const isTicket = Boolean(ticketKey)
    const issue = issues[key] ?? (ticketKey ? issues[ticketKey] : undefined)
    const sessions = group.sessions.map(session => inboxRow(session, { ...options, isHidden }))
    const cardPrs = isHidden ? [] : (prs[key] ?? (ticketKey ? prs[ticketKey] : undefined) ?? [])
    return {
      key,
      ticketKey: ticketKey ?? null,
      isTicket,
      title: isTicket ? (titles[key] ?? (ticketKey ? titles[ticketKey] : undefined) ?? issue?.summary ?? '') : '',
      category: issue?.category ?? null,
      status: issue?.status ?? null,
      sessions,
      prs: cardPrs,
      isBusy: sessions.some(row => IS_BUSY.has(row.state)),
    }
  }
  const active = groups.filter(group => group.ticket !== null).map(group => card(group, false))
  const loose = (groups.find(group => group.ticket === null)?.sessions ?? []).map(session => inboxRow(session, { ...options, isHidden: false }))
  const needs = [...active.flatMap(folder => folder.sessions), ...loose]
    .filter(row => NEEDS_YOU.has(row.state))
    .sort((a, b) => STATUS[a.state].rank - STATUS[b.state].rank)
  return {
    needs,
    tickets: active,
    folders: active,
    loose,
    history: hidden.map(group => card(group, true)),
    githubScope: githubScope ?? 'auto',
  }
}

module.exports = {
  STATUS,
  normalizeTicket,
  normalizeFolder,
  isTicketKey,
  folderTicket,
  ticketPattern,
  firstTicket,
  withoutTicketSuffix,
  assignTicket,
  encodeProjectPath,
  customTitleLine,
  sortByOrder,
  moveBefore,
  groupSessions,
  parseGithubRemote,
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
  inboxModel,
}
