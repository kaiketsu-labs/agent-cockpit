'use strict'

const crypto = require('crypto')

const STYLE = `
:root {
  --claude-accent: #e8825a;
  --claude-accent-soft: rgba(232, 130, 90, 0.14);
  --claude-accent-border: rgba(232, 130, 90, 0.38);
  --card-bg: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-sideBar-background)) 75%, rgba(255, 255, 255, 0.04));
  --card-border: color-mix(in srgb, var(--vscode-panel-border, #888) 45%, transparent);
  --card-hover: color-mix(in srgb, var(--vscode-list-hoverBackground) 80%, rgba(255, 255, 255, 0.03));
  --row-bg: color-mix(in srgb, var(--vscode-sideBar-background) 85%, rgba(0, 0, 0, 0.15));
  --radius-lg: 9px;
  --radius-md: 6px;
  --radius-sm: 4px;
}

* { box-sizing: border-box; }

html {
  scrollbar-gutter: stable;
}

body {
  padding: 0 0 18px;
  margin: 0;
  overflow-x: hidden;
  font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
  font-size: var(--vscode-font-size, 13px);
  line-height: 1.35;
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
  user-select: none;
}

button {
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  cursor: pointer;
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  line-height: 1;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
button:hover { background: var(--vscode-toolbar-hoverBackground); }

.icon-btn {
  width: 20px;
  height: 20px;
  padding: 0;
  border-radius: var(--radius-sm);
  color: var(--vscode-descriptionForeground);
  flex: none;
}
.icon-btn:hover {
  color: var(--vscode-foreground);
  background: var(--vscode-toolbar-hoverBackground);
}

/* Sticky Dashboard Header */
.bar {
  position: sticky;
  top: 0;
  z-index: 10;
  background: color-mix(in srgb, var(--vscode-sideBar-background) 88%, transparent);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  padding: 10px 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-bottom: 1px solid var(--card-border);
}

/* Top Hero / Stats Strip */
.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 7px;
  font-weight: 700;
  font-size: 0.92em;
  letter-spacing: 0.02em;
}
.brand-logo {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  background: linear-gradient(135deg, #e8825a 0%, #c96442 100%);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(232, 130, 90, 0.3);
}
.brand-logo svg { width: 12px; height: 12px; stroke: #fff; stroke-width: 1.8; fill: none; }

.hero-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.hero-actions .icon-btn {
  width: 24px;
  height: 24px;
}
.btn-primary {
  height: 24px;
  background: linear-gradient(135deg, #e8825a 0%, #d46b43 100%);
  color: #fff;
  font-weight: 600;
  font-size: 0.85em;
  padding: 0 9px;
  border-radius: 5px;
  box-shadow: 0 1px 4px rgba(232, 130, 90, 0.25);
}
.btn-primary:hover {
  background: linear-gradient(135deg, #f08e67 0%, #de744c 100%);
  color: #fff;
}
.btn-ghost {
  height: 24px;
  border: 1px solid var(--card-border);
  background: var(--card-bg);
  padding: 0 7px;
  border-radius: 5px;
  font-size: 0.85em;
  color: var(--vscode-descriptionForeground);
}
.btn-ghost:hover {
  color: var(--vscode-foreground);
  border-color: var(--claude-accent-border);
}

/* Search Input */
.search-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.search-wrap .search-ico {
  position: absolute;
  left: 8px;
  width: 13px;
  height: 13px;
  color: var(--vscode-descriptionForeground);
  pointer-events: none;
}
input[type="search"] {
  width: 100%;
  font: inherit;
  font-size: 0.92em;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--card-border));
  padding: 5px 8px 5px 27px;
  border-radius: var(--radius-md);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
input[type="search"]:focus {
  outline: none;
  border-color: var(--claude-accent);
  box-shadow: 0 0 0 2px var(--claude-accent-soft);
}

/* Segmented Filter Pills + Live Telemetry */
.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.segmented {
  display: inline-flex;
  background: color-mix(in srgb, var(--vscode-input-background) 70%, transparent);
  border: 1px solid var(--card-border);
  padding: 2px;
  border-radius: 7px;
  gap: 2px;
}
.chip {
  border-radius: 5px;
  padding: 2px 8px;
  font-size: 0.82em;
  font-weight: 500;
  color: var(--vscode-descriptionForeground);
  border: none;
}
.chip:hover { color: var(--vscode-foreground); background: transparent; }
.chip.on {
  background: var(--claude-accent-soft);
  color: var(--claude-accent);
  font-weight: 600;
}

.stats-pills {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.78em;
}
.stat-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 99px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  color: var(--vscode-descriptionForeground);
  font-weight: 600;
}
.stat-pill.working {
  color: var(--vscode-charts-blue, #3794ff);
  border-color: color-mix(in srgb, var(--vscode-charts-blue, #3794ff) 40%, transparent);
  background: color-mix(in srgb, var(--vscode-charts-blue, #3794ff) 12%, transparent);
}
.stat-pill.blocked {
  color: var(--vscode-charts-yellow, #cca700);
  border-color: color-mix(in srgb, var(--vscode-charts-yellow, #cca700) 45%, transparent);
  background: color-mix(in srgb, var(--vscode-charts-yellow, #cca700) 14%, transparent);
}
.stat-pill.clickable {
  cursor: pointer;
  user-select: none;
  transition: transform 0.1s ease, filter 0.12s ease;
}
.stat-pill.clickable:hover {
  filter: brightness(1.2);
  transform: translateY(-1px);
}
.stat-pill.clickable:active {
  transform: translateY(0);
}

/* Section Headers */
.section-block {
  padding: 0 8px;
  margin-top: 10px;
}
.section-block.drop {
  outline: 1.5px dashed var(--claude-accent);
  border-radius: var(--radius-lg);
  background: var(--claude-accent-soft);
}
.loose-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.loose-list > .session-card {
  background: var(--card-bg);
  border-color: var(--card-border);
  padding: 7px 9px;
}
h2 {
  margin: 0 0 6px;
  padding: 0 4px;
  height: 24px;
  min-height: 24px;
  font-size: 0.74em;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vscode-descriptionForeground);
  font-weight: 700;
  display: flex;
  gap: 6px;
  align-items: center;
  border-radius: var(--radius-md);
}
h2 .count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 16px;
  background: var(--claude-accent-soft);
  color: var(--claude-accent);
  border: 1px solid var(--claude-accent-border);
  border-radius: 99px;
  padding: 0 6px;
  font-size: 0.92em;
  line-height: 1;
  font-weight: 700;
}
h2.toggle {
  cursor: pointer;
  padding: 0 6px;
  margin: 0 0 6px;
  transition: background 0.12s ease, color 0.12s ease;
}
h2.toggle:hover {
  background: var(--vscode-list-hoverBackground);
  color: var(--vscode-foreground);
}


/* Folder & Ticket Cards */
.card {
  margin: 0 0 8px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.card:hover {
  border-color: color-mix(in srgb, var(--vscode-panel-border, #888) 75%, transparent);
}
.card.busy {
  border-color: color-mix(in srgb, var(--claude-accent) 42%, var(--card-border));
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.14);
}
.card.drop {
  outline: 1.5px dashed var(--claude-accent);
  background: var(--claude-accent-soft);
}

.card > .head {
  height: 34px;
  min-height: 34px;
  padding: 0 9px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  background: color-mix(in srgb, var(--vscode-sideBarSectionHeader-background, transparent) 60%, transparent);
  transition: background 0.12s ease;
}
.card > .head:hover {
  background: var(--card-hover);
}
.head .key {
  font-weight: 700;
  font-size: 0.95em;
  line-height: 1.2;
  letter-spacing: 0.01em;
  white-space: nowrap;
}
.head .key.ticket-pill {
  display: inline-flex;
  align-items: center;
  height: 18px;
  line-height: 1;
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 0.86em;
  padding: 0 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--vscode-charts-purple, #b180d7) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--vscode-charts-purple, #b180d7) 35%, transparent);
  color: var(--vscode-foreground);
}
.head .key.ticket-pill.t-indeterminate {
  background: color-mix(in srgb, var(--vscode-charts-blue, #3794ff) 15%, transparent);
  border-color: color-mix(in srgb, var(--vscode-charts-blue, #3794ff) 38%, transparent);
}
.head .key.ticket-pill.t-done {
  background: color-mix(in srgb, var(--vscode-charts-green, #89d185) 15%, transparent);
  border-color: color-mix(in srgb, var(--vscode-charts-green, #89d185) 38%, transparent);
}
.head .title {
  color: var(--vscode-descriptionForeground);
  font-size: 0.88em;
  line-height: 1.2;
}

.body {
  padding: 4px 6px 6px;
  border-top: 1px solid var(--card-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* Sub-section labels inside a card */
.sub {
  margin: 3px 4px 1px;
  font-size: 0.7em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--vscode-descriptionForeground);
  opacity: 0.75;
}

/* Session Agent Cards inside a Folder */
.session-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px;
  border-radius: var(--radius-md);
  background: var(--row-bg);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
  overflow: hidden;
}
.session-card:hover {
  background: var(--vscode-list-hoverBackground);
  border-color: var(--card-border);
}
.session-card.working {
  border-left: 2.5px solid var(--vscode-charts-blue, #3794ff);
}
.session-card.blocked {
  border-left: 3px solid var(--vscode-charts-yellow, #cca700);
  background: color-mix(in srgb, var(--vscode-charts-yellow, #cca700) 8%, var(--row-bg));
}
.session-card.failed {
  border-left: 3px solid var(--vscode-charts-red, #f14c4c);
  background: color-mix(in srgb, var(--vscode-charts-red, #f14c4c) 8%, var(--row-bg));
}
.session-card.spotlight-pulse {
  animation: cardHighlight 1.2s ease-out;
}
@keyframes cardHighlight {
  0% { box-shadow: 0 0 0 2px var(--vscode-charts-yellow, #cca700); }
  100% { box-shadow: 0 0 0 0 transparent; }
}
.session-card.drop-before {
  border-top: 2px solid var(--vscode-focusBorder, #007acc) !important;
}
.session-card.drop-after {
  border-bottom: 2px solid var(--vscode-focusBorder, #007acc) !important;
}

.session-top {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 20px;
  min-height: 20px;
}
.session-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  line-height: 20px;
}
.session-card.done .session-name {
  color: var(--vscode-descriptionForeground);
}

/* Cache TTL micro-bar & badge */
.cache-pill {
  display: inline-flex;
  align-items: center;
  height: 16px;
  line-height: 1;
  gap: 4px;
  font-size: 0.85em;
  font-family: var(--vscode-editor-font-family, monospace);
  color: var(--claude-accent);
  background: var(--claude-accent-soft);
  padding: 0 5px;
  border-radius: 4px;
}
.cache-bar {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  background: linear-gradient(90deg, var(--claude-accent), #f2a97e);
  opacity: 0.7;
  transition: width 0.4s linear;
}

/* PR Rows */
.pr-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  padding: 3px 8px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--vscode-charts-green, #89d185) 7%, var(--row-bg));
  border: 1px solid color-mix(in srgb, var(--vscode-charts-green, #89d185) 22%, transparent);
  cursor: pointer;
  font-size: 0.9em;
}
.pr-row.draft {
  background: var(--row-bg);
  border-color: var(--card-border);
}
.pr-row:hover {
  background: var(--vscode-list-hoverBackground);
}
.pr-row .ref {
  font-family: var(--vscode-editor-font-family, monospace);
  font-weight: 600;
  font-size: 0.92em;
  color: var(--vscode-charts-green, #89d185);
}
.pr-row.draft .ref { color: var(--vscode-descriptionForeground); }

/* Common utilities */
.grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta {
  color: var(--vscode-descriptionForeground);
  font-size: 0.84em;
  line-height: 1;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  flex: none;
}
.actions {
  display: none;
  gap: 2px;
  align-items: center;
  height: 20px;
  flex: none;
}
.head:hover .actions, .session-card:hover .actions { display: inline-flex; }
.head:hover .meta.hide-on-hover, .session-card:hover .meta.hide-on-hover { display: none; }

/* Icons */
.ico { width: 14px; height: 14px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.ico.folder { color: var(--claude-accent); fill: var(--claude-accent-soft); }
.ico.ticket { color: var(--vscode-charts-purple, #b180d7); }
.ico.ticket.t-new { color: var(--vscode-disabledForeground); }
.ico.ticket.t-indeterminate { color: var(--vscode-charts-blue, #3794ff); }
.ico.ticket.t-done { color: var(--vscode-charts-green, #89d185); }
.ico.pr { color: var(--vscode-charts-green, #89d185); }
.ico.pr.draft { color: var(--vscode-disabledForeground); }
.ico.chev { width: 14px; height: 14px; stroke-width: 1.8; color: var(--vscode-descriptionForeground); transition: transform 0.14s ease; }
.ico.chev.open { transform: rotate(90deg); }

/* Status Orbs for Sessions */
.status-orb {
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  position: relative;
}
.status-orb::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--vscode-disabledForeground);
}
.status-orb.working::before {
  background: var(--vscode-charts-blue, #3794ff);
  box-shadow: 0 0 6px var(--vscode-charts-blue, #3794ff);
  animation: pulse 1.3s ease-in-out infinite;
}
.status-orb.working::after {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px solid var(--vscode-charts-blue, #3794ff);
  border-top-color: transparent;
  animation: spin 1s linear infinite;
}
.status-orb.blocked::before {
  background: var(--vscode-charts-yellow, #cca700);
  box-shadow: 0 0 6px var(--vscode-charts-yellow, #cca700);
  animation: pulse 1.4s ease-in-out infinite;
}
.status-orb.failed::before {
  background: var(--vscode-charts-red, #f14c4c);
}
.status-orb.done::before {
  background: var(--vscode-charts-green, #89d185);
  opacity: 0.55;
}

@keyframes pulse { 50% { opacity: 0.35; } }
@keyframes spin { to { transform: rotate(360deg); } }

.badge {
  display: inline-flex;
  align-items: center;
  height: 18px;
  line-height: 1;
  font-size: 0.78em;
  font-weight: 600;
  padding: 0 6px;
  border-radius: 99px;
  border: 1px solid var(--card-border);
  background: color-mix(in srgb, var(--vscode-sideBar-background) 60%, transparent);
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
}
.badge.warn {
  border-color: color-mix(in srgb, var(--vscode-charts-yellow, #cca700) 50%, transparent);
  background: color-mix(in srgb, var(--vscode-charts-yellow, #cca700) 14%, transparent);
  color: var(--vscode-charts-yellow, #cca700);
}
.badge.working {
  border-color: color-mix(in srgb, var(--vscode-charts-blue, #3794ff) 50%, transparent);
  background: color-mix(in srgb, var(--vscode-charts-blue, #3794ff) 14%, transparent);
  color: var(--vscode-charts-blue, #3794ff);
}
.badge.pr {
  color: var(--vscode-charts-green, #89d185);
  border-color: color-mix(in srgb, var(--vscode-charts-green, #89d185) 45%, transparent);
  background: color-mix(in srgb, var(--vscode-charts-green, #89d185) 12%, transparent);
}

.empty-folder {
  padding: 8px 10px;
  text-align: center;
  font-size: 0.84em;
  color: var(--vscode-descriptionForeground);
  border: 1px dashed var(--card-border);
  border-radius: var(--radius-md);
  margin: 2px;
}

.empty-state {
  margin: 28px 14px;
  padding: 22px 16px;
  text-align: center;
  background: var(--card-bg);
  border: 1px dashed var(--card-border);
  border-radius: var(--radius-lg);
  color: var(--vscode-descriptionForeground);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.empty-state .empty-title {
  color: var(--vscode-foreground);
  font-weight: 600;
  font-size: 0.96em;
}
.empty-state .empty-actions {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.error {
  margin: 8px 8px 0;
  padding: 6px 10px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--vscode-errorForeground, #f14c4c) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--vscode-errorForeground, #f14c4c) 35%, transparent);
  color: var(--vscode-errorForeground);
  font-size: 0.86em;
}
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

const sessionRow = row => {
  const node = el('div', {
      id: 'session-' + row.id,
      class: 'session-card ' + row.state,
      draggable: 'true',
      title: row.name + ' · ' + row.stateLabel,
      onclick: () => send('attach', { id: row.id }),
      ondragstart: event => {
        event.dataTransfer.setData('text/plain', row.id)
        event.dataTransfer.effectAllowed = 'move'
      },
    },
    el('div', { class: 'session-top' },
      el('span', { class: 'status-orb ' + row.state }),
      el('span', { class: 'session-name' }, row.name),
      el('span', { class: 'meta hide-on-hover' },
        row.cache && el('span', { class: 'cache-pill', title: 'Prompt cache warm for ' + row.cache }, '⚡ ' + row.cache),
        el('span', {}, row.age ?? row.activity)),
      el('span', { class: 'actions' },
        iconBtn('edit', 'Rename session', () => send('rename', { id: row.id })),
        iconBtn('move', 'Move to folder…', () => send('moveToFolder', { id: row.id })),
        row.isHidden
          ? iconBtn('restore', 'Restore from history', () => send('show', { id: row.id }))
          : iconBtn('archive', 'Move to history', () => send('hide', { id: row.id })))),
    row.cachePct > 0 && el('div', { class: 'cache-bar', style: 'width:' + row.cachePct + '%' }))

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
    if (movedId && movedId !== row.id) {
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
  const byState = {}
  for (const row of card.sessions) byState[row.state] = (byState[row.state] ?? 0) + 1
  return Object.entries(byState).map(([state, n]) =>
    el('span', { class: 'badge' + (state === 'blocked' ? ' warn' : state === 'working' ? ' working' : ''), title: state }, n + ' ' + state))
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
    el('span', { class: 'meta hide-on-hover' }, counts(c), c.prs.length > 0 && el('span', { class: 'badge pr' }, '⎇ ' + c.prs.length)),
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
    el('div', { class: 'hero' },
      el('div', { class: 'brand' },
        el('span', { class: 'brand-logo' }, icon('logo')),
        el('span', {}, 'Claude Deck')),
      el('div', { class: 'hero-actions' },
        el('button', { class: 'btn-primary', title: 'Start a new Claude session', onclick: () => send('newSession') }, icon('plus'), 'Session'),
        el('button', { class: 'btn-ghost', title: 'Create a folder or add a ticket', onclick: () => send('newFolder') }, icon('newFolder'), 'Folder'),
        iconBtn('refresh', 'Refresh', () => send('refresh')))),
    el('div', { class: 'search-wrap' },
      el('span', { class: 'search-ico' }, icon('search')),
      search),
    el('div', { class: 'filter-bar' },
      el('div', { class: 'segmented' }, chip('all', 'All'), chip('active', 'Active'), chip('prs', 'PRs')),
      el('div', { id: 'stats', class: 'stats-pills' }))))
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
  const showLoose = looseSessions.length > 0
  if (folders.length > 0) {
    list.append(el('div', { class: 'section-block' }, folders.map(c => card(c, false))))
  }
  if (showLoose) {
    const looseBlock = section('Ungrouped', looseSessions.length, el('div', { class: 'loose-list' }, looseSessions.map(sessionRow)))
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
      el('div', { class: 'empty-title' }, q ? 'No matching sessions or folders' : 'Your Claude Deck is ready'),
      el('div', {}, q ? 'Try a different filter or search query.' : 'Start a Claude session or create a topic/ticket folder to organize your work.'),
      !q && el('div', { class: 'empty-actions' },
        el('button', { class: 'btn-primary', onclick: () => send('newSession') }, icon('plus'), 'New Session'),
        el('button', { class: 'btn-ghost', onclick: () => send('newFolder') }, icon('newFolder'), 'New Folder'))))
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
