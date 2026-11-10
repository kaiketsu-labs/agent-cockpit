# Changelog

## [0.7.0](https://github.com/kaiketsu-labs/agent-cockpit/compare/v0.6.7...v0.7.0) (2026-11-10)


### Features

* add on-demand briefing session (Sonnet) ([#53](https://github.com/kaiketsu-labs/agent-cockpit/issues/53)) ([7d0b790](https://github.com/kaiketsu-labs/agent-cockpit/commit/7d0b7905b387d0fb928be8a2f8e67343656409f6))
* **keep-warm:** persist keep-warm across turns with sliding window and distinct badge ([#50](https://github.com/kaiketsu-labs/agent-cockpit/issues/50)) ([f7f6805](https://github.com/kaiketsu-labs/agent-cockpit/commit/f7f68058df63a67d69e8729fdd8c5c3046f85b57))
* prefill session prompt with folder and story title on new session ([#54](https://github.com/kaiketsu-labs/agent-cockpit/issues/54)) ([6a966a6](https://github.com/kaiketsu-labs/agent-cockpit/commit/6a966a65ec085e920f6207b41694bf88f5c430a3))


### Bug Fixes

* prioritize tracker summaries, lock session folders, and sort history by recency ([#52](https://github.com/kaiketsu-labs/agent-cockpit/issues/52)) ([e159efd](https://github.com/kaiketsu-labs/agent-cockpit/commit/e159efd94f4631146076758ffdfa08c0deb0e51e))

## [0.6.7](https://github.com/kaiketsu-labs/agent-cockpit/compare/v0.6.6...v0.6.7) (2026-11-07)


### Bug Fixes

* **vscode:** resolve defaultRepo repo object in inboxModel to avoid crashing webview refresh ([#48](https://github.com/kaiketsu-labs/agent-cockpit/issues/48)) ([eac14d9](https://github.com/kaiketsu-labs/agent-cockpit/commit/eac14d93b90b996c4ce866ab8458ab97939fedc9))

## [0.6.6](https://github.com/kaiketsu-labs/agent-cockpit/compare/v0.6.5...v0.6.6) (2026-11-07)


### Bug Fixes

* **vscode:** smooth cache countdown and extract webview assets with CI validation ([#45](https://github.com/kaiketsu-labs/agent-cockpit/issues/45)) ([4c0b021](https://github.com/kaiketsu-labs/agent-cockpit/commit/4c0b021b87ad9d6129c564dfd6afa209e1a1441e))

## [0.6.5](https://github.com/kaiketsu-labs/agent-cockpit/compare/v0.6.4...v0.6.5) (2026-11-06)


### Bug Fixes

* **vscode:** smooth 1-second prompt cache countdown badge (remove redundant progress bar) ([#43](https://github.com/kaiketsu-labs/agent-cockpit/issues/43)) ([ce3c358](https://github.com/kaiketsu-labs/agent-cockpit/commit/ce3c3580842893b2fe4441bbd5e2dded7de3c19e))

## [0.6.4](https://github.com/kaiketsu-labs/agent-cockpit/compare/v0.6.3...v0.6.4) (2026-11-06)


### Bug Fixes

* **plugin:** declare all hook callbacks as top-level functions in register.tsx ([#42](https://github.com/kaiketsu-labs/agent-cockpit/issues/42)) ([530b51e](https://github.com/kaiketsu-labs/agent-cockpit/commit/530b51e5e7a43f35b06aaaa9b974510b6d1cb589))
* **vscode:** remove redundant settings pill and prevent status pill wrapping ([#40](https://github.com/kaiketsu-labs/agent-cockpit/issues/40)) ([f331fb1](https://github.com/kaiketsu-labs/agent-cockpit/commit/f331fb1f287c26141707377c67af206dc0f60e0f))

## [0.6.3](https://github.com/kaiketsu-labs/agent-cockpit/compare/v0.6.2...v0.6.3) (2026-11-06)


### Bug Fixes

* **plugin:** mark legacy fallback catch callback async in register.tsx ([#38](https://github.com/kaiketsu-labs/agent-cockpit/issues/38)) ([bc308ad](https://github.com/kaiketsu-labs/agent-cockpit/commit/bc308adeccf80f92229d8935e926f02be5866163))

## [0.6.2](https://github.com/kaiketsu-labs/agent-cockpit/compare/v0.6.1...v0.6.2) (2026-11-06)


### Bug Fixes

* match org-wide PR search results for ticket folders ([#35](https://github.com/kaiketsu-labs/agent-cockpit/issues/35)) ([deda043](https://github.com/kaiketsu-labs/agent-cockpit/commit/deda043ac455305e65ae9ab1be05d2858a827790))
* resolve enterprise host for org PR queries and preserve cache on ended sessions ([#37](https://github.com/kaiketsu-labs/agent-cockpit/issues/37)) ([3a9c53d](https://github.com/kaiketsu-labs/agent-cockpit/commit/3a9c53d27491c12e1a511eee9761bc8c8be6e14d))

## [0.6.1](https://github.com/kaiketsu-labs/agent-cockpit/compare/v0.6.0...v0.6.1) (2026-11-06)


### Bug Fixes

* search PRs on the remote's GitHub Enterprise host ([#34](https://github.com/kaiketsu-labs/agent-cockpit/issues/34)) ([bb5ad8c](https://github.com/kaiketsu-labs/agent-cockpit/commit/bb5ad8cbcdb5d9bfe25d346f85bace8704e51900))
* **vscode:** anchor cache pill on hover and allow dragging sessions out of folders ([#32](https://github.com/kaiketsu-labs/agent-cockpit/issues/32)) ([42009a9](https://github.com/kaiketsu-labs/agent-cockpit/commit/42009a9552db448851d89c848af3cd08b6f92076))

## [0.6.0](https://github.com/kaiketsu-labs/agent-cockpit/compare/v0.5.4...v0.6.0) (2026-11-05)


### Features

* **vscode:** add configurable GitHub PR scope with gear icon and QuickPick ([#30](https://github.com/kaiketsu-labs/agent-cockpit/issues/30)) ([2d2f8ca](https://github.com/kaiketsu-labs/agent-cockpit/commit/2d2f8ca9e22172f18bbb9d98752c8287d1e6108f))

## [0.5.4](https://github.com/kaiketsu-labs/agent-cockpit/compare/v0.5.3...v0.5.4) (2026-11-05)


### Bug Fixes

* **vscode:** scope PR search and issue lookup to local repository ([#28](https://github.com/kaiketsu-labs/agent-cockpit/issues/28)) ([9de98e2](https://github.com/kaiketsu-labs/agent-cockpit/commit/9de98e2192896fb5bf6863d53c3f61db911c1529))

## [0.5.3](https://github.com/kaiketsu-labs/agent-cockpit/compare/v0.5.2...v0.5.3) (2026-11-05)


### Bug Fixes

* use absolute raw URLs and PNG for marketplace images ([#25](https://github.com/kaiketsu-labs/agent-cockpit/issues/25)) ([0efcbd4](https://github.com/kaiketsu-labs/agent-cockpit/commit/0efcbd48f12fa24c017204412f692d3a101bfd38))

## [0.5.2](https://github.com/kaiketsu-labs/agent-cockpit/compare/v0.5.1...v0.5.2) (2026-11-05)


### Bug Fixes

* **vscode:** use valid VS Code Marketplace categories ([#23](https://github.com/kaiketsu-labs/agent-cockpit/issues/23)) ([30e8f79](https://github.com/kaiketsu-labs/agent-cockpit/commit/30e8f79f8aaebd282f52e3997833569c55a98336))

## [0.5.1](https://github.com/kaiketsu-labs/agent-cockpit/compare/v0.5.0...v0.5.1) (2026-11-05)


### Bug Fixes

* **vscode:** add GalleryFlags Public and metadata to VSIX manifest ([#19](https://github.com/kaiketsu-labs/agent-cockpit/issues/19)) ([7d14487](https://github.com/kaiketsu-labs/agent-cockpit/commit/7d1448739154211c5e05835692903be8ab6932f7))

## [0.5.0](https://github.com/kaiketsu-labs/agent-cockpit/compare/v0.4.3...v0.5.0) (2026-11-05)


### Features

* rebrand project to Agent Cockpit ([#17](https://github.com/kaiketsu-labs/agent-cockpit/issues/17)) ([ee080de](https://github.com/kaiketsu-labs/agent-cockpit/commit/ee080deaf5356a41e1d610610564759c3038f4dc))
* **vscode:** close terminal tab when archiving a session ([#15](https://github.com/kaiketsu-labs/agent-cockpit/issues/15)) ([e5cce19](https://github.com/kaiketsu-labs/agent-cockpit/commit/e5cce1948ff1ab7f15e45237bed3ee750d21ed87))

## [0.4.3](https://github.com/kaiketsu-labs/claude-deck/compare/v0.4.2...v0.4.3) (2026-11-05)


### Bug Fixes

* **vscode:** rename package identifier to kaiketsu-claude-deck to avoid marketplace collision ([9946ccc](https://github.com/kaiketsu-labs/claude-deck/commit/9946cccffc76fff2bd6c72c04c887cac04bd2a79))

## [0.4.2](https://github.com/kaiketsu-labs/claude-deck/compare/v0.4.1...v0.4.2) (2026-11-05)


### Bug Fixes

* **vscode:** ensure publisher ID is kaiketsu-labs ([ec46d35](https://github.com/kaiketsu-labs/claude-deck/commit/ec46d359f86461196f7091d41680f3846dcb3af6))

## [0.4.1](https://github.com/kaiketsu-labs/claude-deck/compare/v0.4.0...v0.4.1) (2026-11-05)


### Bug Fixes

* **vscode:** use correct Marketplace publisher ID KaiketsuLabs ([258ecdd](https://github.com/kaiketsu-labs/claude-deck/commit/258ecdd40ba2b6870ce4d49710177e2034a7804f))

## [0.4.0](https://github.com/kaiketsu-labs/claude-deck/compare/v0.3.0...v0.4.0) (2026-11-05)


### Features

* optimize installation for AI coding agents and add one-line installer ([#8](https://github.com/kaiketsu-labs/claude-deck/issues/8)) ([72678b7](https://github.com/kaiketsu-labs/claude-deck/commit/72678b7a96fc9ad5e3323eb6ee8b94ca88903939))
* **vscode:** configure marketplace metadata, icon asset, and publishing workflow ([#11](https://github.com/kaiketsu-labs/claude-deck/issues/11)) ([f3bdeec](https://github.com/kaiketsu-labs/claude-deck/commit/f3bdeecba7400e3004f32371ecf6223a6e6c7ec3))


### Bug Fixes

* restrict folder subtitles to ticket folders only ([#7](https://github.com/kaiketsu-labs/claude-deck/issues/7)) ([3737bff](https://github.com/kaiketsu-labs/claude-deck/commit/3737bff82f263800e73a06039300e9cf993db617))

## [0.3.0](https://github.com/kaiketsu-labs/claude-deck/compare/v0.2.0...v0.3.0) (2026-11-05)


### Features

* add drag-and-drop session reordering and in-place waiting focus ([#4](https://github.com/kaiketsu-labs/claude-deck/issues/4)) ([695adca](https://github.com/kaiketsu-labs/claude-deck/commit/695adca6882f7c58e18335b89be584c2f60af288))
* add prompt cache keepalive and context cost tracking ([#1](https://github.com/kaiketsu-labs/claude-deck/issues/1)) ([d1ad0a7](https://github.com/kaiketsu-labs/claude-deck/commit/d1ad0a7a80b74af889cddfa3ad3e1e42843978d3))
* streamline inbox header and folder badges for compact sidebar ([#6](https://github.com/kaiketsu-labs/claude-deck/issues/6)) ([78e1deb](https://github.com/kaiketsu-labs/claude-deck/commit/78e1deb48fb64628d4da5577d6467cc0aa4a7fb8))


### Bug Fixes

* stabilize session naming and focus on overarching goal ([#3](https://github.com/kaiketsu-labs/claude-deck/issues/3)) ([e5a1f77](https://github.com/kaiketsu-labs/claude-deck/commit/e5a1f7799d0bcb408bbf20e551c624cfa5c0e9d2))

## [0.2.0](https://github.com/kaiketsu-labs/claude-deck/compare/v0.1.0...v0.2.0) (2026-11-05)


### Features

* allow dragging sessions onto tickets to assign or unassign them ([#2](https://github.com/kaiketsu-labs/claude-deck/issues/2)) ([813ce39](https://github.com/kaiketsu-labs/claude-deck/commit/813ce39e0f8f2f362049ae5624551bd9e680c384))
* detect ticket from worktree path and encourage proactive name_session calls ([#5](https://github.com/kaiketsu-labs/claude-deck/issues/5)) ([09081bf](https://github.com/kaiketsu-labs/claude-deck/commit/09081bfd2350652a524d33d7ecb2a215dd395cd8))
* order unticketed sessions in history by age ([#9](https://github.com/kaiketsu-labs/claude-deck/issues/9)) ([7e8a15f](https://github.com/kaiketsu-labs/claude-deck/commit/7e8a15f5c416cc16725c6a423951ea50cb7035ed))
* recommend review and investigate-only in start-task from assignee and issue type ([#12](https://github.com/kaiketsu-labs/claude-deck/issues/12)) ([4bf4332](https://github.com/kaiketsu-labs/claude-deck/commit/4bf43321b8089fc4ebcaddb3d032282f95001867))
* replace the sidebar trees with an Inbox webview ([#13](https://github.com/kaiketsu-labs/claude-deck/issues/13)) ([5906f8a](https://github.com/kaiketsu-labs/claude-deck/commit/5906f8a26ac3c708266d006321bf40a279c9400b))
* topic folders, silent auto-naming, terminal tab sync & UI overhaul ([#15](https://github.com/kaiketsu-labs/claude-deck/issues/15)) ([dc68721](https://github.com/kaiketsu-labs/claude-deck/commit/dc687217588a2e6af03b20bcd2e7c2084883ad5f))


### Bug Fixes

* **cleanup-worktrees:** include live interactive sessions when checking active worktrees ([#6](https://github.com/kaiketsu-labs/claude-deck/issues/6)) ([0b68ae8](https://github.com/kaiketsu-labs/claude-deck/commit/0b68ae83b61ff91d6eb72cef2e383620efed320d))
* support naming unticketed sessions, serialize session writes, and speed up macOS pid lookup ([#8](https://github.com/kaiketsu-labs/claude-deck/issues/8)) ([5cf66b2](https://github.com/kaiketsu-labs/claude-deck/commit/5cf66b2d6661922cac431afa49f68608dc6aac10))
* unassign a session by dropping it on empty space ([#10](https://github.com/kaiketsu-labs/claude-deck/issues/10)) ([8071b6a](https://github.com/kaiketsu-labs/claude-deck/commit/8071b6a1fc94f4c8ba13855574abdd6772904122))
