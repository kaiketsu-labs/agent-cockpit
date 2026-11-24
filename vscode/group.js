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

const procState = stat => (typeof stat === 'string' && stat.includes(')') ? stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] : '')

const ancestorPids = (pid, readStat) => {
  const pids = []
  for (let current = pid; current > 1 && pids.length < 32; current = parentPid(readStat(current))) pids.push(current)
  return pids
}

const isPtyHostCmd = cmd => typeof cmd === 'string' && /\bptyHost(?:Main)?\b/i.test(cmd)

const isClaudeCmd = cmd => typeof cmd === 'string' && /(?:^|[\s/\\_-])claude(?:$|[\s/\\._-])/i.test(cmd)

const WINDOW_HEARTBEAT_TTL_MS = 60_000

const isSessionClaimedByOtherWindow = (ancestors, windowEntries, options = {}) => {
  const { selfPid, now = Date.now(), ttlMs = WINDOW_HEARTBEAT_TTL_MS, isAlive = () => true } = options
  if (!Array.isArray(ancestors) || ancestors.length === 0 || !Array.isArray(windowEntries)) return false
  const ancestorSet = new Set(ancestors.map(Number).filter(pid => Number.isInteger(pid) && pid > 1))
  if (ancestorSet.size === 0) return false
  for (const entry of windowEntries) {
    if (!entry || typeof entry !== 'object') continue
    const winPid = Number(entry.pid)
    if (!Number.isInteger(winPid) || winPid <= 1 || winPid === Number(selfPid)) continue
    if (typeof entry.updatedAt === 'number' && now - entry.updatedAt > ttlMs) continue
    if (!isAlive(winPid)) continue
    if (Array.isArray(entry.terminalPids) && entry.terminalPids.some(pid => ancestorSet.has(Number(pid)))) {
      return true
    }
  }
  return false
}

const shouldAutoResumeDetached = (session, { isPtyHost = false, claimedByOtherWindow = false } = {}) =>
  Boolean(
    isPtyHost &&
    !claimedByOtherWindow &&
    session?.state !== 'working' &&
    (session?.sessionId || session?.id),
  )

const detachedSessionNotice = (session, { isPtyHost = false, claimedByOtherWindow = false, label } = {}) => {
  const displayName = label || session?.name || 'Session'
  const pidSuffix = session?.pid ? ` (pid ${session.pid})` : ''
  const isWorking = session?.state === 'working'
  const action = session?.sessionId || session?.id ? 'Stop & Resume in Terminal' : undefined
  const severity = isWorking ? 'warning' : 'info'
  const confirmModal = isWorking
    ? `Stop working session "${displayName}"${pidSuffix} and resume it in a new terminal? The in-progress turn will be interrupted.`
    : null
  const confirmAction = isWorking ? 'Stop & Resume' : null
  const message = claimedByOtherWindow
    ? (isWorking
        ? `"${displayName}" is currently working in another VS Code window${pidSuffix}. Stopping it will interrupt the active turn.`
        : `"${displayName}" is open in another VS Code window${pidSuffix}.`)
    : isPtyHost
      ? (isWorking
          ? `"${displayName}" is currently working in a detached VS Code terminal${pidSuffix}. Stopping it will interrupt the active turn.`
          : `"${displayName}" is detached from this window's terminals${pidSuffix} (e.g. after a reconnect or in another window).`)
      : (isWorking
          ? `"${displayName}" is currently working outside this VS Code window's terminals${pidSuffix}.`
          : `"${displayName}" runs outside this VS Code window's terminals${pidSuffix}.`)
  return { severity, message, action, confirmModal, confirmAction }
}

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Gracefully stops a detached Claude Code process (SIGTERM -> SIGHUP -> SIGKILL) with PID-reuse guards.
const stopProcess = async (pid, options = {}) => {
  const {
    timeoutMs = 3_000,
    hupTimeoutMs = 1_000,
    killTimeoutMs = 1_000,
    pollMs = 100,
    kill = process.kill,
    isAlive,
    readCommand = () => undefined,
    sleep = defaultSleep,
    platform = process.platform,
  } = options
  const numericPid = Number(pid)
  if (!Number.isInteger(numericPid) || numericPid <= 1) {
    return { stopped: true, alreadyExited: true }
  }
  const checkAlive = () => {
    if (typeof isAlive === 'function') return Boolean(isAlive(numericPid))
    try {
      kill(numericPid, 0)
      return true
    } catch (err) {
      return err?.code === 'EPERM'
    }
  }
  if (!checkAlive()) {
    return { stopped: true, alreadyExited: true }
  }
  const initialCmd = readCommand(numericPid)
  if (initialCmd && !isClaudeCmd(initialCmd)) {
    return { stopped: false, reason: `Process ${numericPid} is no longer a Claude session.` }
  }
  const sendSignal = sig => {
    try {
      kill(numericPid, sig)
      return { ok: true }
    } catch (err) {
      if (err?.code === 'ESRCH') return { ok: true, exited: true }
      return { ok: false, reason: err?.message || `Failed to send ${sig} to process ${numericPid}.` }
    }
  }
  const waitForExit = async waitMs => {
    const maxWait = Math.max(0, waitMs)
    const step = Math.max(1, pollMs)
    const start = Date.now()
    let elapsed = 0
    while (checkAlive()) {
      const used = Math.max(elapsed, Date.now() - start)
      const remaining = maxWait - used
      if (remaining <= 0) return false
      const nextSleep = Math.min(step, remaining)
      await sleep(nextSleep)
      elapsed += nextSleep
    }
    return true
  }

  const termRes = sendSignal('SIGTERM')
  if (!termRes.ok) return { stopped: false, reason: termRes.reason }
  if (termRes.exited || !checkAlive() || (await waitForExit(timeoutMs))) {
    return { stopped: true, alreadyExited: false }
  }

  if (platform !== 'win32') {
    const cmdBeforeHup = readCommand(numericPid)
    if (cmdBeforeHup && !isClaudeCmd(cmdBeforeHup)) {
      return { stopped: true, alreadyExited: false }
    }
    const hupRes = sendSignal('SIGHUP')
    if (!hupRes.ok) return { stopped: false, reason: hupRes.reason }
    if (hupRes.exited || !checkAlive() || (await waitForExit(hupTimeoutMs))) {
      return { stopped: true, alreadyExited: false }
    }
  }

  const cmdBeforeKill = readCommand(numericPid)
  if (cmdBeforeKill && !isClaudeCmd(cmdBeforeKill)) {
    return { stopped: true, alreadyExited: false }
  }
  const killRes = sendSignal('SIGKILL')
  if (!killRes.ok) return { stopped: false, reason: killRes.reason }
  if (killRes.exited || !checkAlive() || (await waitForExit(killTimeoutMs))) {
    return { stopped: true, alreadyExited: false }
  }

  return { stopped: false, reason: `Process ${numericPid} did not exit.` }
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
      restricted: true,
    }
  }
  if (projects.length > 0) {
    const key = `(?:${projects.join('|')})-\\d+`
    return {
      key: new RegExp(`\\b${key}\\b`, 'i'),
      exact: new RegExp(`^${key}$`, 'i'),
      suffix: new RegExp(`\\s*\\((${key})\\)\\s*$`, 'i'),
      restricted: true,
    }
  }
  const key = '(?:\\b[A-Z][A-Z0-9]+-\\d+\\b|\\b[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+#\\d+\\b|(?<![A-Za-z0-9_.-])#\\d+\\b)'
  const suffixKey = '(?:[A-Z][A-Z0-9]+-\\d+|(?:[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+)?#\\d+)'
  return {
    key: new RegExp(key),
    exact: new RegExp(`^${suffixKey}$`),
    suffix: new RegExp(`\\s*\\((${suffixKey})\\)\\s*$`),
    restricted: false,
  }
}

const GITHUB_ISSUE_URL = /https?:\/\/[^/\s]+\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/issues\/(\d+)\b/i

const firstTicket = (texts, pattern) => {
  for (const text of texts) {
    const match = text?.match(pattern.key)
    if (match) return normalizeTicket(match[0])
    if (!pattern.restricted) {
      const ghUrl = text?.match(GITHUB_ISSUE_URL)
      if (ghUrl) return `${ghUrl[1]}#${ghUrl[2]}`
    }
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

const cleanTranscriptPrompt = raw => {
  if (!raw) return ''
  const cmd = raw.match(/<command-name>\s*([^<]+?)\s*<\/command-name>/)?.[1]
  const args = raw.match(/<command-args>\s*([\s\S]*?)\s*<\/command-args>/)?.[1]
  if (cmd) return `${cmd}${args ? ` ${args}` : ''}`.trim()
  return raw
    .replace(/<(system-reminder|local-command-stdout|local-command-caveat|task-notification)>[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const clipText = (text, maxLen) => {
  if (!text || text.length <= maxLen) return text
  const cut = text.slice(0, maxLen)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > maxLen * 0.75 ? cut.slice(0, lastSpace) : cut) + '…'
}

const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const relativeSessionPath = (filePath, cwd) => {
  if (!cwd) return filePath
  const normCwd = cwd.replace(/[/\\]+$/, '')
  if (normCwd && (filePath.startsWith(`${normCwd}/`) || filePath.startsWith(`${normCwd}\\`))) {
    return filePath.slice(normCwd.length).replace(/^[/\\]+/, '')
  }
  return filePath
}

const fitContextLines = (lines, budget, fromEnd = false) => {
  if (lines.length === 0 || budget <= 0) return []
  if (lines.join('\n').length <= budget) return lines
  const maxLines = Math.max(1, Math.floor((budget + 1) / 25))
  const subset = lines.length > maxLines ? (fromEnd ? lines.slice(-maxLines) : lines.slice(0, maxLines)) : lines
  const textBudget = Math.max(0, budget - (subset.length - 1))
  const totalLen = subset.reduce((sum, l) => sum + l.length, 0) || 1
  return subset.map(line => {
    const share = Math.max(1, Math.floor((line.length / totalLen) * textBudget))
    return line.length <= share ? line : clipText(line, Math.max(1, share - 1))
  })
}

const extractTranscriptContext = (jsonl, cwd, maxChars = 12_000) => {
  if (!jsonl || maxChars <= 0) return ''
  const entries = []
  const modifiedFiles = new Set()

  for (const line of jsonl.split('\n')) {
    if (!line) continue
    if (!line.includes('"user"') && !line.includes('"assistant"')) continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (!row || row.isSidechain || row.isMeta) continue
    if (row.type === 'user') {
      const content = row.message?.content
      if (Array.isArray(content) && content.some(b => b?.type === 'tool_result')) continue
      const raw =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .filter(b => b?.type === 'text')
                .map(b => b.text)
                .join(' ')
            : ''
      const cleaned = cleanTranscriptPrompt(raw)
      if (cleaned && !/^\/retitle\b/i.test(cleaned)) {
        entries.push({ role: 'User', text: clipText(cleaned, 500) })
      }
    } else if (row.type === 'assistant' && Array.isArray(row.message?.content)) {
      const texts = []
      for (const block of row.message.content) {
        if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          texts.push(block.text.replace(/\s+/g, ' ').trim())
        } else if (block?.type === 'tool_use' && FILE_EDIT_TOOLS.has(block.name)) {
          const p = block.input?.file_path || block.input?.path || block.input?.notebook_path
          if (typeof p === 'string' && p) {
            modifiedFiles.add(relativeSessionPath(p, cwd))
          }
        }
      }
      if (texts.length > 0) {
        entries.push({ role: 'Assistant', text: clipText(texts.join(' '), 300) })
      }
    }
  }

  const header = modifiedFiles.size > 0 ? `Modified files: ${[...modifiedFiles].slice(-25).join(', ')}` : ''
  if (entries.length === 0) return clipText(header, maxChars)

  const lines = entries.map(entry => `${entry.role}: ${entry.text}`)
  const full = [header, ...lines].filter(Boolean).join('\n')
  if (full.length <= maxChars) return full

  const headCount = Math.min(2, lines.length)
  const tailCount = Math.min(3, Math.max(0, lines.length - headCount))
  const head = lines.slice(0, headCount)
  const tail = tailCount > 0 ? lines.slice(lines.length - tailCount) : []
  const middle = lines.slice(headCount, lines.length - tailCount)

  const fixedLen =
    (header ? header.length + 1 : 0) +
    head.reduce((sum, l) => sum + l.length + 1, 0) +
    tail.reduce((sum, l) => sum + l.length + 1, 0)
  const budget = Math.max(0, maxChars - fixedLen - 48)
  const sampledMiddle = []
  if (middle.length > 0 && budget > 80) {
    const condensed = middle.map(l => clipText(l, 180))
    const avgLen = Math.max(40, condensed.reduce((s, l) => s + l.length + 1, 0) / condensed.length)
    const maxItems = Math.max(1, Math.min(condensed.length, Math.floor(budget / avgLen)))
    let used = 0
    for (let i = 0; i < maxItems; i++) {
      const idx = maxItems === 1 ? Math.floor(condensed.length / 2) : Math.round((i * (condensed.length - 1)) / (maxItems - 1))
      const item = condensed[idx]
      if (item && used + item.length + 1 <= budget) {
        sampledMiddle.push(item)
        used += item.length + 1
      }
    }
    const omitted = middle.length - sampledMiddle.length
    if (omitted > 0) {
      sampledMiddle.unshift(`[... ${omitted} intermediate turns condensed ...]`)
    }
  } else if (middle.length > 0) {
    sampledMiddle.push(`[... ${middle.length} intermediate turns omitted ...]`)
  }

  const result = [header, ...head, ...sampledMiddle, ...tail].filter(Boolean).join('\n')
  if (result.length <= maxChars) return result

  // When maxChars is too tight for header + head + tail (+ marker), fit header, head, and tail within budget so latest turns are preserved.
  const headerBudget = header ? Math.min(header.length, Math.max(24, Math.floor(maxChars * 0.25))) : 0
  const activeHeader = header && header.length > headerBudget ? clipText(header, Math.max(1, headerBudget - 1)) : header
  const avail = Math.max(0, maxChars - (activeHeader ? activeHeader.length + 1 : 0))
  if (head.length > 0 && tail.length > 0) {
    const marker = middle.length > 0 && avail > 120 ? `[... ${middle.length} intermediate turns omitted ...]` : ''
    const turnsAvail = Math.max(0, avail - (marker ? marker.length + 1 : 0))
    const tailBudget = Math.ceil(turnsAvail * 0.6)
    const headBudget = Math.max(0, turnsAvail - tailBudget - 1)
    const fittedHead = fitContextLines(head, headBudget, false)
    const fittedTail = fitContextLines(tail, tailBudget, true)
    return [activeHeader, ...fittedHead, ...(marker ? [marker] : []), ...fittedTail]
      .filter(Boolean)
      .join('\n')
      .slice(0, maxChars)
  }
  const fitted = head.length > 0 ? fitContextLines(head, avail, false) : fitContextLines(tail, avail, true)
  return [activeHeader, ...fitted].filter(Boolean).join('\n').slice(0, maxChars)
}

const buildClassificationInstruction = (knownFolders, options = {}) => {
  const { presetFolder, currentName, hint, isRetitle } = options
  const folderRule = presetFolder
    ? `The session is already in folder "${presetFolder}". Keep "folder": "${presetFolder}" unless the session clearly switched to a different ticket.`
    : knownFolders.length > 0
      ? `Existing folders: ${JSON.stringify(knownFolders)}. Strongly prefer picking one of these existing folders if the session relates to it; otherwise create a concise 2-4 word topic/project folder name (e.g. "Auth Refactor", "Repo Review") or use a ticket key if mentioned (e.g. "PROJ-123", "#42").`
      : `Choose a concise 2-4 word topic/project folder name (e.g. "Auth Refactor", "Repo Review") or a ticket key if mentioned (e.g. "PROJ-123", "#42").`
  const retitleContext = [
    isRetitle ? 'Re-evaluate the session title across the ENTIRE conversation history from start to finish, including how the goal evolved.' : '',
    currentName ? `Current session name: "${currentName}".` : '',
    hint ? `User hint: "${hint}".` : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    `You classify coding sessions for the Agent Cockpit sidebar. Determine the overarching goal or main objective of the entire session from start to finish. ` +
    `Focus on the high-level purpose across all turns (e.g. feature being built, bug being fixed, or component being refactored). ` +
    `Do NOT name after temporary micro-steps, follow-ups, or routine actions (e.g. avoid naming after running tests, fixing a typo, inspecting files, or git commands). ` +
    (retitleContext ? `${retitleContext} ` : '') +
    `Respond with ONLY a valid JSON object (no markdown fences, no prose): ` +
    `{"summary": "<concise 3-6 word summary of the overall session goal in the user's language, without repeating folder/ticket>", "folder": "<folder name or ticket key>"}. ` +
    folderRule
  )
}

const parseClassificationReply = text => {
  const jsonMatch = String(text ?? '').match(/\{[\s\S]*\}/)
  if (!jsonMatch) return undefined
  try {
    const parsed = JSON.parse(jsonMatch[0])
    if (parsed.skip || !parsed.summary?.trim()) return undefined
    return {
      summary: parsed.summary.trim(),
      folder: parsed.folder?.trim() || undefined,
      title: parsed.title?.trim() || undefined,
    }
  } catch {
    return undefined
  }
}

const folderTitle = (folder, { issues = {}, pattern = ticketPattern() } = {}) => {
  if (!folder || typeof folder !== 'string') return ''
  const trimmed = folder.trim()
  if (!trimmed) return ''
  const ticketKey = folderTicket(trimmed, pattern)
  if (!ticketKey) return ''
  const issue = issues[trimmed] ?? issues[ticketKey]
  return issue?.summary ?? ''
}

const prefillForFolder = (folder, { issues = {}, pattern = ticketPattern() } = {}) => {
  if (!folder || typeof folder !== 'string') return ''
  const trimmed = folder.replace(/[\r\n]+/g, ' ').trim()
  if (!trimmed) return ''
  const rawTitle = folderTitle(trimmed, { issues, pattern })
  const title = typeof rawTitle === 'string' ? rawTitle.replace(/[\r\n]+/g, ' ').trim() : ''
  const hasDistinctTitle = title && title.toLowerCase() !== trimmed.toLowerCase()
  return hasDistinctTitle ? `${trimmed} (${title}): ` : `${trimmed}: `
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

// Places `moved` before or after `target` within `siblings`, preserving all unrelated keys in `order`.
const reorderSiblings = (order, siblings, moved, target, before) => {
  if (!moved || !target || moved === target) return order
  if (!siblings.includes(moved)) return order
  const targetIdx = siblings.indexOf(target)
  if (targetIdx === -1) return order
  const insertBefore = before ? target : siblings[targetIdx + 1]
  return moveBefore(order, siblings, moved, insertBefore)
}

const groupSessions = (sessions, order = [], options = {}) => {
  const opts = Array.isArray(order) ? options : order
  const orderList = Array.isArray(order) ? order : []
  const { unticketedSort, folders = [], sortByAge } = opts
  const byFolder = new Map()
  for (const folder of folders) {
    if (folder) byFolder.set(folder, [])
  }
  for (const session of sessions) {
    const key = session.folder ?? session.ticket ?? null
    byFolder.set(key, [...(byFolder.get(key) ?? []), session])
  }
  const groupAge = members => Math.max(0, ...members.map(s => s.archivedAt ?? s.updatedAt ?? 0))
  const groups = [...byFolder].map(([ticket, members]) => {
    const counts = Object.entries(STATUS)
      .map(([state, { label }]) => ({ label, count: members.filter(s => s.state === state).length }))
      .filter(({ count }) => count > 0)
    const sorted =
      sortByAge
        ? [...members].sort((a, b) => (b.archivedAt ?? b.updatedAt ?? 0) - (a.archivedAt ?? a.updatedAt ?? 0) || byName(a.name, b.name))
        : ticket === null && unticketedSort === 'age'
          ? [...members].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || byName(a.name, b.name))
          : sortByOrder(members, s => s.id, s => s.name, orderList)
    return {
      ticket,
      folder: ticket,
      sessions: sorted,
      counts,
      isActive: members.some(s => s.state !== 'done'),
      age: groupAge(members),
    }
  })
  const grouped = groups.filter(group => group.ticket !== null)
  if (sortByAge) {
    return [...groups].sort((a, b) => b.age - a.age || byName(a.ticket ?? '', b.ticket ?? ''))
  }
  return [...sortByOrder(grouped, g => g.ticket, g => g.ticket, orderList), ...groups.filter(group => group.ticket === null)]
}

const parseGithubRemote = stdout => {
  if (!stdout) return undefined
  for (const line of stdout.split('\n')) {
    const match = line.match(
      /(?:(?:https?|ssh):\/\/(?:[^@/\s]+@)?|(?:[^@/\s]+@)?)([^/:\s]*(?:github|ghe)[^/:\s]*?)(?::\d+)?[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\s|\(|$)/i,
    )
    if (match) {
      const host = match[1].includes('.') ? match[1].toLowerCase() : undefined
      return { repo: `${match[2]}/${match[3]}`, host }
    }
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
      } else if (!cleanOrg && reposByTicket[key]) {
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
  if (typeof flag === 'boolean') return flag
  if (typeof flag === 'number') return flag > 0
  return isTicketClosed || now - session.updatedAt > HIDE_AFTER_MS
}

const isHiddenInView = (view, ids) => {
  const hidden = view?.hidden
  if (!hidden || typeof hidden !== 'object') return false
  return ids.some(id => {
    if (!id) return false
    const flag = hidden[id]
    return flag === true || (typeof flag === 'number' && flag > 0)
  })
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
  const live = agents
    .filter(agent => agent.name !== 'Briefing' && !fileOf.get(agent.sessionId)?.isBriefing)
    .map(agent => {
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
        prompt: file.prompt,
        state: isBg ? agent.state : interactiveState(agent.status),
        updatedAt: file.lastTurnEndAt ?? agent.startedAt ?? 0,
        lastWriteAt: file.lastTurnEndAt,
        cwd: agent.cwd ?? file.cwd,
        initialCwd: file.cwd,
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
    .filter(file => file.name !== 'Briefing' && !file.isBriefing && file.kind === 'interactive' && !liveIds.has(file.sessionId) && (file.name || file.prompt))
    .map(file => {
      const keepWarm = Boolean(file.keepWarm && (!file.keepWarmUntil || file.keepWarmUntil > Date.now()))
      return withFolder(
        {
          id: file.sessionId,
          sessionId: file.sessionId,
          name: file.name || file.prompt,
          prompt: file.prompt,
          state: 'done',
          updatedAt: file.lastTurnEndAt ?? file.startedAt,
          lastWriteAt: file.lastTurnEndAt,
          cwd: file.cwd,
          initialCwd: file.cwd,
          ended: true,
          keepWarm,
          contextTokens: file.contextTokens,
          model: file.model,
        },
        file.folder ?? file.ticket,
      )
    })
  return [...live, ...ended]
}

// Mirrors Claude Code's choice of prompt cache TTL for the main thread: 5 minutes unless set to an hour.
const cacheTtlMs = env => {
  const ttl = env.CLAUDE_CODE_PROMPT_CACHE_TTL ?? (env.ENABLE_PROMPT_CACHING_1H || env.ENABLE_PROMPT_CACHING_1H_BEDROCK ? '1h' : '5m')
  return ttl === '1h' ? 60 * 60_000 : 5 * 60_000
}

const DEFAULT_TRACKER_REFRESH_SECONDS = 300
const MIN_TRACKER_REFRESH_SECONDS = 15

// Converts configured tracker polling interval (in seconds) to milliseconds.
// Returns Infinity when set to 0 (manual refresh only); clamps small positive values to 15s; falls back to 300s (5m) on invalid input.
const trackerRefreshMs = seconds => {
  if (seconds === undefined || seconds === null || typeof seconds === 'boolean') return DEFAULT_TRACKER_REFRESH_SECONDS * 1000
  if (typeof seconds === 'string' && seconds.trim() === '') return DEFAULT_TRACKER_REFRESH_SECONDS * 1000
  const n = Number(seconds)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_TRACKER_REFRESH_SECONDS * 1000
  if (n === 0) return Infinity
  return Math.max(MIN_TRACKER_REFRESH_SECONDS, n) * 1000
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

const shortCwd = cwd => {
  if (!cwd || typeof cwd !== 'string') return undefined
  const norm = cwd.replace(/[/\\]+$/, '')
  if (!norm) return undefined
  const worktreeMatch = norm.match(/[/\\]\.claude[/\\]worktrees[/\\]([^/\\]+)/)
  if (worktreeMatch) return worktreeMatch[1]
  const last = norm.split(/[/\\]/).pop()
  return last || undefined
}

const NEEDS_YOU = new Set(['blocked', 'failed'])
const IS_BUSY = new Set(['blocked', 'failed', 'working'])

const inboxRow = (session, { pattern, now, cacheTtl, isHidden, activeSessionId }) => {
  const status = STATUS[session.state] ?? { label: session.state }
  const left = session.state !== 'working' && session.lastWriteAt ? cacheLeft(session.lastWriteAt, cacheTtl, now) : 0
  const folder = session.folder ?? session.ticket ?? null
  const ageStr = age(now - session.updatedAt)
  const isActiveTerminal = Boolean(
    activeSessionId && (session.id === activeSessionId || session.sessionId === activeSessionId)
  )
  const cwdShort = shortCwd(session.cwd)
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
    cacheExpiresAt: left > 0 ? session.lastWriteAt + cacheTtl : 0,
    keepWarm: Boolean(!isHidden && session.keepWarm),
    contextTokens: session.contextTokens,
    model: session.model,
    cwd: session.cwd,
    cwdShort,
    isHidden,
    isActiveTerminal,
  }
}

// What the Inbox webview draws: sessions that need the person first, then one card per folder/ticket.
const inboxModel = ({ groups, hidden, prs, issues, pattern, cacheTtl, now, githubScope, activeSessionId }) => {
  const options = { pattern, now, cacheTtl, activeSessionId }
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
      title: folderTitle(key, { issues, pattern }),
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
    activeSessionId: activeSessionId ?? null,
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
  cleanTranscriptPrompt,
  clipText,
  extractTranscriptContext,
  buildClassificationInstruction,
  parseClassificationReply,
  sortByOrder,
  moveBefore,
  reorderSiblings,
  groupSessions,
  parseGithubRemote,
  searchQueries,
  prsByTicket,
  isClosed,
  isHidden,
  isHiddenInView,
  ticketOf,
  mergeSessions,
  interactiveState,
  parentPid,
  procState,
  ancestorPids,
  isPtyHostCmd,
  isClaudeCmd,
  isSessionClaimedByOtherWindow,
  shouldAutoResumeDetached,
  detachedSessionNotice,
  stopProcess,
  cacheTtlMs,
  trackerRefreshMs,
  cacheLeft,
  clock,
  age,
  shortCwd,
  inboxRow,
  inboxModel,
  folderTitle,
  prefillForFolder,
  escapeRegExp,
}
