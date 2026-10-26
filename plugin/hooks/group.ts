// A session belongs to the ticket in its SessionFile or its "<summary> (KEY)" suffix.
// Supports Jira/Linear keys (PROJ-123) and GitHub/GitLab issue refs (#42, owner/repo#42); TICKET_PROJECTS narrows Jira keys.
const DEFAULT_KEY = '(?:[A-Z][A-Z0-9]+-\\d+|(?:[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+)?#\\d+)'

export const ticketSuffix = (projects: readonly string[] = []): RegExp => {
  const key = projects.length > 0 ? `(?:${projects.join('|')})-\\d+` : DEFAULT_KEY
  return new RegExp(`\\s*\\((${key})\\)\\s*$`, projects.length > 0 ? 'i' : '')
}

export const normalizeTicket = (ticket: string): string => {
  const trimmed = ticket.trim()
  return trimmed.includes('#') ? trimmed : trimmed.toUpperCase()
}

export const ticketOf = (name: string, suffix: RegExp): string | undefined => {
  const match = name.match(suffix)?.[1]
  return match ? normalizeTicket(match) : undefined
}

export const sessionName = (summary: string, ticket: string | undefined, suffix: RegExp) => {
  const base = summary.replace(suffix, '').trim()
  const key = ticket ? normalizeTicket(ticket) : ''
  return key ? `${base} (${key})` : base
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
