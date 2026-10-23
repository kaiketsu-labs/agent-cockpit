import { expect, test } from 'claude-code/testing'

import { promptName, sessionName, ticketSuffix } from './group'

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
