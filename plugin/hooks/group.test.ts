import { expect, test } from 'bun:test'

import { normalizeTicket, promptName, sessionName, ticketOf, ticketSuffix } from './group'

const proj = ticketSuffix(['PROJ'])
const anyKey = ticketSuffix()

test('session names carry the ticket as suffix when given, or stand alone when unticketed', async () => {
  expect(sessionName('Check null values', 'proj-57', proj)).toBe('Check null values (PROJ-57)')
  expect(sessionName('Retry (PROJ-1)', 'PROJ-2', proj)).toBe('Retry (PROJ-2)')
  expect(sessionName('Retry (OPS-1)', 'PROJ-2', proj)).toBe('Retry (OPS-1) (PROJ-2)')
  expect(sessionName('Retry (OPS-1)', 'PROJ-2', anyKey)).toBe('Retry (PROJ-2)')
  expect(sessionName('Fix login redirect', '#42', anyKey)).toBe('Fix login redirect (#42)')
  expect(sessionName('Fix login (#41)', 'org/repo#42', anyKey)).toBe('Fix login (org/repo#42)')
  expect(sessionName('Explore auth flow', undefined, anyKey)).toBe('Explore auth flow')
  expect(sessionName('Explore auth flow (PROJ-1)', '', anyKey)).toBe('Explore auth flow')
})

test('ticketOf extracts normalized ticket from suffix', async () => {
  expect(ticketOf('Check null values (proj-57)', proj)).toBe('PROJ-57')
  expect(ticketOf('Fix login (#42)', anyKey)).toBe('#42')
  expect(ticketOf('Fix login (Org/Repo#42)', anyKey)).toBe('Org/Repo#42')
  expect(ticketOf('Unticketed session', anyKey)).toBeUndefined()
})

test('normalizeTicket uppercases Jira keys and preserves GitHub issue case', async () => {
  expect(normalizeTicket('proj-57')).toBe('PROJ-57')
  expect(normalizeTicket('#42')).toBe('#42')
  expect(normalizeTicket('Org/Repo#42')).toBe('Org/Repo#42')
})

test('a prompt names a session by its first non-empty content line, stripping bare slash commands and cutting to 80 characters', async () => {
  expect(promptName('  fix the nulls\nand more')).toBe('fix the nulls')
  expect(promptName('\n\n  explore auth flow\nmore')).toBe('explore auth flow')
  expect(promptName('/start-task')).toBe('')
  expect(promptName('/start-task explore auth flow')).toBe('explore auth flow')
  expect(promptName('x'.repeat(100))).toHaveLength(80)
})
