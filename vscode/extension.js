'use strict'

const vscode = require('vscode')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile, execFileSync } = require('child_process')
const {
  STATUS,
  ticketPattern,
  firstTicket,
  withoutTicketSuffix,
  groupSessions,
  moveBefore,
  searchQueries,
  prsByTicket,
  isClosed,
  isHidden,
  ticketOf,
  mergeSessions,
  ancestorPids,
  cacheTtlMs,
  cacheLeft,
  clock,
  age,
} = require('./group')

const CLAUDE_DIR = path.join(os.homedir(), '.claude')
// The claude-deck plugin writes one file per session; order and hide flags sit beside them for every window.
const DECK_DIR = path.join(CLAUDE_DIR, 'deck')
const SESSIONS_DIR = path.join(DECK_DIR, 'sessions')
const VIEW_FILE = path.join(DECK_DIR, 'view.json')
// The claude-deck plugin in each running session polls here and runs /rename itself.
const RENAMES_DIR = path.join(DECK_DIR, 'renames')
const REFRESH_MS = 5_000
const DRAG_MIME = 'application/vnd.code.tree.claudedeck.sessions'
const JIRA_MS = 60_000
// GitHub allows 30 searches a minute; each refresh spends one per six tickets.
const PRS_MS = 120_000

// The extension host's PATH often lacks ~/.local/bin, where the installers put claude and gh.
const localBin = name => {
  const file = path.join(os.homedir(), '.local', 'bin', name)
  return fs.existsSync(file) ? file : name
}
const CLAUDE = localBin('claude')
const GH = localBin('gh')

const ISSUE_ICON = {
  new: { label: 'to do', icon: 'circle-large-outline' },
  indeterminate: { label: 'in progress', icon: 'play-circle', color: 'charts.blue' },
  done: { label: 'done', icon: 'pass-filled', color: 'charts.green' },
}
const UNKNOWN_ISSUE = { label: 'no Jira status', icon: 'question' }

const PR_ICON = {
  open: { label: 'open', icon: 'git-pull-request', color: 'charts.green' },
  draft: { label: 'draft', icon: 'git-pull-request-draft', color: 'disabledForeground' },
}

const themeIcon = ({ icon, color }) => new vscode.ThemeIcon(icon, color && new vscode.ThemeColor(color))

const LEGEND = [
  { label: 'Ticket (Jira status category)', entries: [...Object.values(ISSUE_ICON), UNKNOWN_ISSUE] },
  { label: 'Session', entries: Object.values(STATUS) },
  { label: 'Pull request', entries: Object.values(PR_ICON) },
]

const legendProvider = {
  getChildren: element => (element ? element.entries : LEGEND),
  getTreeItem: element => {
    if (element.entries) return new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded)
    const item = new vscode.TreeItem(element.label)
    item.iconPath = themeIcon(element)
    return item
  },
}

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

// The env Claude Code sessions see: user settings, then each workspace's project and local settings.
const loadEnv = async () => {
  const roots = (vscode.workspace.workspaceFolders ?? []).map(folder => path.join(folder.uri.fsPath, '.claude'))
  const files = [path.join(CLAUDE_DIR, 'settings.json')].concat(
    ...roots.map(root => [path.join(root, 'settings.json'), path.join(root, 'settings.local.json')]),
  )
  const envs = await Promise.all(files.map(async file => (await readJson(file, {})).env ?? {}))
  return Object.assign({}, process.env, ...envs)
}

const listAgents = async () => JSON.parse(await run(CLAUDE, ['agents', '--json', '--all']))

const readSessionFiles = async () => {
  const names = await fs.promises.readdir(SESSIONS_DIR).catch(() => [])
  const files = await Promise.all(names.filter(name => name.endsWith('.json')).map(name => readJson(path.join(SESSIONS_DIR, name))))
  return files.filter(Boolean)
}

const loadSessions = async pattern => {
  const [agents, files] = await Promise.all([listAgents(), readSessionFiles()])
  return withPendingRenames(mergeSessions(agents, files, pattern), pattern)
}

// A requested name shows at once; the request goes once the session carries the name.
const withPendingRenames = async (sessions, pattern) => {
  const requested = await fs.promises.readdir(RENAMES_DIR).catch(() => [])
  if (requested.length === 0) return sessions
  const byId = new Map(sessions.map(session => [session.sessionId, session]))
  for (const sessionId of requested) {
    const file = path.join(RENAMES_DIR, sessionId)
    const name = (await fs.promises.readFile(file, 'utf8').catch(() => '')).trim()
    const session = byId.get(sessionId)
    if (!session) continue
    if (session.name === name) {
      await fs.promises.rm(file, { force: true })
      continue
    }
    Object.assign(session, { name, ticket: ticketOf(name, pattern), isRenaming: true })
  }
  return sessions
}

// An ended session has no process to run /rename, so the sidebar names it in its file alone.
const rename = async (session, name) => {
  if (session.ended) {
    const file = path.join(SESSIONS_DIR, `${session.sessionId}.json`)
    const record = await readJson(file, {})
    return fs.promises.writeFile(file, JSON.stringify({ ...record, name }, null, 2))
  }
  await fs.promises.mkdir(RENAMES_DIR, { recursive: true })
  await fs.promises.writeFile(path.join(RENAMES_DIR, session.sessionId), name)
}

const loadIssues = async (env, keys) => {
  if (!env.JIRA_URL || !env.JIRA_TOKEN || keys.length === 0) return {}
  const jql = encodeURIComponent(`key in (${keys.join(',')})`)
  const url = `${env.JIRA_URL}/rest/api/2/search?validateQuery=warn&maxResults=${keys.length}&fields=status,summary&jql=${jql}`
  // The token goes in on stdin, so it never shows in the process list.
  const body = await run('curl', ['-s', '--fail', '-H', '@-', url], `Authorization: Bearer ${env.JIRA_TOKEN}\n`)
  const issues = {}
  for (const issue of JSON.parse(body).issues) {
    const { status, summary } = issue.fields
    issues[issue.key] = { status: status.name, category: status.statusCategory.key, summary }
  }
  return issues
}

const loadPrs = async keys => {
  const pages = await Promise.all(
    searchQueries(keys).map(q => run(GH, ['api', '-X', 'GET', 'search/issues', '-f', `q=${q}`, '-f', 'per_page=100'])),
  )
  return prsByTicket(pages.flatMap(page => JSON.parse(page).items), keys)
}

const elementId = element => {
  if (element?.kind === 'section') return `section:${element.id}`
  if (element?.kind === 'ticket') return `${element.hidden ? 'hidden:' : ''}ticket:${element.group.ticket ?? ''}`
  return undefined
}

const orderKey = element => {
  if (element?.kind === 'ticket') return element.group.ticket ?? undefined
  if (element?.kind === 'session') return element.session.id
  return undefined
}

const ruleItem = () => {
  const item = new vscode.TreeItem('─'.repeat(40))
  item.id = 'rule'
  item.tooltip = 'Sessions without a ticket'
  return item
}

const withSiblings = children => {
  const siblings = children.map(orderKey)
  return children.map(child => ({ ...child, siblings }))
}

class SessionsProvider {
  constructor() {
    this.changed = new vscode.EventEmitter()
    this.onDidChangeTreeData = this.changed.event
    this.sessions = []
    this.groups = []
    this.hidden = []
    this.titles = {}
    this.issues = {}
    this.prs = {}
    this.fetchedAt = { sessions: 0, issues: 0, prs: 0 }
    this.env = {}
    this.pattern = ticketPattern()
    this.errors = {}
    this.view = {}
    this.cacheTtl = cacheTtlMs({})
    this.isLoaded = false
  }

  get order() {
    return this.view.order ?? []
  }

  async setOrder(order) {
    await this.saveView({ order })
  }

  async setHidden(session, isHidden) {
    await this.saveView({ hidden: { ...this.view.hidden, [session.id]: isHidden } })
  }

  async saveView(change) {
    this.view = { ...(await readJson(VIEW_FILE, {})), ...change }
    await fs.promises.mkdir(DECK_DIR, { recursive: true })
    await fs.promises.writeFile(VIEW_FILE, JSON.stringify(this.view, null, 2))
    this.regroup()
    this.changed.fire()
  }

  isHidden(session) {
    const isTicketClosed = session.ticket !== undefined && isClosed(this.issues[session.ticket])
    return isHidden(session, Date.now(), isTicketClosed, this.view.hidden?.[session.id])
  }

  regroup() {
    this.groups = groupSessions(this.sessions.filter(session => !this.isHidden(session)), this.order)
    this.hidden = groupSessions(this.sessions.filter(session => this.isHidden(session)), this.order)
  }

  // Resolves to the sessions that started needing input since the last refresh.
  async refresh({ force = false, withRemote = true } = {}) {
    this.env = await loadEnv()
    this.view = await readJson(VIEW_FILE, {})
    this.cacheTtl = cacheTtlMs(this.env)
    const before = new Map(this.sessions.map(session => [session.id, session.state]))
    const projects = (this.env.TICKET_PROJECTS ?? '').split(',').map(project => project.trim()).filter(Boolean)
    this.pattern = ticketPattern(projects)
    await Promise.all([
      this.track('claude agents', async () => {
        this.sessions = await loadSessions(this.pattern)
        this.regroup()
      }, 'sessions'),
      readJson(path.join(DECK_DIR, 'ticket-titles.json'), {}).then(titles => (this.titles = titles)),
    ])
    const keysOf = groups => groups.map(group => group.ticket).filter(Boolean)
    const keys = keysOf(this.groups)
    const allKeys = [...new Set(this.sessions.map(session => session.ticket).filter(Boolean))]
    const isDue = (what, ms) => withRemote && (force || Date.now() - this.fetchedAt[what] > ms)
    // PRs only for live tickets: each six keys cost one of GitHub's 30 searches a minute.
    await Promise.all([
      isDue('issues', JIRA_MS) && this.track('Jira', async () => (this.issues = await loadIssues(this.env, allKeys)), 'issues'),
      isDue('prs', PRS_MS) && this.track('gh search', async () => (this.prs = await loadPrs(keys)), 'prs'),
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

  // Active tickets, then a rule, then sessions without a ticket; the rest goes to the history view.
  topLevel() {
    const tickets = withSiblings(this.groups.filter(group => group.ticket !== null).map(group => ({ kind: 'ticket', group })))
    const loose = withSiblings((this.groups.find(group => group.ticket === null)?.sessions ?? []).map(session => ({ kind: 'session', session })))
    const rule = tickets.length > 0 && loose.length > 0 ? [{ kind: 'rule' }] : []
    return [...tickets, ...rule, ...loose]
  }

  history() {
    return this.getChildren({ kind: 'section', id: 'history', groups: this.hidden })
  }

  getChildren(element) {
    if (!element) return this.topLevel()
    const parent = elementId(element)
    if (element.kind === 'section') return withSiblings(element.groups.map(group => ({ kind: 'ticket', group, hidden: true, parent })))
    const sessions = withSiblings(element.group.sessions.map(session => ({ kind: 'session', session, parent })))
    if (element.hidden) return sessions
    const prs = (this.prs[element.group.ticket] ?? []).map(pr => ({ kind: 'pr', pr }))
    return [...prs, ...sessions]
  }

  // Dropped on a sibling, an item moves before it; dropped on its parent, it moves last.
  async moveTo(dragged, target) {
    const key = orderKey(dragged)
    if (!key || !dragged.siblings) return
    const before = target && target.parent === dragged.parent && orderKey(target)
    if (!before && elementId(target) !== dragged.parent) return
    await this.setOrder(moveBefore(this.order, dragged.siblings, key, before || undefined))
  }

  getTreeItem(element) {
    if (element.kind === 'rule') return ruleItem()
    if (element.kind === 'ticket') return this.ticketItem(element.group, element.hidden)
    if (element.kind === 'pr') return this.prItem(element.pr)
    return this.sessionItem(element.session)
  }

  ticketItem(group, hidden = false) {
    const issue = this.issues[group.ticket]
    const prs = hidden ? [] : (this.prs[group.ticket] ?? [])
    const { Expanded, Collapsed } = vscode.TreeItemCollapsibleState
    const isOpen = !hidden && (group.isActive || prs.length > 0)
    const item = new vscode.TreeItem(group.ticket ?? 'No ticket', isOpen ? Expanded : Collapsed)
    // A ticket can have shown and hidden sessions, so it may show in both places.
    item.id = elementId({ kind: 'ticket', group, hidden })
    item.contextValue = group.ticket ? 'ticket' : undefined
    const title = this.titles[group.ticket] ?? issue?.summary
    const counts = group.counts.map(({ label, count }) => `${count} ${label}`).join(' · ')
    const prCount = prs.length > 0 ? `${prs.length} open PR${prs.length > 1 ? 's' : ''}` : undefined
    item.description = [title, counts, prCount].filter(Boolean).join(' · ')
    item.iconPath = themeIcon(ISSUE_ICON[issue?.category] ?? UNKNOWN_ISSUE)
    item.tooltip = [`${group.ticket}: ${issue?.summary ?? title ?? ''}`, issue?.status].filter(Boolean).join('\n')
    return item
  }

  prItem(pr) {
    const item = new vscode.TreeItem(`${pr.repo}#${pr.number}`)
    item.description = pr.title
    item.iconPath = themeIcon(pr.isDraft ? PR_ICON.draft : PR_ICON.open)
    item.tooltip = `${pr.isDraft ? 'Draft: ' : ''}${pr.title}\n${pr.url}`
    item.command = { command: 'vscode.open', title: 'Open PR', arguments: [vscode.Uri.parse(pr.url)] }
    return item
  }

  sessionItem(session) {
    const status = STATUS[session.state] ?? { label: session.state, icon: 'circle-outline' }
    const item = new vscode.TreeItem(withoutTicketSuffix(session.name, this.pattern))
    item.id = `session:${session.id}`
    item.contextValue = this.isHidden(session) ? 'session.hidden' : 'session'
    const activity = age(Date.now() - session.updatedAt)
    // A working session keeps its cache warm, so the countdown only matters between turns.
    const left = session.state !== 'working' && session.lastWriteAt ? cacheLeft(session.lastWriteAt, this.cacheTtl, Date.now()) : 0
    const cache = left > 0 ? `cache ${clock(left)}` : undefined
    item.description = [activity, cache].filter(Boolean).join(' · ')
    item.iconPath = themeIcon(status)
    const cacheLine = session.state === 'working' ? undefined : cache ? `${cache} left` : 'cache cold'
    const renaming = session.isRenaming && 'rename pending: applies once the session is idle with the claude-deck plugin loaded'
    item.tooltip = [session.name, `${status.label} · ${session.id}`, session.lastWriteAt && cacheLine, renaming]
      .filter(Boolean)
      .join('\n')
    item.command = { command: 'claudeDeck.attach', title: 'Attach', arguments: [session] }
    return item
  }
}

// An exited interactive session can't be attached, only resumed.
const attachArgs = session => (session.ended ? ['--resume', session.id] : ['attach', session.id])

const isAttachTerminal = (terminal, session) => {
  const args = terminal.creationOptions?.shellArgs
  return Array.isArray(args) && args.join(' ') === attachArgs(session).join(' ')
}

// Cross-platform parent PID: ps on macOS/BSD, /proc on Linux.
const getParentPid = pid => {
  if (process.platform === 'darwin') {
    try {
      const out = execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim()
      return Number(out) || 0
    } catch {
      return 0
    }
  }
  if (process.platform === 'linux') {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
      return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]) || 0
    } catch {
      return 0
    }
  }
  return 0
}

const findAncestors = pid => {
  const pids = []
  for (let current = pid; current > 1 && pids.length < 32; current = getParentPid(current)) {
    pids.push(current)
  }
  return pids
}

// claude attach takes background sessions only; an interactive one can just be shown where it runs.
const focusInteractive = async session => {
  let ancestors = []
  try {
    ancestors = findAncestors(session.pid)
  } catch {}
  for (const terminal of vscode.window.terminals) {
    if (ancestors.includes(await terminal.processId)) return terminal.show()
  }
  vscode.window.showInformationMessage(`${session.name} runs outside VS Code's terminals (pid ${session.pid}).`)
}

const newSession = () =>
  vscode.window
    .createTerminal({
      name: 'Claude',
      shellPath: CLAUDE,
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      iconPath: new vscode.ThemeIcon('comment-discussion'),
      location: vscode.TerminalLocation.Editor,
    })
    .show()

const attach = (session, provider) => {
  if (session.interactive) return focusInteractive(session)
  const pattern = provider.pattern
  const open = vscode.window.terminals.find(
    terminal => terminal.exitStatus === undefined && isAttachTerminal(terminal, session),
  )
  if (open) return open.show()
  const short = withoutTicketSuffix(session.name, pattern)
  vscode.window
    .createTerminal({
      name: session.ticket ? `${session.ticket} ${short}` : short,
      shellPath: CLAUDE,
      shellArgs: attachArgs(session),
      cwd: session.cwd,
      iconPath: new vscode.ThemeIcon('hubot'),
      location: vscode.TerminalLocation.Editor,
    })
    .show()
}

// claude-tickets, the predecessor, kept its files in ~/.claude/tickets and ~/.claude/ticket-titles.json.
const migrateFromClaudeTickets = async () => {
  if (fs.existsSync(DECK_DIR)) return
  const copy = (from, to) => fs.existsSync(from) && fs.promises.cp(from, to, { recursive: true })
  await fs.promises.mkdir(DECK_DIR, { recursive: true })
  await Promise.all([
    copy(path.join(CLAUDE_DIR, 'tickets', 'sessions'), SESSIONS_DIR),
    copy(path.join(CLAUDE_DIR, 'tickets', 'view.json'), VIEW_FILE),
    copy(path.join(CLAUDE_DIR, 'ticket-titles.json'), path.join(DECK_DIR, 'ticket-titles.json')),
  ]).catch(() => {})
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// The new session is the one id the list gains; --bg's printed text is not a stable interface.
const startTask = async (element, provider) => {
  const pattern = provider.pattern
  const ticket = element?.group?.ticket
  const args = await vscode.window.showInputBox({
    title: 'Start task',
    prompt: 'Ticket and task, passed to /start-task',
    placeHolder: 'PROJ-123 what to do',
    value: ticket ? `${ticket} ` : '',
  })
  if (args === undefined) return
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir()
  const before = new Set((await listAgents()).map(agent => agent.id))
  await run(CLAUDE, ['--bg', `/start-task ${args}`.trim()], undefined, { cwd })
  for (let attempt = 0; attempt < 20; attempt++) {
    const started = (await listAgents()).find(agent => !before.has(agent.id))
    if (!started) {
      await sleep(500)
      continue
    }
    const name = args.replace(pattern.key, '').trim() || 'start-task'
    return attach({ id: started.id, name, ticket: firstTicket([args], pattern) }, provider)
  }
  vscode.window.showWarningMessage('Started the session, but it did not show up in claude agents; find it in the list.')
}

const search = async provider => {
  const now = Date.now()
  const items = [...provider.sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(session => {
      const status = STATUS[session.state] ?? { label: session.state, icon: 'circle-outline' }
      const title = session.ticket && (provider.titles[session.ticket] ?? provider.issues[session.ticket]?.summary)
      const when = `${age(now - session.updatedAt)}${provider.isHidden(session) ? ' · hidden' : ''}`
      return {
        label: `$(${status.icon}) ${withoutTicketSuffix(session.name, provider.pattern)}`,
        description: [session.ticket, title].filter(Boolean).join(' · '),
        detail: [status.label, when].filter(Boolean).join(' · '),
        session,
      }
    })
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Search sessions',
    placeHolder: 'Session name, ticket key or title',
    matchOnDescription: true,
    matchOnDetail: true,
  })
  if (picked) attach(picked.session, provider)
}

const activate = async context => {
  const provider = new SessionsProvider()
  await migrateFromClaudeTickets()
  const dragAndDropController = {
    dragMimeTypes: [DRAG_MIME],
    dropMimeTypes: [DRAG_MIME],
    handleDrag: (elements, dataTransfer) => dataTransfer.set(DRAG_MIME, new vscode.DataTransferItem(elements)),
    handleDrop: async (target, dataTransfer) => {
      const [dragged] = dataTransfer.get(DRAG_MIME)?.value ?? []
      if (dragged) await provider.moveTo(dragged, target)
    },
  }
  const view = vscode.window.createTreeView('claudeDeck.sessions', { treeDataProvider: provider, dragAndDropController })
  const historyProvider = {
    onDidChangeTreeData: provider.onDidChangeTreeData,
    getChildren: element => (element ? provider.getChildren(element) : provider.history()),
    getTreeItem: element => provider.getTreeItem(element),
  }
  const history = vscode.window.createTreeView('claudeDeck.history', { treeDataProvider: historyProvider })
  const showCount = () => (history.description = `${provider.hidden.reduce((sum, group) => sum + group.sessions.length, 0)} sessions`)
  context.subscriptions.push(history, provider.onDidChangeTreeData(showCount))
  context.subscriptions.push(vscode.window.createTreeView('claudeDeck.legend', { treeDataProvider: legendProvider }))
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10)
  statusBar.command = 'claudeDeck.focus'
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
      statusBar.tooltip = `${working.length} session${working.length > 1 ? 's' : ''} working · click to open deck`
      statusBar.show()
    } else if (live.length > 0) {
      statusBar.text = `$(hubot) Claude (${live.length})`
      statusBar.backgroundColor = undefined
      statusBar.tooltip = `${live.length} Claude session${live.length > 1 ? 's' : ''} · click to open deck`
      statusBar.show()
    } else {
      statusBar.hide()
    }
  }

  const notify = session => {
    const name = withoutTicketSuffix(session.name, provider.pattern)
    vscode.window
      .showWarningMessage(`${session.ticket ? `${session.ticket} ` : ''}${name} needs input`, 'Open')
      .then(choice => choice && attach(session, provider))
  }
  let running
  const refresh = (force = false) =>
    (running ??= provider
      .refresh({ force, withRemote: view.visible })
      .then(blocked => {
        view.message = provider.message
        blocked.forEach(notify)
        updateStatusBar()
      })
      .finally(() => (running = undefined)))
  // Sessions refresh while the view is hidden too, so a session needing input still notifies.
  const timer = setInterval(() => refresh(), REFRESH_MS)
  fs.mkdirSync(SESSIONS_DIR, { recursive: true })
  const watcher = fs.watch(SESSIONS_DIR, () => refresh())
  const openJira = element => {
    if (provider.env.JIRA_URL) vscode.env.openExternal(vscode.Uri.parse(`${provider.env.JIRA_URL}/browse/${element.group.ticket}`))
  }
  context.subscriptions.push(
    view,
    { dispose: () => clearInterval(timer) },
    { dispose: () => watcher.close() },
    view.onDidChangeVisibility(({ visible }) => visible && refresh()),
    vscode.commands.registerCommand('claudeDeck.focus', () => {
      const blocked = provider.sessions.find(s => s.state === 'blocked' && !provider.isHidden(s))
      if (blocked) return attach(blocked, provider)
      vscode.commands.executeCommand('claudeDeck.sessions.focus')
    }),
    vscode.commands.registerCommand('claudeDeck.refresh', () => refresh(true)),
    vscode.commands.registerCommand('claudeDeck.attach', session => attach(session, provider)),
    vscode.commands.registerCommand('claudeDeck.openJira', openJira),
    vscode.commands.registerCommand('claudeDeck.search', () => search(provider)),
    vscode.commands.registerCommand('claudeDeck.sortAlphabetically', () => provider.setOrder([])),
    vscode.commands.registerCommand('claudeDeck.rename', async ({ session }) => {
      const name = (await vscode.window.showInputBox({ title: 'Rename session', value: session.name }))?.trim()
      if (!name || name === session.name) return
      await rename(session, name)
      refresh()
    }),
    vscode.commands.registerCommand('claudeDeck.newSession', async () => {
      newSession()
      // claude takes a moment to register itself.
      setTimeout(() => refresh(), 3_000)
    }),
    vscode.commands.registerCommand('claudeDeck.startTask', async element => {
      await startTask(element, provider)
      refresh(true)
    }),
    vscode.commands.registerCommand('claudeDeck.hide', element => provider.setHidden(element.session, true)),
    vscode.commands.registerCommand('claudeDeck.show', element => provider.setHidden(element.session, false)),
  )
  refresh(true)
}

module.exports = { activate, deactivate: () => {} }
