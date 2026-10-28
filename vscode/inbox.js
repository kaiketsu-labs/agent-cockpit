'use strict'

const crypto = require('crypto')

const STYLE = `
:root { --gap: 6px; }
body { padding: 0; margin: 0; font-size: var(--vscode-font-size); color: var(--vscode-foreground); }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 2px 4px; border-radius: 3px; }
button:hover { background: var(--vscode-toolbar-hoverBackground); }
.bar { position: sticky; top: 0; z-index: 1; background: var(--vscode-sideBar-background); padding: 6px 8px; display: flex; flex-direction: column; gap: var(--gap); }
.bar .row { display: flex; gap: 4px; align-items: center; }
input { flex: 1; min-width: 0; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 3px 6px; border-radius: 3px; }
input:focus { outline: 1px solid var(--vscode-focusBorder); }
.chip { border: 1px solid var(--vscode-panel-border, #888); border-radius: 10px; padding: 0 8px; font-size: 0.9em; }
.chip.on { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-color: transparent; }
h2 { margin: 10px 8px 2px; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); font-weight: 600; display: flex; gap: 6px; align-items: center; }
h2 .count { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 8px; padding: 0 6px; font-size: 0.95em; }
h2.toggle { cursor: pointer; }
.item { display: flex; align-items: center; gap: 6px; padding: 3px 8px; cursor: pointer; min-height: 22px; }
.item:hover { background: var(--vscode-list-hoverBackground); }
.item .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item .meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; white-space: nowrap; }
.item .actions { display: none; gap: 0; }
.item:hover .actions { display: flex; }
.item:hover .meta.hide-on-hover { display: none; }
.card.drop > .head { outline: 1px dashed var(--vscode-focusBorder); background: var(--vscode-list-dropBackground); }
.card { margin: 4px 0 6px; }
.card > .head { background: var(--vscode-sideBarSectionHeader-background, #ffffff0d); border-top: 1px solid var(--vscode-sideBarSectionHeader-border, transparent); padding-top: 5px; padding-bottom: 5px; }
.head .key { font-weight: 700; }
.head .title { color: var(--vscode-descriptionForeground); }
.ico { width: 14px; height: 14px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
.ico.ticket { color: var(--vscode-charts-purple, #b180d7); }
.ico.ticket.t-new { color: var(--vscode-disabledForeground); }
.ico.ticket.t-indeterminate { color: var(--vscode-charts-blue); }
.ico.ticket.t-done { color: var(--vscode-charts-green); }
.ico.pr { color: var(--vscode-charts-green); }
.ico.pr.draft { color: var(--vscode-disabledForeground); }
.ico.session { color: var(--vscode-disabledForeground); }
.ico.session.blocked { color: var(--vscode-charts-yellow); }
.ico.session.failed { color: var(--vscode-charts-red); }
.ico.session.working { color: var(--vscode-charts-blue); animation: pulse 1.4s ease-in-out infinite; }
.ico.session.done { color: var(--vscode-charts-green); opacity: 0.5; }
.sub { margin: 6px 8px 0; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--vscode-descriptionForeground); opacity: 0.8; }
.pr-row .ref { font-weight: 600; }
.ico.chev { width: 16px; height: 16px; stroke-width: 1.8; color: var(--vscode-icon-foreground, var(--vscode-foreground)); transition: transform 0.1s; }
.ico.chev.open { transform: rotate(90deg); }
.body { margin-left: 14px; border-left: 1px solid var(--vscode-tree-indentGuidesStroke, #8884); }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--vscode-disabledForeground); }
.dot.blocked { background: var(--vscode-charts-yellow); }
.dot.failed { background: var(--vscode-charts-red); }
.dot.working { background: var(--vscode-charts-blue); animation: pulse 1.4s ease-in-out infinite; }
.dot.done { background: var(--vscode-charts-green); opacity: 0.5; }
.dot.ticket-new { background: none; border: 1px solid var(--vscode-disabledForeground); }
.dot.ticket-indeterminate { background: var(--vscode-charts-blue); }
.dot.ticket-done { background: var(--vscode-charts-green); }
@keyframes pulse { 50% { opacity: 0.35; } }
.badge { font-size: 0.85em; padding: 0 5px; border-radius: 8px; border: 1px solid var(--vscode-panel-border, #888); color: var(--vscode-descriptionForeground); white-space: nowrap; }
.badge.warn { border-color: var(--vscode-charts-yellow); color: var(--vscode-charts-yellow); }
.badge.pr { color: var(--vscode-charts-green); border-color: var(--vscode-charts-green); }
.needs .item { border-left: 3px solid var(--vscode-charts-yellow); padding-left: 5px; }
.needs .item.failed { border-left-color: var(--vscode-charts-red); }
.empty { padding: 16px 12px; color: var(--vscode-descriptionForeground); }
.error { padding: 4px 8px; color: var(--vscode-errorForeground); font-size: 0.9em; }
`

const SCRIPT = `
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
  ticket: '<path d="M3 2h10v12l-5-3-5 3z"/>',
  pr: '<circle cx="4" cy="3.5" r="1.6"/><circle cx="4" cy="12.5" r="1.6"/><circle cx="12" cy="12.5" r="1.6"/><path d="M4 5.1v5.8M12 10.9V7a2 2 0 0 0-2-2H8M9.5 3.5 8 5l1.5 1.5"/>',
  chev: '<path d="m6 3.5 4.5 4.5L6 12.5"/>',
  session: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="m4.5 6 2.3 2-2.3 2M8.5 10.5h3"/>',
}
const icon = (kind, extra = '') => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('class', 'ico ' + kind + ' ' + extra)
  svg.innerHTML = SHAPES[kind]
  return svg
}

const stop = fn => event => { event.stopPropagation(); fn(event) }
const btn = (label, title, fn) => el('button', { title, onclick: stop(fn) }, label)

const matches = (text, q) => text.toLowerCase().includes(q)
const sessionMatches = (row, q) => !q || matches(row.name + ' ' + (row.ticket ?? ''), q)
const cardMatches = (card, q) =>
  !q || matches((card.key ?? '') + ' ' + card.title, q) || card.sessions.some(row => sessionMatches(row, q)) || card.prs.some(pr => matches(pr.title + pr.repo, q))
const passesFilter = card => ui.filter === 'all' || (ui.filter === 'active' && card.isBusy) || (ui.filter === 'prs' && card.prs.length > 0)

const sessionRow = row =>
  el('div', { class: 'item', draggable: 'true', title: row.name + '\\n' + row.stateLabel,
      onclick: () => send('attach', { id: row.id }),
      ondragstart: event => { event.dataTransfer.setData('text/plain', row.id); event.dataTransfer.effectAllowed = 'move' } },
    icon('session', row.state),
    el('span', { class: 'grow' }, row.name),
    row.isRenaming && el('span', { class: 'badge' }, 'renaming'),
    el('span', { class: 'meta hide-on-hover' }, [row.activity, row.cache && 'cache ' + row.cache].filter(Boolean).join(' · ')),
    el('span', { class: 'actions' },
      btn('✎', 'Rename', () => send('rename', { id: row.id })),
      row.isHidden ? btn('↩', 'Back to the list', () => send('show', { id: row.id })) : btn('▣', 'Move to history', () => send('hide', { id: row.id }))))

const prRow = pr =>
  el('div', { class: 'item pr-row', title: pr.title + '\\n' + pr.url, onclick: () => send('openUrl', { url: pr.url }) },
    icon('pr', pr.isDraft ? 'draft' : ''),
    el('span', { class: 'grow' }, el('span', { class: 'ref' }, pr.repo + '#' + pr.number), ' ' + pr.title),
    pr.isDraft && el('span', { class: 'badge' }, 'draft'))

const counts = card => {
  const byState = {}
  for (const row of card.sessions) byState[row.state] = (byState[row.state] ?? 0) + 1
  return Object.entries(byState).map(([state, n]) => el('span', { class: 'badge' + (state === 'blocked' ? ' warn' : ''), title: state }, n + ' ' + state))
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
  const isOpen = forced || (ui.open[id] ?? (c.isBusy || isLoose))
  const sessions = c.sessions.filter(row => sessionMatches(row, ui.q) || (c.key && matches(c.key + c.title, ui.q)))
  const head = el('div', { class: 'item head', onclick: () => { ui.open[id] = !isOpen; save(); render() } },
    icon('chev', isOpen ? 'open' : ''),
    c.key && icon('ticket', 't-' + (c.category ?? 'none')),
    el('span', { class: 'key' }, c.key ?? 'No ticket'),
    el('span', { class: 'grow title' }, c.title),
    el('span', { class: 'meta hide-on-hover' }, counts(c), c.prs.length > 0 && el('span', { class: 'badge pr' }, '⎇ ' + c.prs.length)),
    c.key && el('span', { class: 'actions' },
      btn('+', 'Start task', () => send('startTask', { ticket: c.key })),
      btn('↗', 'Open ticket', () => send('openTicket', { ticket: c.key }))))
  const node = el('div', { class: 'card' }, head)
  if (isOpen) {
    const prs = c.prs.filter(pr => !ui.q || matches(pr.title + pr.repo, ui.q) || matches(c.key + c.title, ui.q))
    node.append(el('div', { class: 'body' },
      prs.length > 0 && [el('div', { class: 'sub' }, 'Pull requests'), prs.map(prRow)],
      sessions.length > 0 && [el('div', { class: 'sub' }, 'Sessions'), sessions.map(sessionRow)]))
  }
  if (!isHistory) dropTarget(node, c.key)
  return node
}

const section = (title, count, ...children) =>
  el('div', {}, el('h2', {}, title, count > 0 && el('span', { class: 'count' }, count)), children)

const render = () => {
  const root = document.getElementById('root')
  root.replaceChildren()
  const search = el('input', { type: 'search', placeholder: 'Filter tickets, sessions, PRs', value: ui.q, oninput: event => { ui.q = event.target.value.trim().toLowerCase(); save(); renderList() } })
  const chip = (id, label) => el('button', { class: 'chip' + (ui.filter === id ? ' on' : ''), onclick: () => { ui.filter = id; save(); render() } }, label)
  root.append(el('div', { class: 'bar' },
    el('div', { class: 'row' }, search, btn('+', 'Start task', () => send('startTask')), btn('💬', 'New session (no ticket)', () => send('newSession')), btn('↻', 'Refresh', () => send('refresh'))),
    el('div', { class: 'row' }, chip('all', 'All'), chip('active', 'Active'), chip('prs', 'With PRs'))))
  root.append(el('div', { id: 'list' }))
  renderList()
}

const renderList = () => {
  const list = document.getElementById('list')
  const model = data.model
  list.replaceChildren()
  if (data.message) list.append(el('div', { class: 'error' }, data.message))
  if (!model) return list.append(el('div', { class: 'empty' }, 'Loading…'))
  const q = ui.q
  const needs = model.needs.filter(row => sessionMatches(row, q))
  if (needs.length > 0) {
    list.append(section('Needs you', needs.length, el('div', { class: 'needs' }, needs.map(row =>
      el('div', { class: 'item ' + row.state, onclick: () => send('attach', { id: row.id }), title: row.name },
        icon('session', row.state),
        row.ticket && el('span', { class: 'badge' }, row.ticket),
        el('span', { class: 'grow' }, row.name),
        el('span', { class: 'meta' }, row.stateLabel))))))
  }
  const tickets = model.tickets.filter(c => passesFilter(c) && cardMatches(c, q))
  const loose = { key: null, title: '', category: null, status: null, sessions: model.loose, prs: [], isBusy: model.loose.some(r => r.state === 'working' || r.state === 'blocked') }
  const showLoose = model.loose.length > 0 && passesFilter(loose) && cardMatches(loose, q)
  if (tickets.length > 0) list.append(section('Tickets', tickets.length, tickets.map(c => card(c, false))))
  if (showLoose) list.append(section('Without ticket', model.loose.length, card(loose, true)))
  const history = model.history.filter(c => cardMatches(c, q))
  if (history.length > 0) {
    const isOpen = ui.history || q !== ''
    const heading = el('h2', { class: 'toggle', onclick: () => { ui.history = !ui.history; save(); renderList() } }, icon('chev', isOpen ? 'open' : ''), 'History', el('span', { class: 'count' }, history.length))
    list.append(heading)
    if (isOpen) list.append(...history.map(c => card(c, false, true)))
  }
  if (tickets.length === 0 && !showLoose && needs.length === 0 && history.length === 0) list.append(el('div', { class: 'empty' }, 'Nothing matches.'))
}

window.addEventListener('message', event => { data = event.data; renderList() })
render()
send('ready')
`

const html = nonce => `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">${STYLE}</style></head>
<body><div id="root"></div><script nonce="${nonce}">${SCRIPT}</script></body></html>`

// The Inbox webview: draws provider.inboxModel() and hands clicks back as messages.
class InboxView {
  constructor(provider, handlers) {
    this.provider = provider
    this.handlers = handlers
    this.view = undefined
  }

  get visible() {
    return this.view?.visible === true
  }

  resolveWebviewView(view) {
    this.view = view
    view.webview.options = { enableScripts: true }
    view.webview.html = html(crypto.randomBytes(16).toString('base64'))
    view.webview.onDidReceiveMessage(message => (message.type === 'ready' ? (this.post(), this.handlers.shown()) : this.handlers[message.type]?.(message)))
    view.onDidChangeVisibility(() => view.visible && this.handlers.shown())
    view.onDidDispose(() => (this.view = undefined))
  }

  post() {
    this.view?.webview.postMessage({ model: this.provider.inboxModel(), message: this.provider.message ?? '' })
  }
}

module.exports = { InboxView, html }
