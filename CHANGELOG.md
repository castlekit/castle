# Changelog

All notable changes to Castle are documented here.

## 0.4.2 (2026-02-10)

### Fixed

- **Windows ESM path crash** — `bin/castle.js` now converts the tsx import path to a `file://` URL via `pathToFileURL`, fixing `ERR_UNSUPPORTED_ESM_URL_SCHEME` on Windows where `C:\...` paths are not valid ESM specifiers
- **Windows winget source error** — `install.ps1` now passes `--source winget` to avoid certificate failures from the Microsoft Store source
- **install.ps1 encoding** — replaced all Unicode characters (em dashes, box-drawing) with ASCII equivalents to prevent PowerShell parse errors on Windows
- **OpenClaw install command** — fixed broken PowerShell syntax for auto-installing OpenClaw during `castle setup`; now downloads script to temp file before executing with `-NoOnboard`
- **Silent install failures** — changed OpenClaw install from `stdio: "pipe"` to `stdio: "inherit"` so errors are visible, increased timeout to 5 minutes
- **Browser open on Windows** — uses native `start` command instead of the `open` npm package which caused a flashing CMD window

### Changed

- **Setup no longer exits when OpenClaw is missing** — declining or failing to install OpenClaw now continues setup with defaults instead of exiting; users can reconfigure later with `castle setup`
- **Smarter connection status** — UI now shows "Not Installed" (outline badge) when OpenClaw isn't configured, instead of the misleading "Disconnected" (red badge)

## 0.4.1 (2026-02-10)

### Added

- **Windows support** — new `install.ps1` PowerShell installer (`iwr -useb https://castlekit.com/install.ps1 | iex`) with Node.js auto-install via winget/Chocolatey/Scoop, version detection, PATH management, and Castle branding
- **Windows `castle setup`** — onboarding now handles Windows: port killing via `netstat`/`taskkill`, auto-start via Task Scheduler (`schtasks`), and OpenClaw install via PowerShell
- `install.sh` now shows the PowerShell command when run on an unsupported OS

### Fixed

- **EADDRINUSE during `castle setup`** — service manager (`launchctl`/`systemd`/`schtasks`) is now unloaded *before* killing processes on the port, preventing the old service from respawning and stealing the port

## 0.4.0 (2026-02-09)

### Changed

- **Pre-build for global installs** — `npm publish` now ships pre-built `.next/standalone/` and `.next/static/` artifacts via a `prepack` script, eliminating the "Build failed" error users hit when installing globally with `npm install -g`
- Next.js `output: "standalone"` mode enabled — produces a self-contained `server.js` with all dependencies bundled, no `node_modules` needed at runtime
- Service templates (launchd plist and systemd unit) now use standalone `server.js` directly instead of `next start` when pre-built output is detected
- Updated `files` array in `package.json` to include `.next/standalone/` and `.next/static/`

### Added

- Node.js 22+ version check at the start of `castle setup` — exits early with a clear message and install instructions if the user's Node version is too old
- Build error logging — when a dev/git-clone build fails, full output is written to `~/.castle/logs/build.log` and the last 20 lines are shown in the terminal
- Node.js compile cache (`module.enableCompileCache()`) in `bin/castle.js` for faster CLI startup (follows OpenClaw pattern)
- Build output check in `castle open` — warns if `.next/` doesn't exist and guides the user to run `castle setup`

### Fixed

- **"Build failed" during global install** — root cause was `npm run build` executing inside the read-only global `node_modules` directory without `devDependencies`. Now skipped entirely for pre-built packages.
- **Cross-platform native module crash** — standalone bundle no longer ships `node_modules/` (which contained platform-specific binaries like `better-sqlite3` from the build machine). Instead, `NODE_PATH` resolves packages from the npm-installed `node_modules/` with correct platform binaries.
- **Server bound to all interfaces** — standalone server now binds to `127.0.0.1` (localhost only) instead of `0.0.0.0`, ensuring Castle is not accessible from other machines on the network

## 0.3.2 (2026-02-09)

### Added

- Stress test suite (`npm run stress`) — 19 tests covering database under load, API route concurrency, and connection resilience
  - DB: concurrent inserts, FTS5 search/corruption/repair, 5000-message pagination, cascade deletes, WAL pressure
  - API: rate limiter accuracy, message size boundaries, concurrent search/channel ops, PUT idempotency
  - Connections: SSE subscriber storms, event deduplication, WebSocket reconnection, pending request cleanup

## 0.3.1 (2026-02-09)

### Added

- Full test suite — 201 tests across 20 files covering DB queries, API routes, hooks, gateway connection, SSE, and config
- Integration tests for chat lifecycle, gateway WebSocket, and failure recovery (real DB + real WS server, no mocks)
- CI pipeline with GitHub Actions: test, build, secret scanning, sensitive file detection, large file checks, version bump enforcement
- Open-source community files: LICENSE (MIT), SECURITY.md, CONTRIBUTING.md, issue templates, PR template
- npm Trusted Publishing via OIDC with provenance attestation
- Auto-tagging on merge to main
- Version bump check skips CI/docs-only PRs

### Fixed

- FTS5 desync causing SQLITE_CONSTRAINT_PRIMARYKEY on message send (orphaned FTS entries after channel deletion)
- FTS auto-repair in updateMessage/deleteMessage paths
- Typing indicator pixel shift — reuses MessageBubble directly via `isTypingIndicator` prop for zero layout shift
- Avatar status dot missing during typing indicator display
- Session context not resolving in chat

### Changed

- Structured dev logging across full stack (Gateway RPC, SSE lifecycle, API routes, DB operations, hooks)
- npm publish switched from token-based auth to OIDC Trusted Publishing (no tokens to manage)
- Upgraded npm in release job for Trusted Publishing compatibility (requires npm >= 11.5.1)

## 0.3.0 (2026-02-09)

### Added

- Universal Search v1 with Cmd+K shortcut and platform-aware hint
- Full-text search across all messages with SQLite FTS5
- Search result navigation with persistent message highlighting
- Recent searches persisted in SQLite (moved from localStorage)
- Anchor-based message loading for search result deep-linking
- Skeleton loading states across chat, agents, and channel list
- Timestamp tooltips with always-dark styling
- Shared date-utils for standardized date formatting

### Fixed

- Channel deletion not syncing FTS5 index
- Scroll jump on load-more
- Keyboard navigation in search dialog
- Search highlight not updating for same-channel results
- Channel page not rendering with search params
- FOUC on chat message layout
- Security, scalability, and robustness issues from PR review

## 0.2.2 (2026-02-08)

### Fixed

- Replace all Link components with button + router.push to fix client-side navigation issues

## 0.2.1 (2026-02-08)

### Fixed

- Thinking indicator persistence across channel navigation

## 0.2.0 (2026-02-08)

### Added

- Chat V1: local chat with SQLite persistence, real-time streaming, and full UI
- Live agent status and user presence tracking
- Channel archive/restore with two-step permanent delete
- User avatar upload with settings page and display name
- Channel origin markers and date separators
- Tooltip toggle setting
- Twemoji and GFM markdown support in messages
- Settings page with display name used in chat headers

### Fixed

- SSRF in avatar proxy, path traversal hardening, FTS5 query sanitization
- API security: CSRF protection, rate limiting, path traversal guards, localhost enforcement
- Infinite scroll yanking to bottom when older messages load
- Scroll jump on message send caused by container resize
- Input disabled after agent response
- Scroll-to-bottom on load and first-message jump
- Typing indicator flow
- FOUC and chat loader centering
- Dialog warning in chat UI

### Changed

- Redesigned chat messages: removed bubbles, left-aligned all, grouped by sender
- Moved user menu to sidebar
- DB safety hardening with last-channel persistence

## 0.1.6 (2026-02-08)

### Added

- Device authentication and identity management
- Avatar management system

### Changed

- Security hardening across the codebase

## 0.1.5 (2026-02-07)

### Fixed

- tsx resolution — resolve from package dir, not cwd

### Changed

- Document release process in README

## 0.1.4 (2026-02-07)

### Added

- `castle update` command

### Fixed

- Version skip check — use grep instead of node pipe
- Skip install and setup when already up to date

## 0.1.2 (2026-02-07)

### Added

- Full Castle scaffold with design system, CLI, installer, and UI kit
- OpenClaw Gateway integration
- CLI onboarding with Castle blue theme and auto server start
- Production server with persistent service and auto-start
- ASCII castle banner with gradient installer
- App icon

### Fixed

- Onboarding server startup hanging and spinner visibility
- CLI shebang and install banner escape issue
- Install script fallback to run castle directly instead of npx
- Hardcoded values, dead code, and service reliability in onboarding

### Changed

- Security, reliability, and input validation hardening across codebase
- Show agents as offline/unreachable when Gateway disconnects
- Move @types/ws to dependencies
