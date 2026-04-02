# Fork Sync Guide

This repository is a product fork of the original single-chat project at `grinev/opencode-telegram-bot`.

## Last Synced Upstream

- Permanent git remote: `upstream` -> `https://github.com/grinev/opencode-telegram-bot.git`
- Upstream repo: `https://github.com/grinev/opencode-telegram-bot`
- Upstream branch: `main`
- Last reviewed upstream head: `f64c077` (`chore(release): v0.14.1`, 2026-04-01)
- Original fork point for this threaded fork: `21da71b` (`chore(release): v0.11.0`)

## Fork Rules

- Keep this fork optimized for group topics, thread-scoped sessions, and DM control flows.
- Prefer selective ports over blind merges.
- Keep upstream-compatible naming and UX when the change is low-risk.
- Skip or rewrite upstream changes that assume one global chat/session lane.

## Upstream Changes Intentionally Ported

- `c301481` setup wizard now asks for `OPENCODE_SERVER_USERNAME` and `OPENCODE_SERVER_PASSWORD`
- `d7a114f` dotenv startup noise suppression via quiet config loading
- `d758af7` startup logging improvements, including resolved config path logging
- `2b63c5b` alignment toward upstream command naming by exposing `/abort`
- `dce630c` partial port: `/start` is now always allowed during active interactions and performs scope-aware recovery
- `c192aee` partial port: model favorites/recent lists are filtered against the current provider catalog and invalid stored scoped models are reconciled
- `19e0644` reviewed during sync; localized text remains compatible with this fork
- `eb56b66` adapted port: interactive/status/setup messages now default to raw Telegram text while assistant completions still fall back safely from MarkdownV2 to plain text
- `c72e7cb` ported: French locale support added and registered in locale validation/docs
- `6afb300` + `6619532` ported: scoped pinned messages now show cumulative session cost
- `f3b3fc6` + `a337370` + `54a493d` ported: `/commands` pagination, filtering, and clearer execution UX
- `fcd2273` + `e4eb83e` + `b414bf3` covered by fork commit `c97baf6`: upstream tool-call streaming/reply formatting changes were already adapted into this fork's topic-aware streaming flow
- `84c300d` adapted port: subagent work status now renders inside the parent topic's tool stream without breaking topic-scoped delivery
- `afacade` ported: `/sessions` now requests root sessions only, avoiding child-session entries in the control-lane picker
- `6ff8fa1` ported: Markdown fallback retries now strip stale parse options, and Markdown splitting avoids trailing escape characters at chunk boundaries
- `b6efc31` ported: todowrite formatter now separates the header from todo items with a blank line
- `5632f2f` + `d888b16` adapted port: MarkdownV2 retries now attempt reserved-character escaping first and final assistant sends preserve raw-text fallback content instead of leaking converted Telegram markdown
- `dae0f82` partial port: assistant stream pacing is now configurable via `RESPONSE_STREAM_THROTTLE_MS`

## Upstream Changes Intentionally Adapted

- `/stop` -> `/abort`
  - This fork exposes `/abort` as the sole public command to match upstream.
- `/start` reset behavior
  - Upstream clears global project/session/pinned state.
  - This fork only clears non-topic scopes; topic-bound sessions remain attached to their thread.
- Model reconciliation
  - Upstream validates one stored model.
  - This fork validates all scoped stored models.
- Scheduled tasks
  - Upstream stores and delivers scheduled tasks in a single global lane.
  - This fork stores explicit delivery targets and creates a dedicated per-project scheduled topic in forum groups.
- Response and tool-call streaming
  - Upstream streams through the current single chat lane.
  - This fork routes streamed edits by `sessionId -> topic binding`, keeping unrelated topics isolated.
- Subagent activity cards
  - Upstream renders subagent work in one active chat lane.
  - This fork maps child-session activity back into the parent topic thread and replaces prior subagent cards in-place.

## Upstream Changes Intentionally Skipped

- Release-only bumps (`v0.11.1`, `v0.11.2`)
- Release-only bumps (`v0.11.3`, `v0.11.4`)
- Release-only bumps (`v0.12.0`, `v0.12.1`, `v0.13.0`)
- Release-only bumps (`v0.13.1`, `v0.13.2`) reviewed; runtime changes were already covered by fork commit `c97baf6`
- Release-only bumps (`v0.14.0`, `v0.14.1`) reviewed; runtime fixes were selectively ported/adapted above
- Upstream docs that frame forum topics / parallel thread workflows as out of scope
- Repo template churn that does not affect runtime behavior
- `d392778` upstream concept docs link back to this fork; not needed in fork docs
- `939ebb7` reviewed; already covered in this fork because streamed interim sends already use `disable_notification: true`
- `239e512` skipped: this fork still needs its custom final-delivery path for topic-aware ordering, TTS replies, and keyboard refresh behavior
- `dae0f82` generic Telegram API retry wrapper skipped: this fork already routes outbound calls through a topic-aware rate limiter with `retry_after` handling, plus scoped live-stream retry scheduling

## Sync Workflow

1. Refresh upstream refs with `git fetch upstream main`.
2. Compare `upstream/main` against the last reviewed commit in this file.
3. Classify changes into:
   - safe cherry-pick / direct port
   - manual adaptation required
   - skip for fork-specific reasons
4. Use `git log --oneline <last-reviewed>..upstream/main` and `git diff --stat <last-reviewed>..upstream/main` for the initial review.
5. Port runtime/setup fixes first.
6. Port command/state changes only after checking thread-scoped behavior in:
   - `src/bot/commands/`
   - `src/bot/index.ts`
   - `src/interaction/`
   - `src/model/manager.ts`
   - `src/pinned/manager.ts`
   - `src/settings/manager.ts`
7. Run `npm run build`, `npm run lint`, and `npm test`.
8. Update this file:
   - reviewed upstream head
   - what was ported
   - what was skipped and why

## Remote Notes

- Prefer the permanent `upstream` remote for all future fork-sync checks; do not create ad-hoc temporary refs when the remote is available.
- Standard refresh command: `git fetch upstream main`
- Inspect new upstream commits with `git log --oneline HEAD..upstream/main` only when you specifically want to compare your current branch tip to upstream; for sync review, compare from the recorded `Last reviewed upstream head` instead.
- If the remote is ever missing in a fresh clone, restore it with `git remote add upstream https://github.com/grinev/opencode-telegram-bot.git`

## Known Conflict Hotspots

- `src/bot/commands/start.ts`
- `src/bot/index.ts`
- `src/interaction/guard.ts`
- `src/interaction/manager.ts`
- `src/model/manager.ts`
- `src/pinned/manager.ts`
- `README.md`, `PRODUCT.md`, `AGENTS.md`

## Publishing Notes

- Document the fork-specific behavior first; do not claim parity with the original project.
- Keep source-based setup instructions accurate until a distinct package name is chosen.
