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
  compass: '<circle cx="8" cy="8" r="6"/><polygon points="6.5,6.5 11,5 9.5,9.5 5,11" fill="currentColor" stroke="none"/>',
  gear: '<path d="M9.1 1.5H6.9l-.3 1.5a5 5 0 0 0-1.2.7L4 3 2.5 4.5l.7 1.4a5 5 0 0 0-.7 1.2l-1.5.3v2.2l1.5.3a5 5 0 0 0 .7 1.2L2.5 12 4 13.5l1.4-.7a5 5 0 0 0 1.2.7l.3 1.5h2.2l.3-1.5a5 5 0 0 0 1.2-.7l1.4.7 1.5-1.5-.7-1.4a5 5 0 0 0 .7-1.2l1.5-.3V6.9l-1.5-.3a5 5 0 0 0-.7-1.2l.7-1.4L13.5 3 12 2.5l-1.4.7a5 5 0 0 0-1.2-.7l-.3-1.5zM8 10.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/>',
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
  !q ||
  matches(card.key ?? '', q) ||
  matches(card.title ?? '', q) ||
  card.sessions.some(session => sessionMatches(session, q)) ||
  card.prs.some(pr => matches(`${pr.repo}#${pr.number} ${pr.title}`, q))

const sessionRow = row => {
  const statusOrb = el('span', { class: 'status-orb ' + row.state, title: row.stateLabel })
  const isWarm = Boolean(row.keepWarm || row.cache)
  const isDraggable = !row.isHidden
  const node = el('div', {
    class: 'session-card ' + row.state,
    draggable: isDraggable ? 'true' : 'false',
    title: row.stateLabel + ' · Click to open',
    onclick: () => send('attach', { id: row.id }),
  },
    el('div', { class: 'session-top' },
      statusOrb,
      el('span', { class: 'session-name' }, row.name),
      el('span', { class: 'meta hide-on-hover' },
        el('span', {}, row.age)),
      el('span', { class: 'actions' },
        iconBtn('edit', 'Rename session', () => send('rename', { id: row.id })),
        iconBtn('move', 'Move to folder…', () => send('moveToFolder', { id: row.id })),
        row.isHidden
          ? iconBtn('restore', 'Restore from history', () => send('show', { id: row.id }))
          : iconBtn('archive', 'Move to history', () => send('hide', { id: row.id }))),
      isWarm && el('span', {
        class: 'cache-pill' + (row.keepWarm ? ' keep-warm' : ''),
        title: row.keepWarm
          ? (row.cache ? `Prompt cache kept warm (~${row.cache} left in window) · Click to disable` : 'Prompt cache kept warm · Click to disable')
          : `Prompt cache ~${row.cache} left · Click to keep warm`,
        onclick: stop(() => send('toggleKeepWarm', { id: row.id })),
      }, row.cache ? `${row.cache} left` : 'warm')))

  if (isDraggable) {
    node.addEventListener('dragstart', event => {
      event.dataTransfer.setData('text/plain', row.id)
      event.dataTransfer.effectAllowed = 'move'
    })
    node.addEventListener('dragover', event => {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      const rect = node.getBoundingClientRect()
      const mid = rect.top + rect.height / 2
      if (event.clientY < mid) {
        node.classList.add('drop-before')
        node.classList.remove('drop-after')
      } else {
        node.classList.add('drop-after')
        node.classList.remove('drop-before')
      }
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
      if (movedId && movedId !== row.id) {
        send('reorderSession', { movedId, targetId: row.id, before: isBefore, folder: row.folder })
      }
    })
  }
  return node
}

const cardNode = card => {
  const isOpen = ui.open[card.key] ?? false
  const isTicket = card.isTicket
  const ticketClass = card.category ? ` t-${card.category}` : ''
  const prsCount = card.prs.length
  const isDropTarget = !card.isHidden
  const node = el('div', { class: 'card' + (card.isBusy ? ' busy' : '') },
    el('div', {
      class: 'head',
      onclick: () => { ui.open[card.key] = !isOpen; save(); renderList() },
    },
      icon('chev', isOpen ? 'open' : ''),
      icon(isTicket ? 'ticket' : 'folder', isTicket ? ticketClass : ''),
      el('span', { class: 'key' + (isTicket ? ' ticket-pill' + ticketClass : ''), title: card.status ? `Status: ${card.status}` : '' }, card.key),
      card.title && el('span', { class: 'title' }, card.title),
      el('span', { class: 'meta hide-on-hover' },
        prsCount > 0 && el('span', { class: 'badge pr' }, icon('pr'), `${prsCount}`)),
      el('span', { class: 'actions' },
        iconBtn('plus', 'New session in folder', () => send('newSession', { folder: card.key })),
        isTicket && iconBtn('external', 'Open ticket in browser', () => send('openTicket', { ticket: card.key })),
        iconBtn('edit', 'Rename folder', () => send('renameFolder', { folder: card.key })),
        iconBtn('close', 'Remove folder', () => send('removeFolder', { folder: card.key })))),
  if (isDropTarget) {
    node.addEventListener('dragover', event => {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      node.classList.add('drop')
    })
    node.addEventListener('dragleave', event => {
      if (!node.contains(event.relatedTarget)) {
        node.classList.remove('drop')
      }
    })
    node.addEventListener('drop', event => {
      event.preventDefault()
      node.classList.remove('drop')
      const id = event.dataTransfer.getData('text/plain')
      if (id) send('assign', { id, ticket: card.key })
    })
  }
  if (isOpen) {
    const prRows = card.prs.map(pr =>
      el('div', {
        class: 'pr-row' + (pr.isDraft ? ' draft' : ''),
        title: (pr.isDraft ? 'Draft PR: ' : 'PR: ') + pr.title,
        onclick: () => send('openUrl', { url: pr.url }),
      },
        icon('pr', pr.isDraft ? 'draft' : ''),
        el('span', { class: 'ref' }, `${pr.repo}#${pr.number}`),
        el('span', { class: 'grow' }, pr.title)),
    )
    const sessionRows = card.sessions.map(sessionRow)
    const body = el('div', { class: 'body' })
    if (prRows.length > 0) {
      body.append(el('div', { class: 'sub' }, 'Pull Requests'), ...prRows)
    }
    if (sessionRows.length > 0) {
      if (prRows.length > 0) body.append(el('div', { class: 'sub' }, 'Sessions'))
      body.append(...sessionRows)
    } else if (prRows.length === 0) {
      body.append(el('div', { class: 'empty-folder' }, 'No sessions yet'))
    }
    node.append(body)
  }
  return node
}

const renderList = () => {
  const list = document.getElementById('list')
  if (!list) return
  list.innerHTML = ''
  if (!data.model) return
  const m = data.model
  const q = ui.q
  const filter = ui.filter

  const updateStats = () => {
    const stats = document.getElementById('stats')
    if (!stats) return
    const allSessions = [
      ...m.tickets.flatMap(t => t.sessions),
      ...m.loose,
    ]
    const waiting = allSessions.filter(s => s.state === 'blocked').length
    const working = allSessions.filter(s => s.state === 'working').length
    const totalPrs = m.tickets.reduce((sum, t) => sum + (t.prs?.length || 0), 0)

    stats.innerHTML = ''
    if (waiting > 0) {
      stats.append(el('span', { class: 'stat-pill warn' },
        el('span', { class: 'stat-dot pulse' }),
        `${waiting} waiting`))
    }
    if (working > 0) {
      stats.append(el('span', { class: 'stat-pill busy' },
        el('span', { class: 'stat-dot spin' }),
        `${working} active`))
    }
    if (totalPrs > 0 && waiting === 0 && working === 0) {
      stats.append(el('span', { class: 'stat-pill' },
        icon('pr'),
        `${totalPrs} open`))
    }
  }
  updateStats()

  if (data.message) {
    list.append(el('div', { class: 'error' }, data.message))
  }

  let tickets = m.tickets.filter(card => cardMatches(card, q))
  let loose = m.loose.filter(s => sessionMatches(s, q))

  if (filter === 'active') {
    tickets = tickets.filter(t => t.isBusy || t.sessions.some(s => s.state !== 'done'))
    loose = loose.filter(s => s.state !== 'done')
  } else if (filter === 'prs') {
    tickets = tickets.filter(t => t.prs.length > 0)
    loose = []
  }

  if (filter === 'all' && !q && m.needs.length > 0) {
    const sec = el('div', { class: 'sec' })
    sec.append(
      el('h2', {},
        el('span', { class: 'count' }, `${m.needs.length}`),
        'Waiting for you'),
      el('div', { class: 'loose-list' }, ...m.needs.map(sessionRow)))
    list.append(sec)
  }

  const main = el('div', { class: 'sec' })
  if (tickets.length === 0 && loose.length === 0 && !data.message) {
    if (q) {
      main.append(el('div', { class: 'empty-state' }, `No sessions match "${q}"`))
    } else {
      main.append(
        el('div', { class: 'empty-state' },
          el('span', { class: 'empty-title' }, 'No sessions'),
          el('span', {}, 'Start a Claude Code session to begin'),
          el('div', { class: 'empty-actions' },
            el('button', { class: 'btn-primary', onclick: () => send('newSession') }, icon('plus'), 'New session'),
            el('button', { class: 'btn-ghost', onclick: () => send('newFolder') }, icon('newFolder'), 'New folder'))))
    }
  } else {
    tickets.forEach(ticket => main.append(cardNode(ticket)))
    if (loose.length > 0) {
      const dropZone = el('div', { class: 'loose-list' }, ...loose.map(sessionRow))
      dropZone.addEventListener('dragover', event => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      })
      dropZone.addEventListener('drop', event => {
        event.preventDefault()
        const id = event.dataTransfer.getData('text/plain')
        if (id) send('assign', { id, ticket: undefined })
      })
      main.append(
        tickets.length > 0 ? el('h2', {}, 'Ungrouped') : '',
        dropZone)
    }
  }
  list.append(main)

  if (m.history.length > 0 && !q && filter === 'all') {
    const sec = el('div', { class: 'sec' })
    const isHistoryOpen = ui.history ?? false
    sec.append(
      el('h2', {
        class: 'toggle',
        onclick: () => { ui.history = !isHistoryOpen; save(); renderList() },
      },
        icon('chev', isHistoryOpen ? 'open' : ''),
        'History',
        el('span', { class: 'count' }, `${m.history.length}`)))
    if (isHistoryOpen) {
      m.history.forEach(ticket => sec.append(cardNode(ticket)))
    }
    list.append(sec)
  }
}

const render = () => {
  const root = document.getElementById('root')
  if (!root) return
  root.innerHTML = ''
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

window.addEventListener('message', event => {
  data = event.data
  renderList()
})

render()
