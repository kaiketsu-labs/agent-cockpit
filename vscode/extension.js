'use strict'

const vscode = require('vscode')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile, execFileSync } = require('child_process')
const {
  STATUS,
  ticketPattern,
  normalizeFolder,
  folderTicket,
  withoutTicketSuffix,
  encodeProjectPath,
  customTitleLine,
  groupSessions,
  moveBefore,
  parseGithubRemote,
  searchQueries,
  prsByTicket,
  isClosed,
  isHidden,
  ticketOf,
  mergeSessions,
  cacheTtlMs,
  age,
  inboxModel,
} = require('./group')
const { InboxView } = require('./inbox')

const CLAUDE_DIR = path.join(os.homedir(), '.claude')
// The agent-cockpit plugin writes one file per session; order, folders and hide flags sit beside them for every window.
const COCKPIT_DIR = path.join(CLAUDE_DIR, 'cockpit')
const DECK_DIR = path.join(CLAUDE_DIR, 'deck')
const SESSIONS_DIR = path.join(COCKPIT_DIR, 'sessions')
const VIEW_FILE = path.join(COCKPIT_DIR, 'view.json')
const TITLES_FILE = path.join(COCKPIT_DIR, 'ticket-titles.json')
const REFRESH_MS = 5_000
const TRACKER_MS = 60_000
// GitHub allows 30 searches a minute; each refresh spends one per six tickets.
const PRS_MS = 120_000

// The extension host's PATH often lacks ~/.local/bin or Homebrew paths on macOS/Linux.
const localBin = name => {
  const dirs = [
    path.join(os.homedir(), '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]
  for (const dir of dirs) {
    const file = path.join(dir, name)
    if (fs.existsSync(file)) return file
  }
  return name
}
const CLAUDE = localBin('claude')
const GH = localBin('gh')
const ACLI = localBin('acli')
const JIRA_CLI = localBin('jira')
const GIT = localBin('git')

const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

const run = (file, args, input, options = {}) =>
  new Promise((resolve, reject) => {
    const child = execFile(file, args, { maxBuffer: 16 * 1024 * 1024, ...options }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    )
    // A process that exits before reading its stdin would otherwise throw EPIPE.
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })

const repoCache = new Map()

const detectGithubRepo = async cwd => {
  if (!cwd || typeof cwd !== 'string') return undefined
  if (repoCache.has(cwd)) return repoCache.get(cwd)
  try {
    const stdout = await run(GIT, ['remote', '-v'], undefined, { cwd })
    const repo = parseGithubRemote(stdout)
    repoCache.set(cwd, repo)
    return repo
  } catch {
    repoCache.set(cwd, undefined)
    return undefined
  }
}

// The env Claude Code sessions see: user settings, then each workspace's project and local settings.
const loadEnv = async () => {
  const roots = (vscode.workspace.workspaceFolders ?? []).map(folder => path.join(folder.uri.fsPath, '.claude'))
  const files = [path.join(CLAUDE_DIR, 'settings.json')].concat(
    ...roots.map(root => [path.join(root, 'settings.json'), path.join(root, 'settings.local.json')]),
  )
  const envs = await Promise.all(files.map(async file => (await readJson(file, {})).env ?? {}))
  return Object.assign({}, process.env, ...envs)
}

const getCockpitConfig = env => {
  const cfg = vscode.workspace.getConfiguration('agentCockpit')
  const legacyCfg = vscode.workspace.getConfiguration('claudeDeck')
  const get = (key, fallback) => {
    const val = cfg.get(key)
    if (val !== undefined && val !== null && val !== '') return val
    const legacyVal = legacyCfg.get(key)
    if (legacyVal !== undefined && legacyVal !== null && legacyVal !== '') return legacyVal
    return fallback
  }
  return {
    tracker: get('tracker', 'auto'),
    trackerCommand: get('trackerCommand', '') || env.COCKPIT_TRACKER_COMMAND || env.DECK_TRACKER_COMMAND || '',
    pullRequests: get('pullRequests', 'auto'),
    ticketProjects: get('ticketProjects', '') || env.TICKET_PROJECTS || '',
    ticketPattern: get('ticketPattern', ''),
    githubOrg: get('githubOrg', '') || env.GITHUB_ORG || '',
    githubRepositories: get('githubRepositories', ''),
    closeTerminalOnArchive: get('closeTerminalOnArchive', true),
  }
}

const listAgents = async () => JSON.parse(await run(CLAUDE, ['agents', '--json', '--all']))

const readSessionFiles = async () => {
  const readDir = async dir => {
    const names = await fs.promises.readdir(dir).catch(() => [])
    return Promise.all(names.filter(name => name.endsWith('.json')).map(name => readJson(path.join(dir, name))))
  }
  const [cockpitFiles, legacyFiles] = await Promise.all([
    readDir(SESSIONS_DIR),
    readDir(path.join(DECK_DIR, 'sessions')),
  ])
  const map = new Map()
  for (const f of legacyFiles) {
    if (f?.sessionId) map.set(f.sessionId, f)
  }
  for (const f of cockpitFiles) {
    if (f?.sessionId) map.set(f.sessionId, f)
  }
  return [...map.values()]
}

const loadSessions = async pattern => {
  const [agents, files] = await Promise.all([listAgents(), readSessionFiles()])
  return mergeSessions(agents, files, pattern)
}

// Writes session metadata directly to ~/.claude/cockpit/sessions/<sessionId>.json and optionally updates the JSONL custom-title.
const updateSessionRecord = async (session, change) => {
  await fs.promises.mkdir(SESSIONS_DIR, { recursive: true })
  const file = path.join(SESSIONS_DIR, `${session.sessionId}.json`)
  const record = await readJson(file, {
    sessionId: session.sessionId,
    kind: session.interactive === false ? 'bg' : 'interactive',
    cwd: session.cwd,
    startedAt: session.updatedAt || Date.now(),
  })
  const updated = { ...record, ...change }
  await fs.promises.writeFile(file, JSON.stringify(updated, null, 2))
  if (change.name && updated.cwd) {
    const transcript = path.join(CLAUDE_DIR, 'projects', encodeProjectPath(updated.cwd), `${session.sessionId}.jsonl`)
    if (fs.existsSync(transcript)) {
      await fs.promises.appendFile(transcript, customTitleLine(session.sessionId, change.name)).catch(() => {})
    }
  }
}

const rename = async (session, rawName, pattern) => {
  const extracted = ticketOf(rawName, pattern) ?? folderTicket(rawName, pattern)
  const strippedPrefix = extracted ? rawName.replace(new RegExp(`^${extracted}\\s*[:·\\-–—]?\\s*`, 'i'), '').trim() : rawName
  const name = withoutTicketSuffix(strippedPrefix || rawName, pattern) || strippedPrefix || rawName
  const change = { name }
  if (extracted) {
    change.folder = extracted
    change.ticket = extracted
  }
  await updateSessionRecord(session, change)
}

const mapJiraCategory = status => {
  const cat = status?.statusCategory?.key?.toLowerCase()
  if (cat === 'done' || cat === 'new' || cat === 'indeterminate') return cat
  const name = String(status?.name ?? status ?? '').toLowerCase()
  if (/done|closed|resolved|complete/.test(name)) return 'done'
  if (/to do|open|new|backlog/.test(name)) return 'new'
  return 'indeterminate'
}

const parseJiraIssuePayload = (issue, baseUrl) => {
  const key = issue?.key
  const fields = issue?.fields ?? issue
  const statusObj = fields?.status
  const status = typeof statusObj === 'string' ? statusObj : (statusObj?.name ?? 'Open')
  const summary = fields?.summary ?? ''
  const selfUrl = issue?.self ? String(issue.self).split('/rest/')[0] : baseUrl
  return key
    ? {
        key,
        value: {
          status,
          category: mapJiraCategory(statusObj),
          summary,
          url: selfUrl ? `${selfUrl.replace(/\/$/, '')}/browse/${key}` : undefined,
        },
      }
    : undefined
}

const loadJiraViaAcli = async (keys, baseUrl, cwd) => {
  const issues = {}
  await Promise.all(
    keys.map(async key => {
      try {
        const out = await run(ACLI, ['jira', 'workitem', 'view', key, '--json'], undefined, { cwd })
        const parsed = parseJiraIssuePayload(JSON.parse(out), baseUrl)
        if (parsed) issues[parsed.key] = parsed.value
      } catch {}
    }),
  )
  return issues
}

const loadJiraViaJiraCli = async (keys, baseUrl, cwd) => {
  try {
    const jql = `key in (${keys.join(',')})`
    const out = await run(JIRA_CLI, ['issue', 'list', '--jql', jql, '--raw'], undefined, { cwd })
    const data = JSON.parse(out)
    const list = Array.isArray(data) ? data : (data.issues ?? [])
    const issues = {}
    for (const item of list) {
      const parsed = parseJiraIssuePayload(item, baseUrl)
      if (parsed) issues[parsed.key] = parsed.value
    }
    if (Object.keys(issues).length > 0) return issues
  } catch {}
  const issues = {}
  await Promise.all(
    keys.map(async key => {
      try {
        const out = await run(JIRA_CLI, ['issue', 'view', key, '--raw'], undefined, { cwd })
        const parsed = parseJiraIssuePayload(JSON.parse(out), baseUrl)
        if (parsed) issues[parsed.key] = parsed.value
      } catch {}
    }),
  )
  return issues
}

const loadJiraViaRest = async (env, keys) => {
  const baseUrl = (env.JIRA_URL || '').replace(/\/$/, '')
  const token = env.JIRA_TOKEN || env.JIRA_API_TOKEN
  if (!baseUrl || !token || keys.length === 0) return {}
  const email = env.JIRA_EMAIL || env.JIRA_USER || env.JIRA_USERNAME
  const authHeader = email
    ? `Authorization: Basic ${Buffer.from(`${email}:${token}`).toString('base64')}\n`
    : `Authorization: Bearer ${token}\n`
  const jql = encodeURIComponent(`key in (${keys.join(',')})`)
  const endpoints = [
    `${baseUrl}/rest/api/3/search/jql?maxResults=${keys.length}&fields=status,summary&jql=${jql}`,
    `${baseUrl}/rest/api/2/search?validateQuery=warn&maxResults=${keys.length}&fields=status,summary&jql=${jql}`,
  ]
  let lastErr
  for (const url of endpoints) {
    try {
      // The token goes in on stdin, so it never shows in the process list.
      const body = await run('curl', ['-s', '--fail', '-H', '@-', url], authHeader)
      const issues = {}
      for (const issue of JSON.parse(body).issues ?? []) {
        const parsed = parseJiraIssuePayload(issue, baseUrl)
        if (parsed) issues[parsed.key] = parsed.value
      }
      return issues
    } catch (err) {
      lastErr = err
    }
  }
  if (lastErr) throw lastErr
  return {}
}

// Cascade for Jira issues: 1) REST when JIRA_URL + JIRA_TOKEN are set, 2) Atlassian CLI (acli), 3) jira-cli (jira).
const loadJiraIssues = async (env, keys, cwd) => {
  if (keys.length === 0) return {}
  const baseUrl = env.JIRA_URL
  if (baseUrl && (env.JIRA_TOKEN || env.JIRA_API_TOKEN)) {
    try {
      const rest = await loadJiraViaRest(env, keys)
      if (Object.keys(rest).length > 0) return rest
    } catch {}
  }
  const viaAcli = await loadJiraViaAcli(keys, baseUrl, cwd)
  if (Object.keys(viaAcli).length > 0) return viaAcli
  const viaJiraCli = await loadJiraViaJiraCli(keys, baseUrl, cwd)
  if (Object.keys(viaJiraCli).length > 0) return viaJiraCli
  if (baseUrl && (env.JIRA_TOKEN || env.JIRA_API_TOKEN)) {
    return loadJiraViaRest(env, keys)
  }
  return {}
}

const loadGithubIssues = async (keys, cwd, options = {}) => {
  const { reposByTicket = {} } = options
  const issues = {}
  await Promise.all(
    keys.map(async key => {
      try {
        let repo
        let num
        if (key.includes('/') && key.includes('#')) {
          const parts = key.split('#')
          repo = parts[0]
          num = parts[1]
        } else if (key.startsWith('#')) {
          num = key.slice(1)
          // For bare GitHub issues: only query if we are sure about the repo
          repo = reposByTicket[key]
        } else {
          return
        }
        if (!repo) return
        const args = ['issue', 'view', num, '--json', 'title,state,url', '-R', repo]
        const data = JSON.parse(await run(GH, args, undefined, { cwd }))
        // GitHub API returns PRs as issues under /issues/:num; ignore if it is actually a PR
        if (data.url && data.url.includes('/pull/')) return
        const isDone = String(data.state).toUpperCase() === 'CLOSED'
        issues[key] = {
          status: isDone ? 'Closed' : 'Open',
          category: isDone ? 'done' : 'indeterminate',
          summary: data.title,
          url: data.url,
        }
      } catch {}
    }),
  )
  return issues
}

const loadIssues = async (env, keys, cfg, cwd, options = {}) => {
  if (keys.length === 0 || cfg.tracker === 'none') return {}
  if (cfg.tracker === 'command') {
    if (!cfg.trackerCommand) return {}
    const out = await run('/bin/sh', ['-c', cfg.trackerCommand], JSON.stringify(keys), { cwd, env })
    return JSON.parse(out)
  }
  const ghKeys = keys.filter(k => k.includes('#'))
  const jiraKeys = keys.filter(k => !k.includes('#'))
  const results = {}
  if ((cfg.tracker === 'auto' || cfg.tracker === 'jira') && jiraKeys.length > 0) {
    try {
      Object.assign(results, await loadJiraIssues(env, jiraKeys, cwd))
    } catch (err) {
      if (cfg.tracker === 'jira') throw err
    }
  }
  if ((cfg.tracker === 'auto' || cfg.tracker === 'github') && ghKeys.length > 0) {
    Object.assign(results, await loadGithubIssues(ghKeys, cwd, options))
  }
  return results
}

const loadPrs = async (keys, cfg, options = {}) => {
  if (keys.length === 0 || cfg.pullRequests === 'none') return {}
  try {
    const queries = searchQueries(keys, 6, options)
    if (queries.length === 0) return {}
    const pages = await Promise.all(
      queries.map(q => run(GH, ['api', '-X', 'GET', 'search/issues', '-f', `q=${q}`, '-f', 'per_page=100'])),
    )
    return prsByTicket(pages.flatMap(page => JSON.parse(page).items), keys, options)
  } catch (err) {
    if (cfg.pullRequests === 'github') throw err
    return {}
  }
}

class SessionsProvider {
  constructor() {
    this.changed = new vscode.EventEmitter()
    this.onDidChange = this.changed.event
    this.sessions = []
    this.groups = []
    this.hidden = []
    this.titles = {}
    this.issues = {}
    this.prs = {}
    this.fetchedAt = { sessions: 0, issues: 0, prs: 0 }
    this.env = {}
    this.config = getCockpitConfig({})
    this.pattern = ticketPattern()
    this.errors = {}
    this.view = {}
    this.cacheTtl = cacheTtlMs({})
    this.isLoaded = false
  }

  get order() {
    return this.view.order ?? []
  }

  get folders() {
    return this.view.folders ?? []
  }

  async setHidden(session, isHidden) {
    await this.saveView({ hidden: { ...this.view.hidden, [session.id]: isHidden } })
  }

  async addFolder(rawFolder) {
    const folder = normalizeFolder(rawFolder, this.pattern)
    if (!folder) return
    const folders = [...new Set([...this.folders, folder])]
    await this.saveView({ folders })
    return folder
  }

  async removeFolder(folder) {
    const folders = this.folders.filter(f => f !== folder)
    const order = this.order.filter(f => f !== folder)
    await this.saveView({ folders, order })
  }

  async renameFolder(oldFolder, rawNewFolder) {
    const newFolder = normalizeFolder(rawNewFolder, this.pattern)
    if (!newFolder || newFolder === oldFolder) return
    const folders = [...new Set(this.folders.map(f => (f === oldFolder ? newFolder : f)))]
    const order = this.order.map(item => (item === oldFolder ? newFolder : item))
    const matching = this.sessions.filter(s => (s.folder ?? s.ticket) === oldFolder)
    await Promise.all(matching.map(s => updateSessionRecord(s, { folder: newFolder, ticket: newFolder })))
    if (this.titles[oldFolder] && !this.titles[newFolder]) {
      const titles = { ...(await readJson(TITLES_FILE, {})), [newFolder]: this.titles[oldFolder] }
      delete titles[oldFolder]
      this.titles = titles
      await fs.promises.writeFile(TITLES_FILE, JSON.stringify(titles, null, 2)).catch(() => {})
    }
    await this.saveView({ folders, order })
  }

  async saveView(change) {
    this.view = { ...(await readJson(VIEW_FILE, {})), ...change }
    await fs.promises.mkdir(COCKPIT_DIR, { recursive: true })
    await fs.promises.writeFile(VIEW_FILE, JSON.stringify(this.view, null, 2))
    this.regroup()
    this.changed.fire()
  }

  isFolderClosed(folder) {
    if (!folder) return false
    const tKey = folderTicket(folder, this.pattern)
    return isClosed(this.issues[folder] ?? (tKey ? this.issues[tKey] : undefined))
  }

  isHidden(session) {
    const folder = session.folder ?? session.ticket
    const isTicketClosed = folder !== undefined && this.isFolderClosed(folder)
    return isHidden(session, Date.now(), isTicketClosed, this.view.hidden?.[session.id])
  }

  regroup() {
    const activeFolders = this.folders.filter(f => !this.isFolderClosed(f))
    this.groups = groupSessions(
      this.sessions.filter(session => !this.isHidden(session)),
      this.order,
      { folders: activeFolders },
    )
    this.hidden = groupSessions(
      this.sessions.filter(session => this.isHidden(session)),
      this.order,
      { unticketedSort: 'age' },
    )
  }

  // Resolves to the sessions that started needing input since the last refresh.
  async refresh({ force = false, withRemote = true } = {}) {
    this.env = await loadEnv()
    this.config = getCockpitConfig(this.env)
    this.view = await readJson(VIEW_FILE, {})
    this.cacheTtl = cacheTtlMs(this.env)
    const before = new Map(this.sessions.map(session => [session.id, session.state]))
    const projects = this.config.ticketProjects
      .split(',')
      .map(project => project.trim())
      .filter(Boolean)
    this.pattern = ticketPattern(projects, this.config.ticketPattern)
    await Promise.all([
      this.track('claude agents', async () => {
        this.sessions = await loadSessions(this.pattern)
        this.regroup()
      }, 'sessions'),
      readJson(TITLES_FILE, {}).then(titles => (this.titles = titles)),
    ])
    const ticketKeysOf = items => [...new Set(items.map(k => folderTicket(k, this.pattern)).filter(Boolean))]
    const activeTicketKeys = ticketKeysOf(this.groups.map(group => group.ticket))
    const allTicketKeys = ticketKeysOf([
      ...this.sessions.map(session => session.folder ?? session.ticket),
      ...this.folders,
    ])
    const isDue = (what, ms) => withRemote && (force || Date.now() - this.fetchedAt[what] > ms)
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir()

    const resolveRepoOptions = async () => {
      const workspaceCwds = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath)
      const workspaceRepos = (await Promise.all(workspaceCwds.map(detectGithubRepo))).filter(Boolean)
      const defaultRepo = workspaceRepos[0] ?? (await detectGithubRepo(cwd))
      const reposByTicket = {}
      for (const group of this.groups) {
        const tKey = folderTicket(group.ticket, this.pattern)
        if (!tKey) continue
        if (tKey.includes('/') && tKey.includes('#')) {
          reposByTicket[tKey] = tKey.split('#')[0]
        } else {
          const sessionCwds = (group.sessions ?? []).map(s => s.cwd).filter(Boolean)
          const sessionRepos = (await Promise.all(sessionCwds.map(detectGithubRepo))).filter(Boolean)
          if (tKey.startsWith('#')) {
            // For bare GitHub issues: only assign if we are sure (at least one session in this group has a detected repo)
            if (sessionRepos.length > 0) reposByTicket[tKey] = sessionRepos[0]
          } else {
            const groupRepo = sessionRepos[0] ?? defaultRepo
            if (groupRepo) reposByTicket[tKey] = groupRepo
          }
        }
      }
      for (const session of this.sessions) {
        const tKey = folderTicket(session.folder ?? session.ticket, this.pattern)
        if (!tKey || reposByTicket[tKey]) continue
        if (tKey.includes('/') && tKey.includes('#')) {
          reposByTicket[tKey] = tKey.split('#')[0]
        } else if (session.cwd) {
          const repo = await detectGithubRepo(session.cwd)
          if (repo) reposByTicket[tKey] = repo
        }
      }
      const configuredRepos = this.config?.githubRepositories
        ? this.config.githubRepositories.split(',').map(r => r.trim()).filter(Boolean)
        : []
      const githubOrg = this.config?.githubOrg?.trim() || undefined
      const allDetectedRepos = [...new Set([
        ...configuredRepos,
        ...workspaceRepos,
        ...Object.values(reposByTicket),
        defaultRepo,
      ].filter(Boolean))]
      return {
        reposByTicket,
        defaultRepos: configuredRepos.length > 0 ? configuredRepos : allDetectedRepos,
        githubOrg,
      }
    }

    // PRs only for live ticket folders: each six keys cost one of GitHub's 30 searches a minute.
    const repoOptions = isDue('issues', TRACKER_MS) || isDue('prs', PRS_MS) ? await resolveRepoOptions() : {}
    await Promise.all([
      isDue('issues', TRACKER_MS) &&
        this.track('tracker', async () => (this.issues = await loadIssues(this.env, allTicketKeys, this.config, cwd, repoOptions)), 'issues'),
      isDue('prs', PRS_MS) &&
        this.track('gh search', async () => {
          this.prs = await loadPrs(activeTicketKeys, this.config, repoOptions)
        }, 'prs'),
    ])
    this.regroup()
    this.changed.fire()
    const wasLoaded = this.isLoaded
    this.isLoaded = this.fetchedAt.sessions > 0
    if (!wasLoaded) return []
    return this.sessions.filter(session => session.state === 'blocked' && before.get(session.id) !== 'blocked')
  }

  async track(label, load, fetched) {
    try {
      await load()
      delete this.errors[label]
      if (fetched) this.fetchedAt[fetched] = Date.now()
    } catch (err) {
      this.errors[label] = `${label} failed: ${err.message.split('\n')[0]}`
    }
  }

  get message() {
    const errors = Object.values(this.errors)
    return errors.length > 0 ? errors.join(' · ') : undefined
  }

  inboxModel() {
    let githubScope = ''
    if (this.config?.pullRequests === 'none') {
      githubScope = 'PRs disabled'
    } else if (this.config?.githubOrg) {
      githubScope = `org:${this.config.githubOrg.trim()}`
    } else if (this.config?.githubRepositories) {
      const repos = this.config.githubRepositories.split(',').map(r => r.trim()).filter(Boolean)
      githubScope = repos.length === 1 ? repos[0] : `${repos.length} repos`
    } else {
      const defaultRepo = (vscode.workspace.workspaceFolders ?? []).map(f => repoCache.get(f.uri.fsPath)).find(Boolean)
      if (defaultRepo) githubScope = defaultRepo.split('/').pop()
    }
    return inboxModel({
      groups: this.groups,
      hidden: this.hidden,
      prs: this.prs,
      issues: this.issues,
      titles: this.titles,
      pattern: this.pattern,
      cacheTtl: this.cacheTtl,
      now: Date.now(),
      githubScope,
    })
  }

  // A session dropped on a folder/ticket is reassigned to it; dropped on "Ungrouped" it loses its folder.
  async assign(session, rawFolder) {
    const folder = normalizeFolder(rawFolder, this.pattern)
    const current = session.folder ?? session.ticket ?? undefined
    if (folder === current) return
    await updateSessionRecord(session, { folder: folder ?? null, ticket: folder ?? null })
  }

  async reorderSession(session, targetId, before, rawFolder) {
    const folder = normalizeFolder(rawFolder, this.pattern) ?? undefined
    const current = session.folder ?? session.ticket ?? undefined
    if (folder !== current) {
      await updateSessionRecord(session, { folder: folder ?? null, ticket: folder ?? null })
      session.folder = folder
      session.ticket = folder
    }
    const all = this.sessions.filter(s => !this.isHidden(s))
    const dest = all.filter(s => (s.folder ?? s.ticket ?? undefined) === folder)
    let siblingIds = dest.map(s => s.id)
    if (!siblingIds.includes(session.id)) {
      siblingIds.push(session.id)
    }
    const targetIdx = siblingIds.indexOf(targetId)
    const insertBeforeId = targetIdx === -1 ? undefined : (before ? targetId : siblingIds[targetIdx + 1])
    const newOrder = moveBefore(this.order, siblingIds, session.id, insertBeforeId)
    await this.saveView({ order: newOrder })
  }
}

// An exited interactive session can't be attached, only resumed.
const attachArgs = session => (session.ended ? ['--resume', session.id] : ['attach', session.id])

const isAttachTerminal = (terminal, session) => {
  const args = terminal.creationOptions?.shellArgs
  if (!Array.isArray(args)) return false
  const str = args.join(' ')
  return (
    str === `attach ${session.id}` ||
    str === `--resume ${session.id}` ||
    (session.sessionId && (str === `attach ${session.sessionId}` || str === `--resume ${session.sessionId}`))
  )
}

// Cross-platform parent PID lookup: single ps snapshot on macOS/BSD, /proc on Linux.
const findAncestors = pid => {
  if (process.platform === 'darwin') {
    try {
      const out = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' })
      const parentOf = new Map()
      for (const line of out.split('\n')) {
        const [p, pp] = line.trim().split(/\s+/).map(Number)
        if (p && pp) parentOf.set(p, pp)
      }
      const pids = []
      for (let current = pid; current > 1 && pids.length < 32; current = parentOf.get(current) ?? 0) {
        pids.push(current)
      }
      return pids
    } catch {
      return []
    }
  }
  if (process.platform === 'linux') {
    const pids = []
    for (let current = pid; current > 1 && pids.length < 32; ) {
      pids.push(current)
      try {
        const stat = fs.readFileSync(`/proc/${current}/stat`, 'utf8')
        current = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]) || 0
      } catch {
        break
      }
    }
    return pids
  }
  return []
}

const terminalForPid = new Map()
const appliedTerminalTitles = new WeakMap()

const terminalTitleFor = (session, pattern) => {
  const folder = session.folder ?? session.ticket
  const short = withoutTicketSuffix(session.name, pattern) || session.name
  if (session.hasCustomName && short && short !== 'Untitled') {
    return short
  }
  if (folder) return folder
  return short || undefined
}

const findTerminalForSession = async session => {
  if (!session.interactive) {
    return vscode.window.terminals.find(
      terminal => terminal.exitStatus === undefined && isAttachTerminal(terminal, session),
    )
  }
  if (!session.pid) return undefined
  const cached = terminalForPid.get(session.pid)
  if (cached && cached.exitStatus === undefined && vscode.window.terminals.includes(cached)) {
    return cached
  }
  let ancestors = []
  try {
    ancestors = findAncestors(session.pid)
  } catch {}
  for (const terminal of vscode.window.terminals) {
    if (terminal.exitStatus === undefined && ancestors.includes(await terminal.processId)) {
      terminalForPid.set(session.pid, terminal)
      return terminal
    }
  }
  return undefined
}

const applyTerminalTitleIfActive = async (terminal, desired) => {
  if (!terminal || !desired) return
  if (vscode.window.activeTerminal !== terminal) return
  if (appliedTerminalTitles.get(terminal) === desired || terminal.name === desired) return
  appliedTerminalTitles.set(terminal, desired)
  try {
    await vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name: desired })
  } catch {}
}

const syncTerminalTitles = async provider => {
  const active = vscode.window.activeTerminal
  if (!active || active.exitStatus !== undefined) return
  for (const session of provider.sessions) {
    if (session.ended) continue
    const desired = terminalTitleFor(session, provider.pattern)
    if (!desired) continue
    const terminal = await findTerminalForSession(session)
    if (terminal === active) {
      await applyTerminalTitleIfActive(terminal, desired)
      return
    }
  }
}

// claude attach takes background sessions only; an interactive one can just be shown where it runs.
const focusInteractive = async (session, provider) => {
  const terminal = await findTerminalForSession(session)
  if (terminal) {
    terminal.show()
    const desired = provider && terminalTitleFor(session, provider.pattern)
    if (desired) {
      setTimeout(() => applyTerminalTitleIfActive(terminal, desired), 50)
    }
    return
  }
  vscode.window.showInformationMessage(`${session.name} runs outside VS Code's terminals (pid ${session.pid}).`)
}

const closeTerminalForSession = async session => {
  if (!session) return
  let terminal = await findTerminalForSession(session)
  if (!terminal && session.pid) {
    const cached = terminalForPid.get(session.pid)
    if (cached && vscode.window.terminals.includes(cached)) {
      terminal = cached
    }
  }
  if (!terminal && !session.interactive) {
    terminal = vscode.window.terminals.find(t => isAttachTerminal(t, session))
  }
  if (terminal) {
    if (session.pid) terminalForPid.delete(session.pid)
    try {
      terminal.dispose()
    } catch {}
  }
}

const hideSession = async (session, provider) => {
  if (!session) return
  await provider.setHidden(session, true)
  if (provider?.config?.closeTerminalOnArchive !== false) {
    await closeTerminalForSession(session)
  }
}

// Opens an interactive Claude terminal directly in an editor tab, optionally pre-bound to a folder or ticket.
const newSession = folder =>
  vscode.window
    .createTerminal({
      name: folder || 'Claude',
      shellPath: CLAUDE,
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      env: folder ? { AGENT_COCKPIT_FOLDER: folder, CLAUDE_DECK_FOLDER: folder } : undefined,
      iconPath: new vscode.ThemeIcon('comment-discussion'),
      location: vscode.TerminalLocation.Editor,
    })
    .show()

const attach = async (session, provider) => {
  if (session.interactive) return focusInteractive(session, provider)
  const pattern = provider.pattern
  const open = await findTerminalForSession(session)
  if (open) {
    open.show()
    const desired = terminalTitleFor(session, pattern)
    if (desired) setTimeout(() => applyTerminalTitleIfActive(open, desired), 50)
    return
  }
  const short = withoutTicketSuffix(session.name, pattern) || session.name
  vscode.window
    .createTerminal({
      name: short,
      shellPath: CLAUDE,
      shellArgs: attachArgs(session),
      cwd: session.cwd,
      env: session.ticket ? { AGENT_COCKPIT_FOLDER: session.ticket, CLAUDE_DECK_FOLDER: session.ticket } : undefined,
      iconPath: new vscode.ThemeIcon('hubot'),
      location: vscode.TerminalLocation.Editor,
    })
    .show()
}

// Migrate from legacy claude-tickets and claude-deck
const migrateLegacyData = async () => {
  const copy = (from, to) => fs.existsSync(from) && fs.promises.cp(from, to, { recursive: true })
  if (!fs.existsSync(DECK_DIR) && fs.existsSync(path.join(CLAUDE_DIR, 'tickets'))) {
    await fs.promises.mkdir(DECK_DIR, { recursive: true })
    await Promise.all([
      copy(path.join(CLAUDE_DIR, 'tickets', 'sessions'), path.join(DECK_DIR, 'sessions')),
      copy(path.join(CLAUDE_DIR, 'tickets', 'view.json'), path.join(DECK_DIR, 'view.json')),
      copy(path.join(CLAUDE_DIR, 'ticket-titles.json'), path.join(DECK_DIR, 'ticket-titles.json')),
    ]).catch(() => {})
  }
  if (!fs.existsSync(COCKPIT_DIR) && fs.existsSync(DECK_DIR)) {
    await fs.promises.mkdir(COCKPIT_DIR, { recursive: true })
    await Promise.all([
      copy(path.join(DECK_DIR, 'sessions'), SESSIONS_DIR),
      copy(path.join(DECK_DIR, 'view.json'), VIEW_FILE),
      copy(path.join(DECK_DIR, 'ticket-titles.json'), TITLES_FILE),
    ]).catch(() => {})
  }
}

const search = async provider => {
  const now = Date.now()
  const items = [...provider.sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(session => {
      const status = STATUS[session.state] ?? { label: session.state, icon: 'circle-outline' }
      const folder = session.folder ?? session.ticket
      const tKey = folderTicket(folder, provider.pattern)
      const title =
        tKey &&
        (provider.titles[folder] ??
          provider.titles[tKey] ??
          provider.issues[folder]?.summary ??
          provider.issues[tKey]?.summary)
      const when = `${age(now - session.updatedAt)}${provider.isHidden(session) ? ' · hidden' : ''}`
      return {
        label: `$(${status.icon}) ${withoutTicketSuffix(session.name, provider.pattern) || session.name}`,
        description: [folder, title].filter(Boolean).join(' · '),
        detail: [status.label, when].filter(Boolean).join(' · '),
        session,
      }
    })
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Search sessions',
    placeHolder: 'Session name, folder, ticket key or title',
    matchOnDescription: true,
    matchOnDetail: true,
  })
  if (picked) attach(picked.session, provider)
}

const moveToFolder = async (session, provider, refresh) => {
  const known = new Set([
    ...provider.folders,
    ...provider.sessions.map(s => s.folder ?? s.ticket).filter(Boolean),
  ])
  const items = [
    { label: '$(add) New folder or ticket…', action: 'new' },
    ...([...known].map(f => {
      const tKey = folderTicket(f, provider.pattern)
      return {
        label: `$(folder) ${f}`,
        description: tKey ? (provider.titles[f] ?? provider.titles[tKey] ?? provider.issues[tKey]?.summary ?? '') : '',
        folder: f,
      }
    })),
    ...(session.ticket ? [{ label: '$(close) Remove from folder (Ungrouped)', action: 'none' }] : []),
  ]
  const picked = await vscode.window.showQuickPick(items, {
    title: `Move "${session.name}" to folder`,
    placeHolder: 'Choose a folder or ticket, or create a new one',
  })
  if (!picked) return
  if (picked.action === 'none') {
    await provider.assign(session, undefined)
    return refresh(true)
  }
  if (picked.action === 'new') {
    const input = (
      await vscode.window.showInputBox({
        title: 'New folder or ticket',
        placeHolder: 'e.g. Auth Refactor, PROJ-123, or #42',
      })
    )?.trim()
    if (!input) return
    const folder = await provider.addFolder(input)
    await provider.assign(session, folder)
    return refresh(true)
  }
  if (picked.folder) {
    await provider.assign(session, picked.folder)
    return refresh(true)
  }
}

const activate = async context => {
  const provider = new SessionsProvider()
  await migrateLegacyData()
  const sessionById = id => provider.sessions.find(session => session.id === id || session.sessionId === id)
  const inbox = new InboxView(provider, {
    attach: ({ id }) => sessionById(id) && attach(sessionById(id), provider),
    openUrl: ({ url }) => vscode.env.openExternal(vscode.Uri.parse(url)),
    openTicket: ({ ticket }) => openJira({ group: { ticket } }),
    newSession: ({ folder } = {}) => vscode.commands.executeCommand('agentCockpit.newSession', folder && { group: { ticket: folder } }),
    newFolder: () => vscode.commands.executeCommand('agentCockpit.newFolder'),
    renameFolder: ({ folder }) => vscode.commands.executeCommand('agentCockpit.renameFolder', { folder }),
    removeFolder: ({ folder }) => provider.removeFolder(folder),
    configureGithubScope: () => vscode.commands.executeCommand('agentCockpit.configureGithubScope'),
    moveToFolder: ({ id }) => sessionById(id) && moveToFolder(sessionById(id), provider, refresh),
    refresh: () => refresh(true),
    shown: () => refresh(),
    toggleKeepWarm: async ({ id }) => {
      const session = sessionById(id)
      if (!session) return
      const next = !session.keepWarm
      const durationMs = 30 * 60_000
      await updateSessionRecord(session, {
        keepWarm: next,
        keepWarmUntil: next ? Date.now() + durationMs : null,
      })
      refresh(true)
    },
    rename: ({ id }) => sessionById(id) && vscode.commands.executeCommand('agentCockpit.rename', { session: sessionById(id) }),
    hide: ({ id }) => sessionById(id) && hideSession(sessionById(id), provider),
    show: ({ id }) => sessionById(id) && provider.setHidden(sessionById(id), false),
    assign: async ({ id, ticket }) => {
      const session = sessionById(id)
      if (!session) return
      await provider.assign(session, ticket ?? undefined)
      refresh(true)
    },
    reorderSession: async ({ movedId, targetId, before, folder }) => {
      const session = sessionById(movedId)
      if (!session) return
      await provider.reorderSession(session, targetId, before, folder)
      refresh(true)
    },
  })
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('agentCockpit.inbox', inbox),
    provider.onDidChange(() => inbox.post()),
  )
  try {
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('claudeDeck.inbox', inbox))
  } catch {}
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10)
  statusBar.command = 'agentCockpit.focus'
  context.subscriptions.push(statusBar)

  const updateStatusBar = () => {
    const blocked = provider.sessions.filter(s => s.state === 'blocked' && !provider.isHidden(s))
    const working = provider.sessions.filter(s => s.state === 'working' && !provider.isHidden(s))
    const live = provider.sessions.filter(s => !provider.isHidden(s) && !s.ended)
    if (blocked.length > 0) {
      statusBar.text = `$(bell-dot) Claude (${blocked.length} waiting)`
      statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground')
      statusBar.tooltip = `${blocked.length} session${blocked.length > 1 ? 's' : ''} need input · click to open`
      statusBar.show()
    } else if (working.length > 0) {
      statusBar.text = `$(sync~spin) Claude (${working.length} running)`
      statusBar.backgroundColor = undefined
      statusBar.tooltip = `${working.length} session${working.length > 1 ? 's' : ''} working · click to open cockpit`
      statusBar.show()
    } else if (live.length > 0) {
      statusBar.text = `$(hubot) Claude (${live.length})`
      statusBar.backgroundColor = undefined
      statusBar.tooltip = `${live.length} Claude session${live.length > 1 ? 's' : ''} · click to open cockpit`
      statusBar.show()
    } else {
      statusBar.hide()
    }
  }

  const notify = session => {
    const name = withoutTicketSuffix(session.name, provider.pattern) || session.name
    vscode.window
      .showWarningMessage(`${session.ticket ? `${session.ticket} · ` : ''}${name} needs input`, 'Open')
      .then(choice => choice && attach(session, provider))
  }
  let running
  const refresh = (force = false) =>
    (running ??= provider
      .refresh({ force, withRemote: inbox.visible })
      .then(blocked => {
        blocked.forEach(notify)
        updateStatusBar()
        void syncTerminalTitles(provider)
      })
      .finally(() => (running = undefined)))
  // Sessions refresh while the view is hidden too, so a session needing input still notifies.
  const timer = setInterval(() => refresh(), REFRESH_MS)
  fs.mkdirSync(SESSIONS_DIR, { recursive: true })
  const watchers = [fs.watch(SESSIONS_DIR, () => refresh())]
  if (fs.existsSync(path.join(DECK_DIR, 'sessions'))) {
    try {
      watchers.push(fs.watch(path.join(DECK_DIR, 'sessions'), () => refresh()))
    } catch {}
  }
  const openJira = async element => {
    const raw = element?.group?.ticket ?? element?.ticket
    const ticket = folderTicket(raw, provider.pattern)
    if (!ticket) return
    const issueUrl = provider.issues[ticket]?.url
    if (issueUrl) return vscode.env.openExternal(vscode.Uri.parse(issueUrl))
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir()
    if (ticket.includes('#')) {
      const [repo, num] = ticket.startsWith('#') ? [undefined, ticket.slice(1)] : ticket.split('#')
      const args = ['issue', 'view', num, '--web']
      if (repo) args.push('-R', repo)
      await run(GH, args, undefined, { cwd }).catch(() => {})
      return
    }
    if (provider.env.JIRA_URL) {
      return vscode.env.openExternal(vscode.Uri.parse(`${provider.env.JIRA_URL.replace(/\/$/, '')}/browse/${ticket}`))
    }
    await run(ACLI, ['jira', 'workitem', 'view', ticket, '--web'], undefined, { cwd }).catch(() =>
      run(JIRA_CLI, ['open', ticket], undefined, { cwd }).catch(() => {}),
    )
  }

  const registerCmd = (name, handler) => [
    vscode.commands.registerCommand(`agentCockpit.${name}`, handler),
    vscode.commands.registerCommand(`claudeDeck.${name}`, handler),
  ]

  context.subscriptions.push(
    { dispose: () => clearInterval(timer) },
    ...watchers.map(w => ({ dispose: () => w.close() })),
    vscode.window.onDidChangeActiveTerminal(() => void syncTerminalTitles(provider)),
    vscode.workspace.onDidChangeConfiguration(
      e => (e.affectsConfiguration('agentCockpit') || e.affectsConfiguration('claudeDeck')) && refresh(true),
    ),
    ...registerCmd('focus', () => {
      const blocked = provider.sessions.find(s => s.state === 'blocked' && !provider.isHidden(s))
      if (blocked) return attach(blocked, provider)
      vscode.commands.executeCommand('agentCockpit.inbox.focus').then(
        () => {},
        () => vscode.commands.executeCommand('claudeDeck.inbox.focus'),
      )
    }),
    ...registerCmd('refresh', () => refresh(true)),
    ...registerCmd('attach', session => attach(session, provider)),
    ...registerCmd('openJira', openJira),
    ...registerCmd('search', () => search(provider)),
    ...registerCmd('rename', async ({ session }) => {
      const name = (await vscode.window.showInputBox({ title: 'Rename session', value: session.name }))?.trim()
      if (!name || name === session.name) return
      await rename(session, name, provider.pattern)
      refresh()
    }),
    ...registerCmd('newFolder', async () => {
      const input = (
        await vscode.window.showInputBox({
          title: 'New folder or ticket',
          prompt: 'Enter a topic/project name (e.g. "Auth Refactor") or a ticket key (e.g. "PROJ-123" or "#42")',
          placeHolder: 'Auth Refactor or PROJ-123',
        })
      )?.trim()
      if (!input) return
      await provider.addFolder(input)
      refresh(true)
    }),
    ...registerCmd('renameFolder', async ({ folder } = {}) => {
      if (!folder) return
      const input = (
        await vscode.window.showInputBox({
          title: 'Rename folder',
          value: folder,
        })
      )?.trim()
      if (!input || input === folder) return
      await provider.renameFolder(folder, input)
      refresh(true)
    }),
    ...registerCmd('newSession', async element => {
      const folder = element?.group?.ticket ?? (typeof element === 'string' ? element : undefined)
      newSession(folder)
      // claude takes a moment to register itself.
      setTimeout(() => refresh(), 2_500)
    }),
    ...registerCmd('startTask', async element => {
      const folder = element?.group?.ticket
      newSession(folder)
      setTimeout(() => refresh(), 2_500)
    }),
    ...registerCmd('hide', async element => {
      const session = element?.session ?? (element?.id || element?.sessionId ? sessionById(element.id ?? element.sessionId) : element)
      if (session) await hideSession(session, provider)
    }),
    ...registerCmd('show', element => provider.setHidden(element.session, false)),
    ...registerCmd('toggleKeepWarm', async element => {
      const session = element?.session ?? (element?.id ? sessionById(element.id) : undefined)
      if (!session) return
      const next = !session.keepWarm
      const durationMs = 30 * 60_000
      await updateSessionRecord(session, {
        keepWarm: next,
        keepWarmUntil: next ? Date.now() + durationMs : null,
      })
      refresh(true)
    }),
    ...registerCmd('configureGithubScope', async () => {
      const config = vscode.workspace.getConfiguration('agentCockpit')
      const currentOrg = config.get('githubOrg', '')
      const currentRepos = config.get('githubRepositories', '')
      const isNone = config.get('pullRequests', 'auto') === 'none'

      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir()
      const detectedRepo = await detectGithubRepo(cwd)
      const currentMode = isNone
        ? 'Disabled'
        : currentOrg
        ? `Organization (${currentOrg})`
        : currentRepos
        ? `Repositories (${currentRepos})`
        : detectedRepo
        ? `Repositories (${detectedRepo})`
        : 'Not configured'

      const choice = await vscode.window.showQuickPick([
        {
          label: '$(organization) Organization',
          description: currentOrg ? `Currently: ${currentOrg}` : 'Search across all repositories in a GitHub organization',
          id: 'org',
          picked: Boolean(currentOrg) && !isNone,
        },
        {
          label: '$(repo) Repositories',
          description: currentRepos ? `Currently: ${currentRepos}` : `Specific repository or comma-separated list${detectedRepo ? ` (prefills ${detectedRepo})` : ''}`,
          id: 'repos',
          picked: (Boolean(currentRepos) || (!currentOrg && !isNone)) && !isNone,
        },
        {
          label: '$(circle-slash) Disabled',
          description: 'Do not search GitHub for pull requests',
          id: 'none',
          picked: isNone,
        },
      ], {
        title: 'Configure GitHub PR Search Scope',
        placeHolder: `Current: ${currentMode}`,
      })

      if (!choice) return
      const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global

      if (choice.id === 'org') {
        const org = (await vscode.window.showInputBox({
          title: 'GitHub Organization Scope',
          prompt: 'Enter the GitHub organization or username (e.g. "kaiketsu-labs")',
          value: currentOrg || (detectedRepo ? detectedRepo.split('/')[0] : ''),
          placeHolder: 'kaiketsu-labs',
        }))?.trim()
        if (org !== undefined) {
          if (org) {
            await config.update('githubOrg', org, target)
            await config.update('githubRepositories', undefined, target)
            if (isNone) await config.update('pullRequests', 'auto', target)
            vscode.window.showInformationMessage(`Agent Cockpit: GitHub PR scope set to org:${org}.`)
          } else {
            await config.update('githubOrg', undefined, target)
          }
        }
      } else if (choice.id === 'repos') {
        const repos = (await vscode.window.showInputBox({
          title: 'GitHub Repositories Scope',
          prompt: 'Enter specific repository or comma-separated list of owner/repo',
          value: currentRepos || detectedRepo || '',
          placeHolder: 'owner/repo or org/repo1, org/repo2',
        }))?.trim()
        if (repos !== undefined) {
          if (repos) {
            await config.update('githubRepositories', repos, target)
            await config.update('githubOrg', undefined, target)
            if (isNone) await config.update('pullRequests', 'auto', target)
            vscode.window.showInformationMessage(`Agent Cockpit: GitHub PR scope set to ${repos}.`)
          } else {
            await config.update('githubRepositories', undefined, target)
          }
        }
      } else if (choice.id === 'none') {
        await config.update('pullRequests', 'none', target)
        vscode.window.showInformationMessage('Agent Cockpit: GitHub PR search disabled.')
      }
      refresh(true)
    }),
  )
  refresh(true)
}

module.exports = { activate, deactivate: () => {} }
