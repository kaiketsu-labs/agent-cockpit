import { expect, test } from 'claude-code/testing'

import { extractTicket, promptName, sanitizeDetail, sessionName, ticketSuffix } from './group'

const proj = ticketSuffix(['PROJ'])

test('session names carry the ticket as suffix, once', async () => {
  expect(sessionName('Check null values', 'proj-57', proj)).toBe('Check null values (PROJ-57)')
  expect(sessionName('Retry (PROJ-1)', 'PROJ-2', proj)).toBe('Retry (PROJ-2)')
  expect(sessionName('Retry (OPS-1)', 'PROJ-2', proj)).toBe('Retry (OPS-1) (PROJ-2)')
  expect(sessionName('Retry (OPS-1)', 'PROJ-2', ticketSuffix())).toBe('Retry (PROJ-2)')
})

test('a prompt names a session by its first line, cut to 80 characters', async () => {
  expect(promptName('  fix the nulls\nand more')).toBe('fix the nulls')
  expect(promptName('x'.repeat(100))).toHaveLength(80)
})

test('extracts first ticket key from anywhere in text', async () => {
  expect(extractTicket('fix issue in PROJ-142 please', ['PROJ'])).toBe('PROJ-142')
  expect(extractTicket('investigate proj-88 bug', ['PROJ'])).toBe('PROJ-88')
  expect(extractTicket('random text with no ticket', ['PROJ'])).toBeUndefined()
  expect(extractTicket('check OTHER-99 with generic projects')).toBe('OTHER-99')
})

test('sanitizes secrets and bearer tokens from detail strings', async () => {
  expect(sanitizeDetail('curl -H "Authorization: Bearer secret_token_xyz"')).toBe('curl -H "Authorization: Bearer ***"')
  expect(sanitizeDetail('export JIRA_TOKEN=my_secret_token')).toBe('export JIRA_TOKEN=***')
  expect(sanitizeDetail('npm test')).toBe('npm test')
})
