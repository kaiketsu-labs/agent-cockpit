// A session belongs to the ticket its name ends with, "<summary> (PROJ-123)"; TICKET_PROJECTS narrows the keys.
export const ticketSuffix = (projects: readonly string[] = []): RegExp => {
  const key = projects.length > 0 ? `(?:${projects.join('|')})-\\d+` : '[A-Z][A-Z0-9]+-\\d+'
  return new RegExp(`\\s*\\((${key})\\)\\s*$`, projects.length > 0 ? 'i' : '')
}

export const ticketPattern = (projects: readonly string[] = []): RegExp => {
  const key = projects.length > 0 ? `(?:${projects.join('|')})-\\d+` : '[A-Z][A-Z0-9]+-\\d+'
  return new RegExp(`\\b(${key})\\b`, projects.length > 0 ? 'i' : '')
}

export const extractTicket = (text: string, projects: readonly string[] = []): string | undefined => {
  const match = text.match(ticketPattern(projects))
  return match ? match[1].toUpperCase() : undefined
}

export const sessionName = (summary: string, ticket: string, suffix: RegExp) =>
  `${summary.replace(suffix, '').trim()} (${ticket.toUpperCase()})`

// The first prompt names a session until it gets a name of its own.
export const promptName = (text: string) => text.trim().split('\n')[0]?.slice(0, 80) ?? ''

// Prevent credentials or bearer tokens from appearing in tool detail lines or session files.
export const sanitizeDetail = (text: string): string =>
  text
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1***')
    .replace(/(token|secret|password|api[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9._~+/-]+['"]?/gi, '$1=***')
