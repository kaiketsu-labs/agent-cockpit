// A session belongs to a folder (either a free-form project/topic folder like "Auth Refactor"
// or a ticket key like "PROJ-123", "#42", or "owner/repo#42").
const DEFAULT_KEY = '(?:[A-Z][A-Z0-9]+-\\d+|(?:[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+)?#\\d+)'

export const ticketSuffix = (projects: readonly string[] = []): RegExp => {
  const key = projects.length > 0 ? `(?:${projects.join('|')})-\\d+` : DEFAULT_KEY
  return new RegExp(`\\s*\\((${key})\\)\\s*$`, projects.length > 0 ? 'i' : '')
}

export const ticketKeyRegex = (projects: readonly string[] = []): RegExp => {
  const key = projects.length > 0 ? `(?:${projects.join('|')})-\\d+` : DEFAULT_KEY
  return new RegExp(`^${key}$`, projects.length > 0 ? 'i' : '')
}

export const ticketSearchRegex = (projects: readonly string[] = []): RegExp => {
  if (projects.length > 0) {
    const key = `(?:${projects.join('|')})-\\d+`
    return new RegExp(`\\b${key}\\b`, 'i')
  }
  const key = '(?:\\b[A-Z][A-Z0-9]+-\\d+\\b|\\b[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+#\\d+\\b|(?<![A-Za-z0-9_.-])#\\d+\\b)'
  return new RegExp(key)
}

export const isTicketKey = (folder: string, projects: readonly string[] = []): boolean =>
  ticketKeyRegex(projects).test(folder.trim())

export const normalizeTicket = (ticket: string): string => {
  const trimmed = ticket.trim()
  return trimmed.includes('#') ? trimmed : trimmed.toUpperCase()
}

export const extractTicket = (text: string, projects: readonly string[] = []): string | undefined => {
  const match = text.match(ticketSearchRegex(projects))?.[0]
  return match ? normalizeTicket(match) : undefined
}

export const normalizeFolder = (folder: string, projects: readonly string[] = []): string => {
  const trimmed = folder.trim()
  if (!trimmed) return ''
  return isTicketKey(trimmed, projects) ? normalizeTicket(trimmed) : trimmed
}

export const ticketOf = (name: string, suffix: RegExp): string | undefined => {
  const match = name.match(suffix)?.[1]
  return match ? normalizeTicket(match) : undefined
}

export const withoutTicketSuffix = (name: string, suffix: RegExp): string => name.replace(suffix, '').trim()

// Session names stay clean without forcing a "(KEY)" suffix. Any trailing "(KEY)" is stripped.
export const sessionName = (summary: string, _folder?: string, suffix: RegExp = ticketSuffix()): string =>
  withoutTicketSuffix(summary, suffix)

// Encodes an absolute working directory path the way Claude Code names directories under ~/.claude/projects/.
export const encodeProjectPath = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9-]/g, '-')

// Builds a single JSONL line that sets a session's custom title in ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl.
export const customTitleLine = (sessionId: string, customTitle: string): string =>
  `${JSON.stringify({ type: 'custom-title', customTitle, sessionId })}\n`

export const cleanTranscriptPrompt = (raw: string): string => {
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

export const clipText = (text: string, maxLen: number): string => {
  if (!text || text.length <= maxLen) return text
  const cut = text.slice(0, maxLen)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > maxLen * 0.75 ? cut.slice(0, lastSpace) : cut) + '…'
}

const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const relativeSessionPath = (filePath: string, cwd?: string): string => {
  if (!cwd) return filePath
  const normCwd = cwd.replace(/[/\\]+$/, '')
  if (normCwd && (filePath.startsWith(`${normCwd}/`) || filePath.startsWith(`${normCwd}\\`))) {
    return filePath.slice(normCwd.length).replace(/^[/\\]+/, '')
  }
  return filePath
}

const fitContextLines = (lines: string[], budget: number, fromEnd = false): string[] => {
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

// Extracts chronological user/assistant turns and modified files across the entire session JSONL transcript.
export const extractTranscriptContext = (jsonl: string, cwd?: string, maxChars = 12_000): string => {
  if (!jsonl || maxChars <= 0) return ''
  const entries: Array<{ role: 'User' | 'Assistant'; text: string }> = []
  const modifiedFiles = new Set<string>()

  for (const line of jsonl.split('\n')) {
    if (!line) continue
    if (!line.includes('"user"') && !line.includes('"assistant"')) continue
    let row: any
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (!row || row.isSidechain || row.isMeta) continue
    if (row.type === 'user') {
      const content = row.message?.content
      if (Array.isArray(content) && content.some((b: any) => b?.type === 'tool_result')) continue
      const raw =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .filter((b: any) => b?.type === 'text')
                .map((b: any) => b.text)
                .join(' ')
            : ''
      const cleaned = cleanTranscriptPrompt(raw)
      if (cleaned && !/^\/retitle\b/i.test(cleaned)) {
        entries.push({ role: 'User', text: clipText(cleaned, 500) })
      }
    } else if (row.type === 'assistant' && Array.isArray(row.message?.content)) {
      const texts: string[] = []
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
  const sampledMiddle: string[] = []
  if (middle.length > 0 && budget > 80) {
    // Spread samples evenly across the entire middle span so no phase of the session is blind.
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

export type ClassificationOptions = {
  presetFolder?: string
  currentName?: string
  hint?: string
  isRetitle?: boolean
}

export const buildClassificationInstruction = (knownFolders: string[], options: ClassificationOptions = {}): string => {
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

export type ClassificationReply = {
  summary: string
  folder?: string
  title?: string
}

export const parseClassificationReply = (text: string): ClassificationReply | undefined => {
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return undefined
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { summary?: string; folder?: string; title?: string; skip?: boolean }
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

// The first non-empty, non-command prompt line names a session until it gets a name of its own.
export const promptName = (text: string): string => {
  const line =
    text
      .split('\n')
      .map(l => l.trim())
      .find(Boolean) ?? ''
  if (!line) return ''
  // Strip a leading slash command if followed by arguments, or ignore bare slash commands like "/start-task"
  if (line.startsWith('/')) {
    const rest = line.replace(/^\/[a-zA-Z0-9_:-]+\s*/, '').trim()
    return rest.slice(0, 80)
  }
  return line.slice(0, 80)
}
