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
