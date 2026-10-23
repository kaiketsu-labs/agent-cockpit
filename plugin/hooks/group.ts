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

export const sessionName = (summary: string, ticket: string, suffix: RegExp) =>
  `${summary.replace(suffix, '').trim()} (${normalizeTicket(ticket)})`

// The first prompt names a session until it gets a name of its own.
export const promptName = (text: string) => text.trim().split('\n')[0]?.slice(0, 80) ?? ''
