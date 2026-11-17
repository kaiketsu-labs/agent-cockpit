import { expect, test } from 'bun:test'

import {
  buildClassificationInstruction,
  cleanTranscriptPrompt,
  customTitleLine,
  encodeProjectPath,
  extractTicket,
  extractTranscriptContext,
  isTicketKey,
  normalizeFolder,
  normalizeTicket,
  parseClassificationReply,
  promptName,
  sessionName,
  shortCwd,
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

test('extractTranscriptContext extracts full session turns and modified files', () => {
  const jsonl = [
    JSON.stringify({ type: 'user', message: { content: 'Implement dark mode toggle' } }),
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Added theme context.' },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/app/src/theme.tsx' } },
        ],
      },
    }),
    JSON.stringify({ type: 'user', message: { content: 'Persist choice in localStorage' } }),
  ].join('\n')
  const context = extractTranscriptContext(jsonl, '/app', 12_000)
  expect(context).toContain('Modified files: src/theme.tsx')
  expect(context).toContain('User: Implement dark mode toggle')
  expect(context).toContain('Assistant: Added theme context.')
  expect(context).toContain('User: Persist choice in localStorage')
  expect(cleanTranscriptPrompt('<command-name>/retitle</command-name>')).toBe('/retitle')

  // Tight maxChars budget where head + tail exceeds maxChars still preserves both initial and latest turns
  const manyRows: string[] = []
  for (let i = 1; i <= 10; i++) {
    manyRows.push(JSON.stringify({ type: 'user', message: { content: `Turn ${i}: implement feature step ${i} with details` } }))
    manyRows.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `Completed step ${i} of the refactor.` }] } }))
  }
  const tight = extractTranscriptContext(manyRows.join('\n'), '/app', 220)
  expect(tight.length).toBeLessThanOrEqual(220)
  expect(tight).toContain('Turn 1:')
  expect(tight).toContain('Turn 10:')
})

test('buildClassificationInstruction and parseClassificationReply handle retitle options', () => {
  const instruction = buildClassificationInstruction(['UI Polish'], {
    presetFolder: 'UI Polish',
    currentName: 'Dark mode',
    isRetitle: true,
  })
  expect(instruction).toContain('ENTIRE conversation history')
  expect(instruction).toContain('Current session name: "Dark mode"')
  expect(parseClassificationReply('{"summary": "Add persistent dark mode", "folder": "UI Polish"}')).toEqual({
    summary: 'Add persistent dark mode',
    folder: 'UI Polish',
    title: undefined,
  })
})

test('shortCwd extracts last directory segment or worktree name', () => {
  expect(shortCwd('/Users/david/Developer/agent-cockpit')).toBe('agent-cockpit')
  expect(shortCwd('/Users/david/Developer/agent-cockpit/')).toBe('agent-cockpit')
  expect(shortCwd('/repo/.claude/worktrees/feat-ux')).toBe('feat-ux')
  expect(shortCwd('C:\\Users\\david\\Developer\\agent-cockpit')).toBe('agent-cockpit')
  expect(shortCwd('C:\\repo\\.claude\\worktrees\\PROJ-123')).toBe('PROJ-123')
  expect(shortCwd('')).toBeUndefined()
  expect(shortCwd(undefined)).toBeUndefined()
  expect(shortCwd('/')).toBeUndefined()
})
