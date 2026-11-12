import type { EngineInterface, Register } from 'claude-code'

import {
  customTitleLine,
  encodeProjectPath,
  extractTicket,
  isTicketKey,
  normalizeFolder,
  normalizeTicket,
  promptName,
  sessionName,
  ticketOf,
  ticketSuffix,
} from './group'

const NAME_TOOL = 'mcp__cockpit__name_session'
const TITLES_TOOL = 'mcp__cockpit__set_ticket_titles'
const KEEP_WARM_TOOL = 'mcp__cockpit__keep_warm'

const LEGACY_NAME_TOOL = 'mcp__deck__name_session'
const LEGACY_TITLES_TOOL = 'mcp__deck__set_ticket_titles'
const LEGACY_KEEP_WARM_TOOL = 'mcp__deck__keep_warm'

// What the Agent Cockpit VS Code sidebar lists; it reads these files, never the transcripts.
type SessionFile = {
  sessionId: string
  kind: 'bg' | 'interactive'
  cwd: string
  startedAt: number
  name?: string
  folder?: string
  ticket?: string
  prompt?: string
  lastTurnEndAt?: number
  keepWarm?: boolean
  keepWarmUntil?: number | null
  lastKeepWarmAt?: number
  contextTokens?: number
  model?: string
  isBriefing?: boolean
}

const claudeDir = async ($: EngineInterface) => `${await $.env.get('HOME')}/.claude`

const titlesFile = async ($: EngineInterface) => `${await claudeDir($)}/cockpit/ticket-titles.json`

const viewFile = async ($: EngineInterface) => `${await claudeDir($)}/cockpit/view.json`

const storedTitles = async ($: EngineInterface) =>
  JSON.parse(await $.fs.read(await titlesFile($)).catch(() => '{}')) as Record<string, string>

const storeTitles = async ($: EngineInterface, added: Record<string, string>) =>
  $.fs.write(await titlesFile($), JSON.stringify({ ...(await storedTitles($)), ...added }, null, 2))

const sessionFile = async ($: EngineInterface, sessionId: string) => `${await claudeDir($)}/cockpit/sessions/${sessionId}.json`

const legacySessionFile = async ($: EngineInterface, sessionId: string) => `${await claudeDir($)}/deck/sessions/${sessionId}.json`

const storedRecord = async ($: EngineInterface) => {
  const id = await $.session.id()
  const text = await $.fs
    .read(await sessionFile($, id))
    .catch(async () => $.fs.read(await legacySessionFile($, id)))
    .catch(() => undefined)
  if (!text) return undefined
  try {
    return JSON.parse(text) as SessionFile
  } catch {
    return undefined
  }
}

// Discover all existing folders from view.json and active/recent sessions so Claude can auto-group into them.
const listKnownFolders = async ($: EngineInterface): Promise<string[]> => {
  try {
    const view = JSON.parse(await $.fs.read(await viewFile($)).catch(() => '{}')) as { folders?: string[] }
    const folders = new Set<string>(view.folders ?? [])
    const dir = `${await claudeDir($)}/cockpit/sessions`
    const legacyDir = `${await claudeDir($)}/deck/sessions`
    for (const d of [dir, legacyDir]) {
      const entries = await $.fs.list(d).catch(() => [])
      for (const entry of entries) {
        if (entry.kind === 'file' && entry.name.endsWith('.json')) {
          const rec = JSON.parse(await $.fs.read(`${d}/${entry.name}`).catch(() => '{}')) as SessionFile
          const f = rec.folder ?? rec.ticket
          if (f) folders.add(f)
        }
      }
    }
    return [...folders]
  } catch {
    return []
  }
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const DEFAULT_KEEP_WARM_WINDOW_MS = 30 * 60_000

// Appends a custom-title entry to Claude Code's native JSONL transcript if the file exists.
const writeTranscriptTitle = async ($: EngineInterface, sessionId: string, cwd: string, title: string) => {
  try {
    const file = `${await claudeDir($)}/projects/${encodeProjectPath(cwd)}/${sessionId}.jsonl`
    const existing = await $.fs.read(file).catch(() => undefined)
    if (existing !== undefined) {
      await $.fs.write(file, existing + (existing.endsWith('\n') ? '' : '\n') + customTitleLine(sessionId, title))
    }
  } catch {}
}

// Serialized through saveQueue so concurrent tool calls cannot overwrite a name or folder written at the same time.
let saveQueue: Promise<unknown> = Promise.resolve()

const save = ($: EngineInterface, change: Partial<SessionFile>) => {
  if (!isListed) return Promise.resolve()
  const next = saveQueue.then(async () => {
    const sessionId = await $.session.id()
    const current = (await storedRecord($)) ?? { sessionId, kind, cwd: await $.session.cwd(), startedAt: Date.now() }
    const record = { ...current, ...change }
    await $.fs.write(await sessionFile($, sessionId), JSON.stringify(record, null, 2))
  })
  saveQueue = next.catch(() => {})
  return next
}

// A -p run, a script's or a child of a background job's (it inherits CLAUDE_JOB_DIR), stays off the list.
let isListed = false
let isBriefing = false
let briefingInjected = false
let kind: SessionFile['kind'] = 'interactive'
let projects: string[] = []
let suffix = ticketSuffix()
let namingInFlight = false
let turnActive = false
let keepaliveInFlight = false

const isTrivialPrompt = (text?: string): boolean => {
  if (!text) return true
  const clean = text.trim()
  return clean.length < 4 || /^(hi|hey|hello|hallo|moin|test|ok|okay|yes|ja|nein|no)\b[!?.]*$/i.test(clean)
}

const buildClassificationInstruction = (knownFolders: string[], presetFolder?: string) => {
  const folderRule = presetFolder
    ? `The session is already in folder "${presetFolder}". Keep "folder": "${presetFolder}" unless the session clearly switches to a different ticket.`
    : knownFolders.length > 0
      ? `Existing folders: ${JSON.stringify(knownFolders)}. Strongly prefer picking one of these existing folders if the session relates to it; otherwise create a concise 2-4 word topic/project folder name (e.g. "Auth Refactor", "Repo Review") or use a ticket key if mentioned (e.g. "PROJ-123", "#42").`
      : `Choose a concise 2-4 word topic/project folder name (e.g. "Auth Refactor", "Repo Review") or a ticket key if mentioned (e.g. "PROJ-123", "#42").`
  return (
    `You classify coding sessions for the Agent Cockpit sidebar. Determine the overarching goal or main objective of the entire session. ` +
    `Focus on the high-level purpose (e.g. feature being built, bug being fixed, or component being refactored). ` +
    `Do NOT name after temporary micro-steps, follow-ups, or routine actions (e.g. avoid naming after running tests, fixing a typo, inspecting files, or git commands). ` +
    `Respond with ONLY a valid JSON object (no markdown fences, no prose): ` +
    `{"summary": "<concise 3-6 word summary of the overall session goal in the user's language, without repeating folder/ticket>", "folder": "<folder name or ticket key>"}. ` +
    folderRule
  )
}

const applyClassificationReply = async ($: EngineInterface, text: string, presetFolder?: string) => {
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return false
  const parsed = JSON.parse(jsonMatch[0]) as { summary?: string; folder?: string; title?: string; skip?: boolean }
  if (parsed.skip || !parsed.summary?.trim()) return false

  const latest = await storedRecord($)
  if (latest?.name) return true

  const existingFolder = presetFolder ?? latest?.folder ?? latest?.ticket
  const rawFolder = (existingFolder ?? parsed.folder)?.trim()
  const resolvedFolder = rawFolder
    ? normalizeFolder(rawFolder, projects)
    : (ticketOf(parsed.summary, suffix) ?? latest?.folder ?? latest?.ticket)
  const name = sessionName(parsed.summary.trim(), resolvedFolder, suffix)
  await save($, { name, ...(resolvedFolder ? { folder: resolvedFolder, ticket: resolvedFolder } : {}) })
  const sessionId = await $.session.id()
  const cwd = latest?.cwd ?? (await $.session.cwd())
  await writeTranscriptTitle($, sessionId, cwd, name)
  return true
}

// Silently names and classifies the session in the background via Haiku so no tool call or system-reminder clutters the transcript.
const autoNameInBackground = async ($: EngineInterface, userPrompt: string, presetFolder?: string) => {
  if (namingInFlight) return
  const clean = userPrompt.trim()
  if (isTrivialPrompt(clean)) return
  namingInFlight = true
  try {
    const existing = await storedRecord($)
    if (existing?.name) return
    const knownFolders = await listKnownFolders($)
    const contextPrompt =
      existing?.prompt && existing.prompt !== clean && !isTrivialPrompt(existing.prompt)
        ? `Initial task prompt: ${existing.prompt}\nCurrent prompt: ${clean}`
        : clean
    const reply = await $.model.complete({
      model: 'haiku',
      effort: 'low',
      maxTokens: 160,
      timeoutMs: 8_000,
      system: buildClassificationInstruction(knownFolders, presetFolder),
      prompt: contextPrompt.slice(0, 1500),
    })
    if (reply.isAnswered) {
      await applyClassificationReply($, reply.text, presetFolder)
    }
  } catch {
    // Ignore background classification errors silently.
  } finally {
    namingInFlight = false
  }
}

const handleSessionStart = async ($: EngineInterface, e: any, next: (e: any) => Promise<unknown>) => {
  isBriefing = (await $.env.get('AGENT_COCKPIT_BRIEFING')) === '1'
  if (isBriefing) {
    isListed = false
    briefingInjected = false
    return next(e)
  }
  projects = ((await $.env.get('TICKET_PROJECTS')) ?? '')
    .split(',')
    .map(project => project.trim())
    .filter(Boolean)
  suffix = ticketSuffix(projects)
  const initialFolder = ((await $.env.get('AGENT_COCKPIT_FOLDER')) || (await $.env.get('CLAUDE_DECK_FOLDER')))?.trim()
  const knownFolders = await listKnownFolders($)
  const foldersHint =
    knownFolders.length > 0
      ? ` Existing folders: ${knownFolders.map(f => `"${f}"`).join(', ')} (always prefer assigning to an existing folder when the topic fits).`
      : ''

  await $.tool.register({
    name: 'name_session',
    description:
      `Sets or renames this session's name and moves it into a folder or ticket in the Agent Cockpit sidebar. ` +
      `Call this ONLY when the user explicitly asks to rename or move the session (e.g. "/rename", "rename this session"), or during initial task setup (e.g. /start-task). ` +
      `NEVER call this autonomously on routine turns, temporary subtasks (e.g. testing, fixing a bug, reviewing), or topic shifts.${foldersHint}`,
    inputSchema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description:
            'Concise 3-6 word summary representing the overarching goal of the entire session in the user\'s language (clean title without repeating the folder or ticket key, e.g. "Implement OAuth flow")',
        },
        folder: {
          type: 'string',
          description:
            'Folder for this session: strongly prefer an existing folder name if related, otherwise a concise new project/topic folder (2-4 words, e.g. "Auth Refactor", "Sidebar UI") or a ticket/issue key (e.g. "PROJ-123", "#42", "owner/repo#42").',
        },
        ticket: {
          type: 'string',
          description: 'Alias for folder when binding to a ticket key (e.g. PROJ-123, #42).',
        },
        title: {
          type: 'string',
          description: 'Optional short subtitle (at most 6 words) shown beside the ticket header in the sidebar (tickets only).',
        },
      },
      required: ['summary'],
    },
  })
  await $.tool.register({
    name: 'set_ticket_titles',
    description: 'Stores short subtitles for folders or tickets shown beside their headers in the Agent Cockpit sidebar.',
    inputSchema: {
      type: 'object',
      properties: {
        titles: {
          type: 'object',
          description: 'Folder name or ticket key to its short subtitle (at most 6 words), e.g. {"PROJ-1234": "Add PDF endpoint", "Auth Refactor": "OAuth2 token flow"}',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['titles'],
    },
  })
  await $.tool.register({
    name: 'keep_warm',
    description:
      'Enables or disables prompt cache keepalive for this session in Agent Cockpit. ' +
      'When enabled, Agent Cockpit periodically pings the session cache prefix before it expires so the cache stays warm while you step away or work in parallel sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'True to keep the cache warm, false to let it expire normally.',
        },
        durationMinutes: {
          type: 'number',
          description: 'Optional duration in minutes to keep warm (default: 30 minutes, max: 120 minutes).',
        },
      },
      required: ['enabled'],
    },
  })
  // A job's directory is named after its session's first id, before any /clear.
  const jobId = (await $.env.get('CLAUDE_JOB_DIR'))?.split('/').pop()
  kind = jobId !== undefined && (await $.session.id()).startsWith(jobId) ? 'bg' : 'interactive'
  isListed = kind === 'bg' || e.isInteractive
  const existing = await storedRecord($)
  const existingFolder = existing && (existing.folder !== undefined || existing.ticket !== undefined)
    ? (existing.folder ?? existing.ticket)
    : undefined
  const folder = existingFolder ?? (initialFolder ? normalizeFolder(initialFolder, projects) : undefined)
  await save($, { cwd: e.cwd, ...(folder ? { folder, ticket: folder } : {}) })

  const envTtl =
    (await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL')) ??
    ((await $.env.get('ENABLE_PROMPT_CACHING_1H')) || (await $.env.get('ENABLE_PROMPT_CACHING_1H_BEDROCK')) ? '1h' : '5m')
  const ttlMs = envTtl === '1h' ? 60 * 60_000 : 5 * 60_000
  const pingThresholdMs = ttlMs === 60 * 60_000 ? 55 * 60_000 : 4 * 60_000

  $.clock.every(30_000, async () => {
    if (!isListed || turnActive || namingInFlight || keepaliveInFlight) return
    try {
      const record = await storedRecord($)
      if (!record?.keepWarm || !record.lastTurnEndAt) return
      if (record.keepWarmUntil && Date.now() > record.keepWarmUntil) {
        await save($, { keepWarm: false, keepWarmUntil: null })
        return
      }
      const elapsed = Date.now() - record.lastTurnEndAt
      if (elapsed >= pingThresholdMs) {
        keepaliveInFlight = true
        try {
          const forked = await $.model.fork({
            effort: 'low',
            prompt: 'Keep warm',
          })
          if (forked.isAnswered) {
            const now = Date.now()
            await save($, {
              lastTurnEndAt: now,
              lastKeepWarmAt: now,
            })
          }
        } finally {
          keepaliveInFlight = false
        }
      }
    } catch {}
  })

  return next(e)
}

// The first non-empty prompt is a fallback display name; if a ticket key is mentioned in the prompt, bind immediately
// (including upgrading a generic topic folder to the specific ticket folder);
// if the session has no name yet, classify and name it silently in the background via Haiku.
const handlePromptSubmit = async ($: EngineInterface, e: any, next: (e: any) => Promise<unknown>) => {
  if (isBriefing) {
    if (!briefingInjected && !(e as { isMeta?: boolean }).isMeta) {
      const snapshot = await $.fs.read(`${await claudeDir($)}/cockpit/briefing.md`).catch(() => '')
      if (snapshot) {
        briefingInjected = true
        return next({ ...e, context: [...(e.context ?? []), snapshot] })
      }
    }
    return next(e)
  }
  turnActive = true
  const record = await storedRecord($)
  const fallback = promptName(e.text)
  const detectedTicket = extractTicket(e.text, projects)
  const currentFolder = record?.folder ?? record?.ticket
  const updates: Partial<SessionFile> = {}
  if (fallback && (!record?.prompt || isTrivialPrompt(record.prompt))) {
    updates.prompt = fallback
  }
  if (detectedTicket && !record?.name && (!currentFolder || !isTicketKey(currentFolder, projects))) {
    updates.folder = detectedTicket
    updates.ticket = detectedTicket
  }
  if (record?.keepWarm) {
    updates.keepWarmUntil = Date.now() + DEFAULT_KEEP_WARM_WINDOW_MS
  }
  if (Object.keys(updates).length > 0) {
    await save($, updates).catch(err => $.ui.log(`cockpit: ${err}`))
  }
  if (isListed && !record?.name && !(e as { isMeta?: boolean }).isMeta) {
    const activeFolder = updates.folder ?? currentFolder
    $.clock.after(10, () => autoNameInBackground($, e.text, activeFolder))
  }
  return next(e)
}

// A /rename the person types in the CLI.
const handleRenameCommand = async ($: EngineInterface, e: any, next: (e: any) => Promise<unknown>) => {
  const result = await next(e)
  const raw = e.args.trim()
  if (raw) {
    const extracted = ticketOf(raw, suffix) ?? extractTicket(raw, projects)
    const cleaned = extracted ? raw.replace(new RegExp(`^${escapeRegExp(extracted)}\\s*[:·\\-–—]?\\s*`, 'i'), '').trim() || raw : raw
    const name = sessionName(cleaned, extracted, suffix)
    await save($, { name, ...(extracted ? { folder: extracted, ticket: extracted } : {}) }).catch(err => $.ui.log(`cockpit: ${err}`))
  }
  return result
}

const handleNameTool = async ($: EngineInterface, e: unknown) => {
  const { summary, folder, ticket, title } = e as unknown as {
    summary: string
    folder?: string
    ticket?: string
    title?: string
  }
  const record = await storedRecord($)
  const rawFolder = (folder ?? ticket)?.trim()
  const resolvedFolder = rawFolder
    ? normalizeFolder(rawFolder, projects)
    : (ticketOf(summary, suffix) ?? record?.folder ?? record?.ticket)
  const name = sessionName(summary, resolvedFolder, suffix)
  await save($, { name, folder: resolvedFolder, ticket: resolvedFolder })
  if (resolvedFolder && isTicketKey(resolvedFolder, projects) && title) await storeTitles($, { [resolvedFolder]: title })
  const sessionId = await $.session.id()
  const cwd = record?.cwd ?? (await $.session.cwd())
  await writeTranscriptTitle($, sessionId, cwd, name)

  return {
    result: resolvedFolder
      ? `Named session "${name}" in folder "${resolvedFolder}". Continue with the user's request.`
      : `Named session "${name}". Continue with the user's request.`,
  }
}

const handleTitlesTool = async ($: EngineInterface, e: unknown) => {
  const { titles: given } = e as unknown as { titles: Record<string, string> }
  const normalized = Object.fromEntries(
    Object.entries(given).map(([key, title]) => [normalizeFolder(key, projects) || normalizeTicket(key), title]),
  )
  await storeTitles($, normalized)

  return { result: `Stored ${Object.keys(normalized).length} titles.` }
}

const handleKeepWarmTool = async ($: EngineInterface, e: unknown) => {
  const { enabled, durationMinutes = 30 } = e as unknown as { enabled: boolean; durationMinutes?: number }
  const durationMs = Math.max(1, Math.min(durationMinutes, 120)) * 60_000
  await save($, {
    keepWarm: Boolean(enabled),
    keepWarmUntil: enabled ? Date.now() + durationMs : null,
  })
  return {
    result: enabled
      ? `Prompt cache keepalive enabled for ${durationMinutes} minutes.`
      : `Prompt cache keepalive disabled.`,
  }
}

// Automatically detect ticket keys in ticket-intent CLI commands (e.g. acli, jira, gh issue, git checkout -b feat/PROJ-123).
const handleBashTicketDetection = async ($: EngineInterface, e: unknown, next: (e: unknown) => Promise<unknown>) => {
  if (!isListed) return next(e)
  const call = e as unknown as Record<string, unknown>
  const tool = String(call.tool ?? '').replace(/^mcp__[a-zA-Z0-9_-]+__/, '')
  const params = (call.params as Record<string, unknown> | undefined) ?? call
  if (tool === 'Bash' && typeof params?.command === 'string') {
    const cmd = params.command.trim()
    const isTicketCommand = /^\s*(acli|jira|gh\s+issue|git\s+(checkout|switch)\s+-b)\b/i.test(cmd)
    if (isTicketCommand) {
      const cmdTicket = extractTicket(cmd, projects)
      if (cmdTicket) {
        const record = await storedRecord($)
        const currentFolder = record?.folder ?? record?.ticket
        if (!record?.name && (!currentFolder || !isTicketKey(currentFolder, projects))) {
          await save($, { folder: cmdTicket, ticket: cmdTicket }).catch(() => {})
        }
      }
    }
  }
  return next(e)
}

const handleTurnComplete = async ($: EngineInterface, e: any, next: (e: any) => Promise<unknown>) => {
  turnActive = false
  if (!isListed || e.agentId !== undefined) return next(e)
  const usage = e.usage
  const contextTokens = usage
    ? (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.input_tokens ?? 0)
    : undefined
  const model = usage?.model
  const record = await storedRecord($)
  const keepWarmUpdates: Partial<SessionFile> = {}
  if (record?.keepWarm) {
    keepWarmUpdates.keepWarmUntil = Date.now() + DEFAULT_KEEP_WARM_WINDOW_MS
  }
  // The sidebar counts the prompt cache's lifetime from here.
  await save($, {
    lastTurnEndAt: Date.now(),
    ...keepWarmUpdates,
    ...(contextTokens !== undefined ? { contextTokens } : {}),
    ...(model ? { model } : {}),
  })
  // Fallback if Haiku background naming didn't run or was unavailable: fork the warm session cache invisibly.
  if (isListed && !record?.name && !namingInFlight && record?.prompt) {
    $.clock.after(10, async () => {
      if (namingInFlight) return
      namingInFlight = true
      try {
        const latest = await storedRecord($)
        if (latest?.name) return
        const knownFolders = await listKnownFolders($)
        const presetFolder = latest?.folder ?? latest?.ticket
        const forked = await $.model.fork({
          effort: 'low',
          prompt: buildClassificationInstruction(knownFolders, presetFolder),
        })
        if (forked.isAnswered) {
          await applyClassificationReply($, forked.text, presetFolder)
        }
      } catch {} finally {
        namingInFlight = false
      }
    })
  }
  return next(e)
}

export const register: Register = on => {
  on('session.start', handleSessionStart)
  on('prompt.submit', handlePromptSubmit)
  on('command.run', { command: 'rename' }, handleRenameCommand)
  on('tool.call', { tool: NAME_TOOL }, handleNameTool)
  on('tool.call', { tool: LEGACY_NAME_TOOL }, handleNameTool)
  on('tool.call', { tool: TITLES_TOOL }, handleTitlesTool)
  on('tool.call', { tool: LEGACY_TITLES_TOOL }, handleTitlesTool)
  on('tool.call', { tool: KEEP_WARM_TOOL }, handleKeepWarmTool)
  on('tool.call', { tool: LEGACY_KEEP_WARM_TOOL }, handleKeepWarmTool)
  on('tool.call', handleBashTicketDetection)
  on('turn.complete', handleTurnComplete)
}