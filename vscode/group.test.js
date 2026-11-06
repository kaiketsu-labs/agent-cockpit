'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  ticketPattern,
  firstTicket,
  isTicketKey,
  folderTicket,
  normalizeFolder,
  withoutTicketSuffix,
  assignTicket,
  encodeProjectPath,
  customTitleLine,
  groupSessions,
  moveBefore,
  parseGithubRemote,
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
  inboxModel,
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

test('normalizeFolder and folderTicket distinguish free-form topic folders from ticket folders', () => {
  assert.equal(isTicketKey('PROJ-42', proj), true)
  assert.equal(isTicketKey('Auth Refactor', proj), false)
  assert.equal(normalizeFolder('proj-42', proj), 'PROJ-42')
  assert.equal(normalizeFolder('  Auth Refactor  ', proj), 'Auth Refactor')
  assert.equal(folderTicket('PROJ-42', proj), 'PROJ-42')
  assert.equal(folderTicket('PROJ-42 PDF Export', proj), 'PROJ-42')
  assert.equal(folderTicket('Auth Refactor', proj), undefined)
  assert.equal(assignTicket('Explore auth flow (PROJ-1)', 'PROJ-2', proj), 'Explore auth flow')
})

test('encodeProjectPath and customTitleLine match Claude Code JSONL format', () => {
  assert.equal(encodeProjectPath('/Users/david/Developer/agent-cockpit'), '-Users-david-Developer-agent-cockpit')
  assert.equal(customTitleLine('s1', 'Clean title'), '{"type":"custom-title","customTitle":"Clean title","sessionId":"s1"}\n')
})

test('groups sort folders/tickets and sessions alphabetically, including empty folders, and put ungrouped last', () => {
  const groups = groupSessions(
    [
      { id: 'a', name: 'zeta', state: 'working' },
      { id: 'b', name: 'beta', state: 'done', folder: 'PROJ-10' },
      { id: 'c', name: 'Charlie', state: 'working', folder: 'Auth Refactor' },
      { id: 'd', name: 'alpha', state: 'done', folder: 'Auth Refactor' },
      { id: 'e', name: 'bravo', state: 'blocked', folder: 'Auth Refactor' },
    ],
    [],
    { folders: ['Empty Folder'] },
  )
  assert.deepEqual(groups.map(g => g.ticket), ['Auth Refactor', 'Empty Folder', 'PROJ-10', null])
  assert.deepEqual(groups[0].sessions.map(s => s.id), ['d', 'e', 'c'])
  assert.deepEqual(groups[0].counts.map(c => c.label), ['needs input', 'working', 'done'])
  assert.deepEqual(groups[1].sessions, [])
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

test('unticketed sessions can be ordered by age (most recent first) when requested', () => {
  const sessions = [
    { id: 's1', name: 'old session', updatedAt: 1000 },
    { id: 's2', name: 'newest session', updatedAt: 5000 },
    { id: 's3', name: 'middle session', updatedAt: 3000 },
    { id: 's4', name: 'tied alpha', updatedAt: 2000 },
    { id: 's5', name: 'tied beta', updatedAt: 2000 },
    { id: 't1', name: 'ticket session', ticket: 'PROJ-1', updatedAt: 1000 },
  ]
  const groups = groupSessions(sessions, [], { unticketedSort: 'age' })
  const unticketed = groups.find(g => g.ticket === null)
  assert.deepEqual(unticketed.sessions.map(s => s.id), ['s2', 's3', 's4', 's5', 's1'])

  // Also supports passing options as the second argument without explicit order
  const optionsDirect = groupSessions(sessions, { unticketedSort: 'age' })
  assert.deepEqual(optionsDirect.find(g => g.ticket === null).sessions.map(s => s.id), ['s2', 's3', 's4', 's5', 's1'])

  // Default sort remains alphabetical
  const defaultGroups = groupSessions(sessions)
  assert.deepEqual(defaultGroups.find(g => g.ticket === null).sessions.map(s => s.id), ['s3', 's2', 's1', 's4', 's5'])
})

test('moving an item places it before its target, or last without one, and keeps other lists', () => {
  assert.deepEqual(moveBefore(['x'], ['a', 'b', 'c'], 'c', 'a'), ['x', 'c', 'a', 'b'])
  assert.deepEqual(moveBefore([], ['a', 'b', 'c'], 'a'), ['b', 'c', 'a'])
  assert.deepEqual(moveBefore(['b', 'x', 'a'], ['a', 'b'], 'a', 'b'), ['x', 'a', 'b'])
  assert.deepEqual(moveBefore(['x'], ['a', 'b'], 'a', 'z'), ['x'])
})

test('drag and drop reordered sessions maintain their manual order regardless of subsequent name changes', () => {
  const sessions = [
    { id: 's1', name: 'Zebra task', ticket: 'PROJ-1' },
    { id: 's2', name: 'Alpha task', ticket: 'PROJ-1' },
    { id: 's3', name: 'Beta task', ticket: 'PROJ-1' },
  ]
  const reordered = moveBefore([], ['s1', 's2', 's3'], 's1', 's3')
  const groups = groupSessions(sessions, reordered)
  assert.deepEqual(groups[0].sessions.map(s => s.id), ['s2', 's1', 's3'])

  // Even if s1 gets renamed to start with A or Z, manual order is preserved
  sessions[0].name = 'Aardvark task'
  const groupsAfterRename = groupSessions(sessions, reordered)
  assert.deepEqual(groupsAfterRename[0].sessions.map(s => s.id), ['s2', 's1', 's3'])
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

test('parseGithubRemote extracts owner/repo and host from various git remote URL formats', () => {
  assert.deepEqual(
    parseGithubRemote('origin\thttps://github.com/kaiketsu-labs/agent-cockpit.git (fetch)\norigin\thttps://github.com/kaiketsu-labs/agent-cockpit.git (push)'),
    { repo: 'kaiketsu-labs/agent-cockpit', host: 'github.com' },
  )
  assert.deepEqual(parseGithubRemote('origin\tgit@github.com:owner/repo.git (fetch)'), { repo: 'owner/repo', host: 'github.com' })
  assert.deepEqual(parseGithubRemote('origin\tssh://git@github.com/owner/repo (fetch)'), { repo: 'owner/repo', host: 'github.com' })
  // SSH aliases without dots point to github.com and leave host undefined so GH_HOST is never set to the alias
  assert.deepEqual(parseGithubRemote('origin\tgit@github-work:my-org/my-project.git (fetch)'), { repo: 'my-org/my-project', host: undefined })
  assert.deepEqual(parseGithubRemote('origin\tgit@github.example.com:org/repo.git (fetch)'), { repo: 'org/repo', host: 'github.example.com' })
  assert.deepEqual(parseGithubRemote('origin\thttps://github.example.com/org/repo.git (fetch)'), { repo: 'org/repo', host: 'github.example.com' })
  assert.deepEqual(parseGithubRemote('origin\tssh://git@github.example.com/org/repo (fetch)'), { repo: 'org/repo', host: 'github.example.com' })
  assert.equal(parseGithubRemote('origin\thttps://gitlab.com/foo/bar.git (fetch)'), undefined)
  assert.equal(parseGithubRemote(''), undefined)
  assert.equal(parseGithubRemote(undefined), undefined)
})

test('PR searches scope to repository and reject PRs from stranger public repos', () => {
  // Bare issue number #12 with repo specified scopes to repo
  assert.deepEqual(
    searchQueries(['#12'], 6, { reposByTicket: { '#12': 'kaiketsu-labs/agent-cockpit' } }),
    ['repo:kaiketsu-labs/agent-cockpit is:pr is:open in:title #12'],
  )

  // Explicit owner/repo#42 scopes to that repo
  assert.deepEqual(
    searchQueries(['other-org/other-repo#42'], 6, { reposByTicket: {} }),
    ['repo:other-org/other-repo is:pr is:open in:title #42'],
  )

  // Bare issue number #12 with NO repo known is skipped (never queried globally across GitHub)
  assert.deepEqual(
    searchQueries(['#12'], 6, { reposByTicket: {}, defaultRepos: [] }),
    [],
  )

  // Bare issue number #12 does NOT guess fallback repos when not in reposByTicket (only match if sure)
  assert.deepEqual(
    searchQueries(['#12'], 6, { reposByTicket: {}, defaultRepos: ['some-org/some-repo'] }),
    [],
  )

  // Jira keys with no repos at all do NOT search globally across GitHub
  assert.deepEqual(
    searchQueries(['PROJ-1'], 6, { reposByTicket: {}, defaultRepos: [] }),
    [],
  )

  // Keys with multiple default repos generate separate queries per repo (GitHub does not support grouping repo qualifiers)
  assert.deepEqual(
    searchQueries(['PROJ-1', 'PROJ-2'], 6, { reposByTicket: {}, defaultRepos: ['org/repo1', 'org/repo2'] }),
    [
      'repo:org/repo1 is:pr is:open in:title PROJ-1 OR PROJ-2',
      'repo:org/repo2 is:pr is:open in:title PROJ-1 OR PROJ-2',
    ],
  )

  // When githubOrg is configured, Jira keys scope to org:<githubOrg>, while bare issues stay pinned to their repo
  assert.deepEqual(
    searchQueries(['PROJ-1', 'PROJ-2', '#12'], 6, {
      githubOrg: 'kaiketsu-labs',
      reposByTicket: { '#12': 'kaiketsu-labs/agent-cockpit' },
    }),
    [
      'org:kaiketsu-labs is:pr is:open in:title PROJ-1 OR PROJ-2',
      'repo:kaiketsu-labs/agent-cockpit is:pr is:open in:title #12',
    ],
  )

  // prsByTicket rejects stranger PRs (e.g. NewsNest#97 Issue #12)
  const strangerPr = {
    number: 97,
    title: 'Issue #12',
    html_url: 'https://github.com/someone/NewsNest/pull/97',
    repository_url: 'https://api.github.com/repos/someone/NewsNest',
    draft: false,
  }
  const myPr = {
    number: 97,
    title: 'Issue #12',
    html_url: 'https://github.com/kaiketsu-labs/agent-cockpit/pull/97',
    repository_url: 'https://api.github.com/repos/kaiketsu-labs/agent-cockpit',
    draft: false,
  }

  // Stranger PR is rejected
  assert.deepEqual(
    prsByTicket([strangerPr], ['#12'], { reposByTicket: { '#12': 'kaiketsu-labs/agent-cockpit' } }),
    {},
  )

  // Own PR is accepted
  const accepted = prsByTicket([myPr], ['#12'], { reposByTicket: { '#12': 'kaiketsu-labs/agent-cockpit' } })
  assert.equal(accepted['#12']?.length, 1)
  assert.equal(accepted['#12'][0].repo, 'agent-cockpit')
  assert.equal(accepted['#12'][0].number, 97)

  // Jira keys with githubOrg accept PRs from any repo in that organization
  const orgPr1 = {
    number: 10,
    title: 'PROJ-1 add api endpoint',
    html_url: 'https://github.com/kaiketsu-labs/backend/pull/10',
    repository_url: 'https://api.github.com/repos/kaiketsu-labs/backend',
    draft: false,
  }
  const orgPr2 = {
    number: 20,
    title: 'PROJ-1 frontend button',
    html_url: 'https://github.com/kaiketsu-labs/frontend/pull/20',
    repository_url: 'https://api.github.com/repos/kaiketsu-labs/frontend',
    draft: false,
  }
  const strangerOrgPr = {
    number: 30,
    title: 'PROJ-1 someone else',
    html_url: 'https://github.com/other-org/backend/pull/30',
    repository_url: 'https://api.github.com/repos/other-org/backend',
    draft: false,
  }
  const orgMatches = prsByTicket([orgPr1, orgPr2, strangerOrgPr], ['PROJ-1'], { githubOrg: 'kaiketsu-labs' })
  assert.equal(orgMatches['PROJ-1']?.length, 2)
  assert.deepEqual(orgMatches['PROJ-1'].map(p => p.repo), ['backend', 'frontend'])

  // When githubOrg is configured, Jira keys match org-wide even if reposByTicket has the session root repo
  const siblingPr = {
    number: 40,
    title: 'PROJ-1 sibling repo change',
    html_url: 'https://github.example.com/org/other/pull/40',
    repository_url: 'https://github.example.com/api/v3/repos/org/other',
    draft: false,
  }
  const siblingMatches = prsByTicket([siblingPr], ['PROJ-1'], {
    githubOrg: 'org',
    reposByTicket: { 'PROJ-1': 'org/root' },
  })
  assert.equal(siblingMatches['PROJ-1']?.length, 1)
  assert.equal(siblingMatches['PROJ-1'][0].repo, 'other')
  assert.equal(siblingMatches['PROJ-1'][0].number, 40)
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

test('only a ticket suffix binds a session to a ticket when no folder is set', () => {
  assert.equal(ticketOf('Check nulls (proj-57)', proj), 'PROJ-57')
  assert.equal(ticketOf('compare with PROJ-1 approach', proj), undefined)
  assert.equal(ticketOf('Retry (OPS-1)', proj), undefined)
  assert.equal(ticketOf('Fix login (#42)', anyKey), '#42')
  assert.equal(ticketOf('Fix login (org/repo#42)', anyKey), 'org/repo#42')
})

test('sessions merge claude agents with plugin files, support free-form folders and tickets, and strip legacy suffixes', () => {
  const agents = [
    { id: 'job1', sessionId: 's1', name: 'bg job (PROJ-1)', state: 'working', startedAt: 1 },
    { sessionId: 's2', pid: 42, name: 'my-project', status: 'waiting', startedAt: 2, cwd: '/repo' },
    { sessionId: 's6', pid: 43, name: 'worktree-session', status: 'idle', startedAt: 6, cwd: '/repo/.claude/worktrees/PROJ-77-auth-fix' },
  ]
  const files = [
    { sessionId: 's1', kind: 'bg', cwd: '/repo', startedAt: 1, lastTurnEndAt: 10 },
    { sessionId: 's2', kind: 'interactive', cwd: '/repo', startedAt: 2, prompt: 'fix the nulls', folder: 'Auth Refactor' },
    { sessionId: 's3', kind: 'interactive', cwd: '/old', startedAt: 3, prompt: 'p', name: 'Old work (PROJ-2)', lastTurnEndAt: 30 },
    { sessionId: 's4', kind: 'bg', cwd: '/repo', startedAt: 4, name: 'deleted job' },
    { sessionId: 's5', kind: 'interactive', cwd: '/repo', startedAt: 5 },
  ]
  const sessions = mergeSessions(agents, files, proj)
  assert.deepEqual(
    sessions.map(({ id, name, state, folder, ticket, updatedAt }) => ({ id, name, state, folder, ticket, updatedAt })),
    [
      { id: 'job1', name: 'bg job', state: 'working', folder: 'PROJ-1', ticket: 'PROJ-1', updatedAt: 10 },
      { id: 's2', name: 'fix the nulls', state: 'blocked', folder: 'Auth Refactor', ticket: 'Auth Refactor', updatedAt: 2 },
      { id: 's6', name: 'worktree-session', state: 'idle', folder: 'PROJ-77', ticket: 'PROJ-77', updatedAt: 6 },
      { id: 's3', name: 'Old work', state: 'done', folder: 'PROJ-2', ticket: 'PROJ-2', updatedAt: 30 },
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

test('inbox lists sessions that need the person first and one card per folder or ticket (with PRs and Jira status on ticket folders)', () => {
  const session = (id, state, folder) => ({ id, name: `work ${id}`, folder, ticket: folder, state, updatedAt: 0 })
  const sessions = [
    session('a', 'working', 'PROJ-1'),
    session('b', 'blocked', 'PROJ-1'),
    session('c', 'idle', 'Auth Refactor'),
    session('d', 'failed'),
  ]
  const model = inboxModel({
    groups: groupSessions(sessions),
    hidden: [],
    prs: { 'PROJ-1': [{ repo: 'r', number: 3 }] },
    issues: { 'PROJ-1': { category: 'indeterminate', summary: 'One Jira', status: 'In Progress' } },
    titles: { 'Auth Refactor': 'OAuth2 Cleanup' },
    pattern: proj,
    cacheTtl: 300_000,
    now: 60_000,
  })
  assert.deepEqual(model.needs.map(row => row.id), ['b', 'd'])
  assert.deepEqual(model.tickets.map(t => [t.key, t.isTicket, t.title, t.isBusy, t.prs.length]), [
    ['Auth Refactor', false, '', false, 0],
    ['PROJ-1', true, 'One Jira', true, 1],
  ])
  assert.equal(model.tickets[1].sessions[0].name, 'work a')
  assert.deepEqual(model.loose.map(row => row.id), ['d'])
})

test('sessions preserve keepWarm status and honor expiration', () => {
  const agents = [{ sessionId: 's1', pid: 1, status: 'idle' }, { sessionId: 's2', pid: 2, status: 'idle' }]
  const files = [
    { sessionId: 's1', keepWarm: true, keepWarmUntil: Date.now() + 60_000, name: 'warm session' },
    { sessionId: 's2', keepWarm: true, keepWarmUntil: Date.now() - 1_000, name: 'expired warm session' },
    {
      sessionId: 's3',
      kind: 'interactive',
      keepWarm: true,
      keepWarmUntil: Date.now() + 60_000,
      name: 'ended warm session',
      lastTurnEndAt: 12345,
      contextTokens: 4200,
      model: 'claude-3-7-sonnet',
    },
  ]
  const merged = mergeSessions(agents, files, proj)
  assert.equal(merged[0].keepWarm, true)
  assert.equal(merged[1].keepWarm, false)
  assert.equal(merged[2].ended, true)
  assert.equal(merged[2].keepWarm, true)
  assert.equal(merged[2].lastWriteAt, 12345)
  assert.equal(merged[2].contextTokens, 4200)
  assert.equal(merged[2].model, 'claude-3-7-sonnet')
})

test('plugin/hooks/register.tsx parses cleanly without TypeScript or async/await syntax errors', () => {
  const registerPath = path.resolve(__dirname, '../plugin/hooks/register.tsx')
  const code = fs.readFileSync(registerPath, 'utf8')

  // Guard against await inside synchronous .catch arrow callbacks (.catch(() => ... await ...))
  const syncCatchWithAwait = /\.catch\(\s*(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>[^{}\n;]*\bawait\b/
  assert.equal(
    syncCatchWithAwait.test(code),
    false,
    'register.tsx must not use await in synchronous .catch arrow callbacks (add async () => ...)',
  )

  // Full TypeScript AST parse check via Node experimental-strip-types
  const tmpFile = path.join(os.tmpdir(), `register-syntax-check-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`)
  fs.writeFileSync(tmpFile, code)
  try {
    execFileSync(process.execPath, [
      '--experimental-strip-types',
      '-e',
      `import(${JSON.stringify(tmpFile)}).catch(err => {
         if (err.name === 'SyntaxError' || err.code === 'ERR_INVALID_TYPESCRIPT_SYNTAX') {
           console.error(err);
           process.exit(1);
         }
         process.exit(0);
       })`,
    ], { stdio: 'pipe' })
  } catch (err) {
    if (err.status !== 0 && err.stderr) {
      const stderr = err.stderr.toString()
      if (stderr.includes('SyntaxError') || stderr.includes('ERR_INVALID_TYPESCRIPT_SYNTAX')) {
        assert.fail(`register.tsx syntax error: ${stderr}`)
      }
    }
  } finally {
    try { fs.unlinkSync(tmpFile) } catch {}
  }
})
