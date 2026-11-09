const api = acquireVsCodeApi()
const ui = Object.assign({ filter: 'all', q: '', open: {}, history: false }, api.getState())
let data = { model: null, message: '' }
const save = () => api.setState(ui)
const send = (type, extra) => api.postMessage({ type, ...extra })

const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v)
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) node.append(child)
  return node
}

const SHAPES = {
  logo: '<path d="m4.5 5.5 3 2.5-3 2.5M9 10.5h2.5"/>',
  search: '<circle cx="6.5" cy="6.5" r="4.5"/><path d="m10 10 3.5 3.5"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  newFolder: '<path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.2l1.4 1.6H13A1.5 1.5 0 0 1 14.5 5.6v6.9A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5V4z"/><path d="M8 6.8v4.4M5.8 9h4.4"/>',
  refresh: '<path d="M13 6.5A5 5 0 1 0 11.8 11M13 3v3.5H9.5"/>',
  folder: '<path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.3l1.5 1.8H13A1.5 1.5 0 0 1 14.5 5.3v7.2A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5v-9z"/>',
  ticket: '<path d="M3 2h10v12l-5-3-5 3z"/>',
  pr: '<circle cx="4" cy="3.5" r="1.6"/><circle cx="4" cy="12.5" r="1.6"/><circle cx="12" cy="12.5" r="1.6"/><path d="M4 5.1v5.8M12 10.9V7a2 2 0 0 0-2-2H8M9.5 3.5 8 5l1.5 1.5"/>',
  chev: '<path d="m6 3.5 4.5 4.5L6 12.5"/>',
  edit: '<path d="M11.2 2.5a1.5 1.5 0 0 1 2.1 2.1L5.5 12.4l-3 .7.7-3 8-7.6z"/>',
  move: '<path d="M2 4a1.5 1.5 0 0 1 1.5-1.5h3l1.3 1.5h4.7A1.5 1.5 0 0 1 14 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5V4z"/><path d="m7.5 7 2 2-2 2M5.5 9h4"/>',
  archive: '<rect x="2" y="3" width="12" height="3" rx="1"/><path d="M3 6v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6M6.5 9h3"/>',
  restore: '<path d="M3.5 7.5 6.5 4.5M3.5 7.5l3 3M3.5 7.5H10a3 3 0 1 1 0 6H7.5"/>',
  external: '<path d="M9 3h4v4M13 3 7.5 8.5M6 4H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-2"/>',
  close: '<path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/>',
  gear: '<path d="M9.1 1.5H6.9l-.3 1.5a5 5 0 0 0-1.2.7L4 3 2.5 4.5l.7 1.4a5 5 0 0 0-.7 1.2l-1.5.3v2.2l1.5.3a5 5 0 0 0 .7 1.2L2.5 12 4 13.5l1.4-.7a5 5 0 0 0 1.2.7l.3 1.5h2.2l.3-1.5a5 5 0 0 0 1.2-.7l1.4.7 1.5-1.5-.7-1.4a5 5 0 0 0 .7-1.2l1.5-.3V6.9l-1.5-.3a5 5 0 0 0-.7-1.2l.7-1.4L13.5 3 12 2.5l-1.4.7a5 5 0 0 0-1.2-.7l-.3-1.5zM8 10.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/>',
  compass: '<circle cx="8" cy="8" r="6"/><polygon points="6.5,6.5 11,5 9.5,9.5 5,11" fill="currentColor" stroke="none"/>',
}
const icon = (kind, extra = '') => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('class', 'ico ' + kind + ' ' + extra)
  svg.innerHTML = SHAPES[kind] || ''
  return svg
}

const stop = fn => event => { event.stopPropagation(); fn(event) }
const iconBtn = (kind, title, fn) => el('button', { class: 'icon-btn', title, onclick: stop(fn) }, icon(kind))

const matches = (text, q) => text.toLowerCase().includes(q)
const sessionMatches = (row, q) => !q || matches(row.name + ' ' + (row.ticket ?? ''), q)
const cardMatches = (card, q) =>
  !q || matches((card.key ?? '') + ' ' + card.title, q) || card.sessions.some(row => sessionMatches(row, q)) || card.prs.some(pr => matches(pr.title + pr.repo, q))
const passesFilter = card => ui.filter === 'all' || (ui.filter === 'active' && card.isBusy) || (ui.filter === 'prs' && card.prs.length > 0)

const clock = ms => {
  const seconds = Math.ceil(ms / 1000)
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
}

const sessionRow = row => {
  const hasExpires = Boolean(row.cacheExpiresAt && row.cacheExpiresAt > 0)
  const now = Date.now()
  const left = hasExpires ? Math.max(0, row.cacheExpiresAt - now) : 0
  const timeStr = left > 0 ? clock(left) : (hasExpires ? null : row.cache)
  const isWarm = Boolean(timeStr || row.keepWarm)

  const cardProps = {
    id: 'session-' + row.id,
    class: 'session-card ' + row.state,
    draggable: 'true',
    title: row.name + ' · ' + row.stateLabel,
    onclick: () => send('attach', { id: row.id }),
    ondragstart: event => {
      event.dataTransfer.setData('text/plain', row.id)
      event.dataTransfer.effectAllowed = 'move'
    },
  }
  if (hasExpires && left > 0) {
    cardProps['data-cache-expires'] = row.cacheExpiresAt
  }
  if (row.keepWarm) {
    cardProps['data-keep-warm'] = '1'
  }

  const node = el('div', cardProps,
    el('div', { class: 'session-top' },
      el('span', { class: 'status-orb ' + row.state }),
      el('span', { class: 'session-name' }, row.name),
      el('span', { class: 'meta hide-on-hover' }, el('span', {}, row.age ?? row.activity)),
      el('span', { class: 'actions' },
        iconBtn('edit', 'Rename session', () => send('rename', { id: row.id })),
        iconBtn('move', 'Move to folder…', () => send('moveToFolder', { id: row.id })),
        row.isHidden
          ? iconBtn('restore', 'Restore from history', () => {
              if (row.folder) {
                ui.open[row.folder] = true
                save()
              }
              send('show', { id: row.id })
            })
          : iconBtn('archive', 'Move to history', () => send('hide', { id: row.id }))),
      isWarm && el('span', {
        class: 'cache-pill' + (row.keepWarm ? ' keep-warm' : ''),
        title: row.keepWarm
          ? 'Prompt cache keepalive active' + (timeStr ? ' (auto-refreshing in ' + timeStr + ')' : '') + ' · Click to disable'
          : 'Prompt cache warm for ' + timeStr + ' · Click to keep warm automatically',
        onclick: stop(() => send('toggleKeepWarm', { id: row.id })),
      }, '⚡ ' + (row.keepWarm ? 'warm' : (timeStr || 'warm')))))

  node.addEventListener('dragover', event => {
    event.preventDefault()
    event.stopPropagation()
    const rect = node.getBoundingClientRect()
    const isBefore = (event.clientY - rect.top) < rect.height / 2
    node.classList.toggle('drop-before', isBefore)
    node.classList.toggle('drop-after', !isBefore)
  })
  node.addEventListener('dragleave', () => {
    node.classList.remove('drop-before', 'drop-after')
  })
  node.addEventListener('drop', event => {
    event.preventDefault()
    event.stopPropagation()
    const isBefore = node.classList.contains('drop-before')
    node.classList.remove('drop-before', 'drop-after')
    const movedId = event.dataTransfer.getData('text/plain')
    if (movedId && movedId !== row.id && !row.isHidden) {
      send('reorderSession', { movedId, targetId: row.id, before: isBefore, folder: row.folder })
    }
  })
  return node
}

const prRow = pr =>
  el('div', { class: 'pr-row' + (pr.isDraft ? ' draft' : ''), title: pr.title + '\\n' + pr.url, onclick: () => send('openUrl', { url: pr.url }) },
    icon('pr', pr.isDraft ? 'draft' : ''),
    el('span', { class: 'grow' }, el('span', { class: 'ref' }, pr.repo + '#' + pr.number), ' ' + pr.title),
    pr.isDraft && el('span', { class: 'badge' }, 'draft'))

const counts = card => {
  const blocked = card.sessions.filter(s => s.state === 'blocked' || s.state === 'failed').length
  const working = card.sessions.filter(s => s.state === 'working').length
  const badges = []
  if (blocked > 0) badges.push(el('span', { class: 'badge warn', title: blocked + ' waiting for input' }, '● ' + blocked))
  if (working > 0) badges.push(el('span', { class: 'badge working', title: working + ' running' }, '↻ ' + working))
  if (card.prs.length > 0) badges.push(el('span', { class: 'badge pr', title: card.prs.length + ' PR' + (card.prs.length === 1 ? '' : 's') }, '⎇ ' + card.prs.length))
  return badges
}

const dropTarget = (node, ticket) => {
  node.addEventListener('dragover', event => { event.preventDefault(); node.classList.add('drop') })
  node.addEventListener('dragleave', event => { if (!node.contains(event.relatedTarget)) node.classList.remove('drop') })
  node.addEventListener('drop', event => {
    event.preventDefault()
    node.classList.remove('drop')
    send('assign', { id: event.dataTransfer.getData('text/plain'), ticket })
  })
}

const card = (c, isLoose, isHistory = false) => {
  const id = (isHistory ? 'history:' : '') + (c.key ?? 'none')
  const forced = ui.q !== ''
  const isOpen = forced || (ui.open[id] ?? (c.isBusy || isLoose || c.sessions.length > 0))
  const sessions = c.sessions.filter(row => sessionMatches(row, ui.q) || (c.key && matches(c.key + c.title, ui.q)))
  const folderIcon = c.key ? (c.isTicket ? icon('ticket', 't-' + (c.category ?? 'none')) : icon('folder')) : false
  const keyClass = 'key' + (c.isTicket ? ' ticket-pill t-' + (c.category ?? 'none') : '')
  const head = el('div', { class: 'head', onclick: () => { ui.open[id] = !isOpen; save(); renderList() } },
    icon('chev', isOpen ? 'open' : ''),
    folderIcon,
    el('span', { class: keyClass }, c.key ?? 'Ungrouped'),
    el('span', { class: 'grow title' }, c.title),
    el('span', { class: 'meta hide-on-hover' }, counts(c)),
    c.key && el('span', { class: 'actions' },
      iconBtn('plus', 'New session in ' + c.key, () => send('newSession', { folder: c.key })),
      c.isTicket && iconBtn('external', 'Open ticket in browser', () => send('openTicket', { ticket: c.ticketKey || c.key })),
      iconBtn('edit', 'Rename folder', () => send('renameFolder', { folder: c.key })),
      c.sessions.length === 0 && iconBtn('close', 'Remove empty folder', () => send('removeFolder', { folder: c.key }))))
  const node = el('div', { class: 'card' + (c.isBusy ? ' busy' : '') }, head)
  if (isOpen) {
    const prs = c.prs.filter(pr => !ui.q || matches(pr.title + pr.repo, ui.q) || matches(c.key + c.title, ui.q))
    node.append(el('div', { class: 'body' },
      prs.length > 0 && [el('div', { class: 'sub' }, 'Pull requests'), prs.map(prRow)],
      sessions.length > 0 && [prs.length > 0 && el('div', { class: 'sub' }, 'Sessions'), sessions.map(sessionRow)],
      sessions.length === 0 && prs.length === 0 && el('div', { class: 'empty-folder' }, 'Drop a session here or click + to start one')))
  }
  if (!isHistory) dropTarget(node, c.key)
  return node
}

const section = (title, count, ...children) =>
  el('div', { class: 'section-block' }, el('h2', {}, title, count > 0 && el('span', { class: 'count' }, count)), children)

const render = () => {
  const root = document.getElementById('root')
  root.replaceChildren()
  const search = el('input', {
    type: 'search',
    placeholder: 'Search folders, tickets, sessions, PRs…',
    value: ui.q,
    oninput: event => { ui.q = event.target.value.trim().toLowerCase(); save(); renderList() },
  })
  const chip = (id, label) => el('button', { class: 'chip' + (ui.filter === id ? ' on' : ''), onclick: () => { ui.filter = id; save(); render() } }, label)
  root.append(el('div', { class: 'bar' },
    el('div', { class: 'search-wrap' },
      el('span', { class: 'search-ico' }, icon('search')),
      search),
    el('div', { class: 'filter-bar' },
      el('div', { class: 'segmented' }, chip('all', 'All'), chip('active', 'Active'), chip('prs', 'PRs')),
      el('div', { class: 'bar-right' },
        el('div', { id: 'stats', class: 'stats-pills' }),
        el('button', {
          class: 'briefing-btn',
          title: 'Start on-demand Briefing session (Sonnet)',
          onclick: () => send('briefing'),
        }, icon('compass'), 'Briefing')))))
  root.append(el('div', { id: 'list' }))
  renderList()
}

let waitingIndex = 0

const focusNextWaiting = () => {
  const waiting = (data.model?.needs ?? []).filter(r => r.state === 'blocked' || r.state === 'failed')
  if (waiting.length === 0) return
  const target = waiting[waitingIndex % waiting.length]
  waitingIndex = (waitingIndex + 1) % waiting.length
  if (target.isHidden) {
    ui.history = true
    if (target.folder) ui.open['history:' + target.folder] = true
    save()
    renderList()
  } else if (target.folder) {
    ui.open[target.folder] = true
    save()
    renderList()
  }
  send('attach', { id: target.id })
  setTimeout(() => {
    const node = document.getElementById('session-' + target.id)
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      node.classList.add('spotlight-pulse')
      setTimeout(() => node.classList.remove('spotlight-pulse'), 1200)
    }
  }, 50)
}

const renderList = () => {
  const list = document.getElementById('list')
  const stats = document.getElementById('stats')
  const model = data.model
  list.replaceChildren()
  if (stats) stats.replaceChildren()
  if (data.message) list.append(el('div', { class: 'error' }, data.message))
  if (!model) return list.append(el('div', { class: 'empty-state' }, 'Loading sessions…'))

  // Compute live summary pills for the header bar
  const allRows = [...model.tickets.flatMap(t => t.sessions), ...model.loose]
  const workingCount = allRows.filter(r => r.state === 'working').length
  const blockedCount = allRows.filter(r => r.state === 'blocked').length
  if (stats) {
    if (blockedCount > 0) {
      stats.append(el('span', {
        class: 'stat-pill blocked clickable',
        title: 'Click to focus next waiting session (' + blockedCount + ' waiting)',
        onclick: () => focusNextWaiting(),
      }, '● ' + blockedCount + ' waiting'))
    }
    if (workingCount > 0) stats.append(el('span', { class: 'stat-pill working' }, '↻ ' + workingCount + ' running'))
    if (blockedCount === 0 && workingCount === 0 && allRows.length > 0) {
      stats.append(el('span', { class: 'stat-pill' }, allRows.length + ' session' + (allRows.length === 1 ? '' : 's')))
    }
  }

  const q = ui.q
  const folders = model.tickets.filter(c => passesFilter(c) && cardMatches(c, q))
  const looseSessions = model.loose.filter(row =>
    sessionMatches(row, q) &&
    (ui.filter === 'all' || (ui.filter === 'active' && (row.state === 'working' || row.state === 'blocked' || row.state === 'failed')))
  )
  const showLoose = looseSessions.length > 0 || (!q && folders.length > 0)
  if (folders.length > 0) {
    list.append(el('div', { class: 'section-block' }, folders.map(c => card(c, false))))
  }
  if (showLoose) {
    const looseBlock = section('Ungrouped', looseSessions.length,
      looseSessions.length > 0
        ? el('div', { class: 'loose-list' }, looseSessions.map(sessionRow))
        : el('div', { class: 'empty-folder' }, 'Drop a session here to remove from folder')
    )
    dropTarget(looseBlock, null)
    list.append(looseBlock)
  }
  const history = model.history.filter(c => cardMatches(c, q))
  if (history.length > 0) {
    const histTotal = history.reduce((sum, c) => sum + c.sessions.length, 0)
    const isOpen = ui.history || q !== ''
    const heading = el('h2', { class: 'toggle', onclick: () => { ui.history = !ui.history; save(); renderList() } }, icon('chev', isOpen ? 'open' : ''), 'History', el('span', { class: 'count' }, histTotal))
    const histBlock = el('div', { class: 'section-block' }, heading)
    if (isOpen) {
      for (const c of history) {
        if (c.key) {
          histBlock.append(card(c, false, true))
        } else {
          const rows = c.sessions.filter(row => sessionMatches(row, q))
          if (rows.length > 0) histBlock.append(el('div', { class: 'loose-list' }, rows.map(sessionRow)))
        }
      }
    }
    list.append(histBlock)
  }
  if (folders.length === 0 && !showLoose && history.length === 0) {
    list.append(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-title' }, q ? 'No matching sessions or folders' : 'Your Agent Cockpit is ready'),
      el('div', {}, q ? 'Try a different filter or search query.' : 'Start an agent session or create a topic/ticket folder to organize your work.'),
      !q && el('div', { class: 'empty-actions' },
        el('button', { class: 'btn-primary', onclick: () => send('newSession') }, icon('plus'), 'New Session'),
        el('button', { class: 'btn-ghost', onclick: () => send('newFolder') }, icon('newFolder'), 'New Folder'))))
  }
}

const tickCache = () => {
  const cards = document.querySelectorAll('.session-card[data-cache-expires]')
  if (!cards.length) return
  const now = Date.now()
  for (const node of cards) {
    const expiresAt = Number(node.getAttribute('data-cache-expires'))
    const isKeepWarm = node.getAttribute('data-keep-warm') === '1'
    const pill = node.querySelector('.cache-pill')
    const left = Math.max(0, expiresAt - now)
    if (left > 0) {
      const timeStr = clock(left)
      if (pill) {
        if (isKeepWarm) {
          pill.textContent = '⚡ warm'
          pill.title = 'Prompt cache keepalive active (auto-refreshing in ' + timeStr + ') · Click to disable'
        } else {
          pill.textContent = '⚡ ' + timeStr
          pill.title = 'Prompt cache warm for ' + timeStr + ' · Click to keep warm automatically'
        }
      }
    } else {
      if (isKeepWarm) {
        if (pill) {
          pill.textContent = '⚡ warm'
          pill.title = 'Prompt cache keepalive active · Click to disable'
        }
      } else {
        pill?.remove()
      }
      node.removeAttribute('data-cache-expires')
    }
  }
}

let lastPayload = ''
window.addEventListener('message', event => {
  const nextPayload = JSON.stringify(event.data)
  if (nextPayload === lastPayload) return
  lastPayload = nextPayload
  data = event.data
  renderList()
})
render()
send('ready')
setInterval(tickCache, 1000)
