'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  ticketPattern,
  firstTicket,
  withoutTicketSuffix,
  assignTicket,
  groupSessions,
  moveBefore,
  searchQueries,
  prsByTicket,
  isClosed,
  isHidden,
  ticketOf,
  mergeSessions,
  interactiveState,
  ancestorPids,
  cacheTtlMs,
  cacheLeft,
  clock,
} = require('./group')

const anyKey = ticketPattern()
const proj = ticketPattern(['PROJ'])

test('without projects any upper-case Jira key or GitHub issue ref counts', () => {
  assert.equal(firstTicket([undefined, 'fix nulls (PROJ-57)', 'OPS-1'], anyKey), 'PROJ-57')
  assert.equal(firstTicket(['lower proj-57 is no key'], anyKey), undefined)
  assert.equal(firstTicket(['fix login redirect #42'], anyKey), '#42')
  assert.equal(firstTicket(['fix org/repo#19 in auth'], anyKey), 'org/repo#19')
  assert.equal(withoutTicketSuffix('Fix login (#42)', anyKey), 'Fix login')
  assert.equal(withoutTicketSuffix('Fix login (org/repo#19)', anyKey), 'Fix login')
})

test('with projects only their keys count, any case', () => {
  assert.equal(firstTicket(['OPS-1 then proj-57'], proj), 'PROJ-57')
  assert.equal(withoutTicketSuffix('Check nulls (PROJ-57)', proj), 'Check nulls')
})

test('assignTicket binds a session name to a new ticket or strips its ticket when unassigned', () => {
  assert.equal(assignTicket('Explore auth flow', 'proj-42', proj), 'Explore auth flow (PROJ-42)')
  assert.equal(assignTicket('Explore auth flow (PROJ-1)', 'PROJ-2', proj), 'Explore auth flow (PROJ-2)')
  assert.equal(assignTicket('Explore auth flow (#10)', 'org/repo#12', anyKey), 'Explore auth flow (org/repo#12)')
  assert.equal(assignTicket('Explore auth flow (PROJ-1)', undefined, anyKey), 'Explore auth flow')
})

test('groups sort tickets and sessions alphabetically, unticketed last, whatever their status', () => {
  const groups = groupSessions([
    { id: 'a', name: 'zeta', state: 'working' },
    { id: 'b', name: 'beta', state: 'done', ticket: 'PROJ-10' },
    { id: 'c', name: 'Charlie', state: 'working', ticket: 'PROJ-9' },
    { id: 'd', name: 'alpha', state: 'done', ticket: 'PROJ-9' },
    { id: 'e', name: 'bravo', state: 'blocked', ticket: 'PROJ-9' },
  ])
  assert.deepEqual(groups.map(g => g.ticket), ['PROJ-9', 'PROJ-10', null])
  assert.deepEqual(groups[0].sessions.map(s => s.id), ['d', 'e', 'c'])
  assert.deepEqual(groups[0].counts.map(c => c.label), ['needs input', 'working', 'done'])
})

test('a manual order wins over the alphabet, unordered items follow alphabetically', () => {
  const sessions = [
    { id: 'a', name: 'alpha', ticket: 'PROJ-1' },
    { id: 'b', name: 'beta', ticket: 'PROJ-1' },
    { id: 'c', name: 'gamma', ticket: 'PROJ-1' },
    { id: 'd', name: 'delta', ticket: 'PROJ-2' },
  ]
  const groups = groupSessions(sessions, ['PROJ-2', 'c', 'a'])
  assert.deepEqual(groups.map(g => g.ticket), ['PROJ-2', 'PROJ-1'])
  assert.deepEqual(groups[1].sessions.map(s => s.id), ['c', 'a', 'b'])
})

test('moving an item places it before its target, or last without one, and keeps other lists', () => {
  assert.deepEqual(moveBefore(['x'], ['a', 'b', 'c'], 'c', 'a'), ['x', 'c', 'a', 'b'])
  assert.deepEqual(moveBefore([], ['a', 'b', 'c'], 'a'), ['b', 'c', 'a'])
  assert.deepEqual(moveBefore(['b', 'x', 'a'], ['a', 'b'], 'a', 'b'), ['x', 'a', 'b'])
  assert.deepEqual(moveBefore(['x'], ['a', 'b'], 'a', 'z'), ['x'])
})

test('PR searches batch six keys and match PRs to every key their title names', () => {
  const keys = ['PROJ-1', 'PROJ-2', 'PROJ-3', 'PROJ-4', 'PROJ-5', 'PROJ-6', 'PROJ-7']
  assert.deepEqual(searchQueries(keys), [
    'is:pr is:open in:title PROJ-1 OR PROJ-2 OR PROJ-3 OR PROJ-4 OR PROJ-5 OR PROJ-6',
    'is:pr is:open in:title PROJ-7',
  ])
  const pr = { number: 9, title: 'feat(proj-1): x, PROJ-2, not PROJ-20, fixes #42', body: 'PROJ-3', html_url: 'u', repository_url: 'api/repos/org/api', draft: true }
  const byTicket = prsByTicket([pr], ['PROJ-1', 'PROJ-2', 'PROJ-3', '#42', '#4'])
  assert.deepEqual(Object.keys(byTicket), ['PROJ-1', 'PROJ-2', '#42'])
  assert.deepEqual(byTicket['PROJ-1'][0], { repo: 'api', number: 9, title: 'feat(proj-1): x, PROJ-2, not PROJ-20, fixes #42', url: 'u', isDraft: true })
})

test('only a ticket the tracker calls done is closed', () => {
  assert.equal(isClosed({ category: 'done' }), true)
  assert.equal(isClosed({ category: 'indeterminate' }), false)
  assert.equal(isClosed(undefined), false)
})

test('a week without a turn or a closed ticket hides a session, a hand-set flag wins, work never hides', () => {
  const day = 24 * 60 * 60 * 1000
  const idle = { state: 'idle', updatedAt: 0 }
  assert.equal(isHidden(idle, 7 * day, false), false)
  assert.equal(isHidden(idle, 7 * day + 1, false), true)
  assert.equal(isHidden(idle, 0, true), true)
  assert.equal(isHidden(idle, 10 * day, true, false), false)
  assert.equal(isHidden(idle, 0, false, true), true)
  assert.equal(isHidden({ state: 'working', updatedAt: 0 }, 10 * day, true, true), false)
  assert.equal(isHidden({ state: 'blocked', updatedAt: 0 }, 10 * day, false), true)
})

test('only a ticket suffix binds a session to a ticket', () => {
  assert.equal(ticketOf('Check nulls (proj-57)', proj), 'PROJ-57')
  assert.equal(ticketOf('compare with PROJ-1 approach', proj), undefined)
  assert.equal(ticketOf('Retry (OPS-1)', proj), undefined)
  assert.equal(ticketOf('Fix login (#42)', anyKey), '#42')
  assert.equal(ticketOf('Fix login (org/repo#42)', anyKey), 'org/repo#42')
})

test('sessions merge claude agents with the plugin files, keep ended interactive ones, drop deleted bg ones, and honor explicit file.ticket or worktree path', () => {
  const agents = [
    { id: 'job1', sessionId: 's1', name: 'bg job (PROJ-1)', state: 'working', startedAt: 1 },
    { sessionId: 's2', pid: 42, name: 'my-project', status: 'waiting', startedAt: 2, cwd: '/repo' },
    { sessionId: 's6', pid: 43, name: 'worktree-session', status: 'idle', startedAt: 6, cwd: '/repo/.claude/worktrees/PROJ-77-auth-fix' },
  ]
  const files = [
    { sessionId: 's1', kind: 'bg', cwd: '/repo', startedAt: 1, lastTurnEndAt: 10 },
    { sessionId: 's2', kind: 'interactive', cwd: '/repo', startedAt: 2, prompt: 'fix the nulls', ticket: 'proj-99' },
    { sessionId: 's3', kind: 'interactive', cwd: '/old', startedAt: 3, prompt: 'p', name: 'Old work (PROJ-2)', lastTurnEndAt: 30 },
    { sessionId: 's4', kind: 'bg', cwd: '/repo', startedAt: 4, name: 'deleted job' },
    { sessionId: 's5', kind: 'interactive', cwd: '/repo', startedAt: 5 },
  ]
  const sessions = mergeSessions(agents, files, proj)
  assert.deepEqual(
    sessions.map(({ id, name, state, ticket, updatedAt }) => ({ id, name, state, ticket, updatedAt })),
    [
      { id: 'job1', name: 'bg job (PROJ-1)', state: 'working', ticket: 'PROJ-1', updatedAt: 10 },
      { id: 's2', name: 'fix the nulls', state: 'blocked', ticket: 'PROJ-99', updatedAt: 2 },
      { id: 's6', name: 'worktree-session', state: 'idle', ticket: 'PROJ-77', updatedAt: 6 },
      { id: 's3', name: 'Old work (PROJ-2)', state: 'done', ticket: 'PROJ-2', updatedAt: 30 },
    ],
  )
  assert.equal(sessions[3].ended, true)
  assert.equal(sessions[1].pid, 42)
})

test('interactive sessions map waiting to blocked, busy to working, anything else to idle', () => {
  assert.equal(interactiveState('waiting'), 'blocked')
  assert.equal(interactiveState('busy'), 'working')
  assert.equal(interactiveState('idle'), 'idle')
})

test('ancestor pids follow /proc parent links up to init', () => {
  const stats = { 30: '30 (claude) S 20 1', 20: '20 (ba sh) S 10 1', 10: '10 (node) S 1 1' }
  assert.deepEqual(ancestorPids(30, pid => stats[pid]), [30, 20, 10])
})

test('the prompt cache lives five minutes unless set to an hour', () => {
  assert.equal(cacheTtlMs({}), 5 * 60_000)
  assert.equal(cacheTtlMs({ ENABLE_PROMPT_CACHING_1H_BEDROCK: '1' }), 60 * 60_000)
  assert.equal(cacheTtlMs({ ENABLE_PROMPT_CACHING_1H: '1', CLAUDE_CODE_PROMPT_CACHE_TTL: '5m' }), 5 * 60_000)
})

test('the cache countdown runs from the last transcript write and stops at zero', () => {
  assert.equal(cacheLeft(1_000, 300_000, 61_000), 240_000)
  assert.equal(cacheLeft(0, 300_000, 400_000), 0)
  assert.equal(clock(240_000), '4:00')
  assert.equal(clock(65_400), '1:06')
})
