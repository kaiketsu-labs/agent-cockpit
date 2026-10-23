// A session belongs to the ticket its name ends with, "<summary> (PROJ-123)"; TICKET_PROJECTS narrows the keys.
export const ticketSuffix = (projects: readonly string[] = []): RegExp => {
  const key = projects.length > 0 ? `(?:${projects.join('|')})-\\d+` : '[A-Z][A-Z0-9]+-\\d+'
  return new RegExp(`\\s*\\((${key})\\)\\s*$`, projects.length > 0 ? 'i' : '')
}

export const sessionName = (summary: string, ticket: string, suffix: RegExp) =>
  `${summary.replace(suffix, '').trim()} (${ticket.toUpperCase()})`

// The first prompt names a session until it gets a name of its own.
export const promptName = (text: string) => text.trim().split('\n')[0]?.slice(0, 80) ?? ''
