import { expect, test } from 'bun:test'

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
  withoutTicketSuffix,
} from './group'
import { register } from './register'

const proj = ticketSuffix(['PROJ'])
const anyKey = ticketSuffix()

test('sessionName keeps clean names without forcing a ticket suffix and strips any legacy suffix', () => {
  expect(sessionName('Check null values', 'proj-57', proj)).toBe('Check null values')
  expect(sessionName('Retry (PROJ-1)', 'PROJ-2', proj)).toBe('Retry')
  expect(sessionName('Fix login redirect (#42)', '#42', anyKey)).toBe('Fix login redirect')
  expect(sessionName('Explore auth flow', 'Auth Refactor', anyKey)).toBe('Explore auth flow')
  expect(withoutTicketSuffix('Check null values (PROJ-57)', anyKey)).toBe('Check null values')
})

test('ticketOf extracts normalized ticket from legacy suffix', () => {
  expect(ticketOf('Check null values (proj-57)', proj)).toBe('PROJ-57')
  expect(ticketOf('Fix login (#42)', anyKey)).toBe('#42')
  expect(ticketOf('Fix login (Org/Repo#42)', anyKey)).toBe('Org/Repo#42')
  expect(ticketOf('Unticketed session', anyKey)).toBeUndefined()
})

test('extractTicket detects Jira and GitHub issue keys in free-form prompt text', () => {
  expect(extractTicket('Please look at PROJ-142 and fix the bug')).toBe('PROJ-142')
  expect(extractTicket('look at proj-142', ['PROJ'])).toBe('PROJ-142')
  expect(extractTicket('fix issue #42 in auth')).toBe('#42')
  expect(extractTicket('see owner/repo#99')).toBe('owner/repo#99')
  expect(extractTicket('just refactor the auth module')).toBeUndefined()
})

test('normalizeFolder uppercases ticket keys and preserves free-form topic folder names', () => {
  expect(isTicketKey('proj-57', ['PROJ'])).toBe(true)
  expect(isTicketKey('PROJ-57')).toBe(true)
  expect(isTicketKey('#42')).toBe(true)
  expect(isTicketKey('Org/Repo#42')).toBe(true)
  expect(isTicketKey('Auth Refactor')).toBe(false)
  expect(normalizeFolder('proj-57', ['PROJ'])).toBe('PROJ-57')
  expect(normalizeFolder('PROJ-57')).toBe('PROJ-57')
  expect(normalizeFolder('#42')).toBe('#42')
  expect(normalizeFolder('Org/Repo#42')).toBe('Org/Repo#42')
  expect(normalizeFolder('  Auth Refactor  ')).toBe('Auth Refactor')
  expect(normalizeTicket('proj-57')).toBe('PROJ-57')
})

test('encodeProjectPath and customTitleLine match Claude Code transcript storage', () => {
  expect(encodeProjectPath('/Users/david/Developer/agent-cockpit')).toBe('-Users-david-Developer-agent-cockpit')
  expect(customTitleLine('s-1', 'Auth Refactor')).toBe('{"type":"custom-title","customTitle":"Auth Refactor","sessionId":"s-1"}\n')
})

test('a prompt names a session by its first non-empty content line, stripping bare slash commands and cutting to 80 characters', () => {
  expect(promptName('  fix the nulls\nand more')).toBe('fix the nulls')
  expect(promptName('\n\n  explore auth flow\nmore')).toBe('explore auth flow')
  expect(promptName('/start-task')).toBe('')
  expect(promptName('/start-task explore auth flow')).toBe('explore auth flow')
  expect(promptName('x'.repeat(100))).toHaveLength(80)
})

test('register.tsx parses cleanly and exports register hook entrypoint', () => {
  expect(typeof register).toBe('function')
})
