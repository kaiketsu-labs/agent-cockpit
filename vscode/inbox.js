'use strict'

let vscode
try {
  vscode = require('vscode')
} catch {}
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const MEDIA_DIR = path.join(__dirname, 'media')

const html = (options = {}) => {
  const nonce = typeof options === 'string' ? options : (options.nonce || crypto.randomBytes(16).toString('base64'))
  const { cspSource, scriptUri, styleUri } = typeof options === 'object' ? options : {}

  if (scriptUri && styleUri && cspSource) {
    return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${styleUri}"></head>
<body><div id="root"></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`
  }

  // Fallback for tests or direct calls: read from media directory
  const style = fs.readFileSync(path.join(MEDIA_DIR, 'inbox.css'), 'utf8')
  const script = fs.readFileSync(path.join(MEDIA_DIR, 'inbox.js'), 'utf8')
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">${style}</style></head>
<body><div id="root"></div><script nonce="${nonce}">${script}</script></body></html>`
}

// The Inbox webview: draws provider.inboxModel() and hands clicks back as messages.
class InboxView {
  constructor(provider, handlers, extensionUri) {
    this.provider = provider
    this.handlers = handlers
    this.extensionUri = extensionUri
    this.view = undefined
  }

  get visible() {
    return this.view?.visible === true
  }

  resolveWebviewView(view) {
    this.view = view
    const mediaDir = this.extensionUri
      ? vscode.Uri.joinPath(this.extensionUri, 'media')
      : vscode.Uri.file(MEDIA_DIR)
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaDir],
    }
    const nonce = crypto.randomBytes(16).toString('base64')
    const scriptUri = view.webview.asWebviewUri(vscode.Uri.joinPath(mediaDir, 'inbox.js'))
    const styleUri = view.webview.asWebviewUri(vscode.Uri.joinPath(mediaDir, 'inbox.css'))
    view.webview.html = html({
      nonce,
      cspSource: view.webview.cspSource,
      scriptUri,
      styleUri,
    })
    view.webview.onDidReceiveMessage(message =>
      message.type === 'ready' ? (this.post(), this.handlers.shown()) : this.handlers[message.type]?.(message),
    )
    view.onDidChangeVisibility(() => view.visible && this.handlers.shown())
    view.onDidDispose(() => (this.view = undefined))
  }

  post() {
    this.view?.webview.postMessage({ model: this.provider.inboxModel(), message: this.provider.message ?? '' })
  }
}

module.exports = { InboxView, html }
