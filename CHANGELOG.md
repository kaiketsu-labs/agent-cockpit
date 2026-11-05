# Changelog

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
