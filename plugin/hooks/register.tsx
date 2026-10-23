import type { EngineInterface, Register } from 'claude-code'

import { extractTicket, promptName, sanitizeDetail, sessionName, ticketPattern, ticketSuffix } from './group'

const RENAME_MS = 3_000
const START_SKILL = 'start-task'
const NAME_TOOL = 'mcp__deck__name_session'
const TITLES_TOOL = 'mcp__deck__set_ticket_titles'
const RESUME_PROMPT = `Session renamed. Continue ${START_SKILL} with the step after Name.`

// What the Claude Deck VS Code sidebar lists; it reads these files, never the transcripts.
type SessionFile = {
  sessionId: string
  kind: 'bg' | 'interactive'
  cwd: string
  startedAt: number
  name?: string
  prompt?: string
  detail?: string
  lastTurnEndAt?: number
  activeFiles?: string[]
}

const claudeDir = async ($: EngineInterface) => `${await $.env.get('HOME')}/.claude`

const titlesFile = async ($: EngineInterface) => `${await claudeDir($)}/deck/ticket-titles.json`

const storedTitles = async ($: EngineInterface) =>
  JSON.parse(await $.fs.read(await titlesFile($)).catch(() => '{}')) as Record<string, string>

const storeTitles = async ($: EngineInterface, added: Record<string, string>) =>
  $.fs.write(await titlesFile($), JSON.stringify({ ...(await storedTitles($)), ...added }, null, 2))

const sessionFile = async ($: EngineInterface, sessionId: string) => `${await claudeDir($)}/deck/sessions/${sessionId}.json`

const storedRecord = async ($: EngineInterface) =>
  $.fs
    .read(await sessionFile($, await $.session.id()))
    .then(text => JSON.parse(text) as SessionFile)
    .catch(() => undefined)

// Read before each write: the sidebar names ended sessions in the same file. The id moves on with /clear or /resume.
const save = async ($: EngineInterface, change: Partial<SessionFile>) => {
  if (!isListed) return
  const sessionId = await $.session.id()
  const record = { ...((await storedRecord($)) ?? { sessionId, kind, cwd: await $.session.cwd(), startedAt: Date.now() }), ...change }
  await $.fs.write(await sessionFile($, sessionId), JSON.stringify(record, null, 2))
}

// Conflict guard: warns when two active sessions touch the same file within 30 minutes.
const checkConflicts = async ($: EngineInterface, currentSessionId: string, filePath: string) => {
  try {
    const dir = `${await claudeDir($)}/deck/sessions`
    const entries = await $.fs.list(dir).catch(() => [])
    const fileName = filePath.split('/').pop() || filePath
    for (const entry of entries) {
      if (entry.kind === 'file' && entry.name.endsWith('.json') && !entry.name.startsWith(currentSessionId)) {
        const content = await $.fs.read(`${dir}/${entry.name}`).catch(() => '')
        if (!content) continue
        const other = JSON.parse(content) as SessionFile
        const isRecent = Date.now() - (other.lastTurnEndAt ?? other.startedAt) < 30 * 60_000
        const hasFile = other.activeFiles?.some(f => f === filePath || f.endsWith(`/${fileName}`))
        if (isRecent && hasFile) {
          $.ui.log(`\n⚠️  [Claude Deck Conflict Guard] Warning: "${fileName}" was also edited recently in session "${other.name || other.sessionId.slice(0, 8)}"\n`)
          break
        }
      }
    }
  } catch {}
}

// A -p run, a script's or a child of a background job's (it inherits CLAUDE_JOB_DIR), stays off the list.
let isListed = false
let kind: SessionFile['kind'] = 'interactive'
let pendingName: string | undefined
let isTurnRunning = false
let appliedRename: string | undefined
let projects: string[] = []
let suffix = ticketSuffix()

// A plugin's own $.command.run skips its command.run hooks, so the name is saved here.
const rename = async ($: EngineInterface, name: string) => {
  await $.command.run({ command: 'rename', args: name })
  await save($, { name })
}

// The VS Code sidebar asks for a rename by writing the new name to a file named after the session.
const applyRenameRequest = async ($: EngineInterface) => {
  if (isTurnRunning) return
  const file = `${await claudeDir($)}/deck/renames/${await $.session.id()}`
  const name = (await $.fs.read(file).catch(() => '')).trim()
  if (!name || name === appliedRename) return
  appliedRename = name
  await rename($, name).catch(err => $.ui.log(`rename: ${err}`))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const rawProjects = (await $.env.get('TICKET_PROJECTS')) ?? ''
    projects = rawProjects.split(',').map(project => project.trim()).filter(Boolean)
    suffix = ticketSuffix(projects)
    await $.tool.register({
      name: 'name_session',
      description: 'Renames this session to "<summary> (<ticket>)". The rename lands once the turn ends.',
      inputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'A few words on what this session does' },
          ticket: { type: 'string', description: 'Jira or issue key, e.g. PROJ-1234' },
          title: { type: 'string', description: "The ticket summary shortened to at most 6 words, shown beside the key in the Claude Deck sidebar" },
        },
        required: ['summary', 'ticket'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'set_ticket_titles',
      description: 'Stores short ticket titles shown beside the keys in the Claude Deck sidebar, without renaming the session.',
      inputSchema: {
        type: 'object',
        properties: {
          titles: {
            type: 'object',
            description: 'Ticket key to its summary shortened to at most 6 words, e.g. {"PROJ-1234": "Add PDF endpoint"}',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['titles'],
      },
    })
    // A job's directory is named after its session's first id, before any /clear.
    const jobId = (await $.env.get('CLAUDE_JOB_DIR'))?.split('/').pop()
    kind = jobId !== undefined && (await $.session.id()).startsWith(jobId) ? 'bg' : 'interactive'
    isListed = kind === 'bg' || e.isInteractive
    await save($, { cwd: e.cwd })
    $.clock.every(RENAME_MS, () => void applyRenameRequest($))

    return next(e)
  })

  // Auto-detect tickets in prompts: typing "fix nulls in PROJ-123" automatically binds and groups the session.
  on('prompt.submit', async ($, e, next) => {
    if (!e.isMeta) {
      const record = await storedRecord($)
      const pName = promptName(e.text)
      const updates: Partial<SessionFile> = {}
      if (record?.prompt === undefined) updates.prompt = pName

      const ticket = extractTicket(e.text, projects)
      if (ticket && (!record?.name || !record.name.match(suffix))) {
        const cleanSummary = pName
          .replace(ticketPattern(projects), '')
          .replace(/\s+/g, ' ')
          .replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '')
          .trim() || 'Task'
        const autoName = sessionName(cleanSummary, ticket, suffix)
        updates.name = autoName
        $.clock.after(0, () => void rename($, autoName).catch(() => {}))
      }

      if (Object.keys(updates).length > 0) await save($, updates).catch(err => $.ui.log(`deck: ${err}`))
    }
    return next(e)
  })

  // A /rename the person types.
  on('command.run', { command: 'rename' }, async ($, e, next) => {
    const result = await next(e)
    const name = e.args.trim()
    if (name) await save($, { name }).catch(err => $.ui.log(`deck: ${err}`))
    return result
  })

  on('tool.call', { tool: NAME_TOOL }, async ($, e) => {
    const { summary, ticket, title } = e as unknown as { summary: string; ticket: string; title?: string }
    pendingName = sessionName(summary, ticket, suffix)
    if (title) await storeTitles($, { [ticket.toUpperCase()]: title })

    return { result: `Renaming to "${pendingName}" once this turn ends. End the turn now; ${START_SKILL} resumes on its own.` }
  })

  on('tool.call', { tool: TITLES_TOOL }, async ($, e) => {
    const { titles: given } = e as unknown as { titles: Record<string, string> }
    const upper = Object.fromEntries(Object.entries(given).map(([key, title]) => [key.toUpperCase(), title]))
    await storeTitles($, upper)

    return { result: `Stored ${Object.keys(upper).length} ticket titles.` }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) isTurnRunning = true
    return next(e)
  })

  // Capture active tool call so the sidebar shows live activity, with conflict guarding and secret sanitization.
  on('tool.call', async ($, e, next) => {
    const call = e as { tool?: string; params?: Record<string, unknown> }
    const tool = call.tool?.replace(/^mcp__[a-zA-Z0-9_-]+__/, '') ?? ''
    if (tool && tool !== 'name_session' && tool !== 'set_ticket_titles') {
      let detail = tool
      const params = call.params
      let touchedFile: string | undefined
      if (tool === 'Bash' && typeof params?.command === 'string') {
        detail = sanitizeDetail(params.command.trim().split('\n')[0]?.slice(0, 48) || 'Bash')
      } else if ((tool === 'Read' || tool === 'View' || tool === 'Edit') && (params?.file_path || params?.path)) {
        const fullPath = String(params.file_path || params.path)
        touchedFile = fullPath
        const file = fullPath.split('/').pop()
        detail = `${tool} ${file}`
      }
      const updates: Partial<SessionFile> = { detail }
      if (touchedFile) {
        const currentId = await $.session.id()
        void checkConflicts($, currentId, touchedFile)
        const prev = (await storedRecord($))?.activeFiles ?? []
        updates.activeFiles = [touchedFile, ...prev.filter(f => f !== touchedFile)].slice(0, 10)
      }
      await save($, updates).catch(() => {})
    }
    return next(e)
  })

  // A command queued mid-turn blocks subagents and is dropped on interrupt, so the rename waits for the turn's end.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    isTurnRunning = false
    // The sidebar counts the prompt cache's lifetime from here; detail resets between turns.
    await save($, { lastTurnEndAt: Date.now(), detail: undefined })
    const name = pendingName
    if (name === undefined) return next(e)
    pendingName = undefined
    const resume = async () => {
      await rename($, name).catch(err => $.ui.log(`rename: ${err}`))
      if (!e.isAborted) await $.prompt.submit({ text: RESUME_PROMPT })
    }
    // $.command.run is refused inside a hook the turn waits on; a timer runs outside it.
    $.clock.after(0, () => void resume())

    return next(e)
  })
}
