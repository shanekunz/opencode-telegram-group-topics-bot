# Fork Sync Guide

This repository is a product fork of the original single-chat project at `grinev/opencode-telegram-bot`.

## Last Synced Upstream

- Upstream repo: `https://github.com/grinev/opencode-telegram-bot`
- Upstream branch: `main`
- Last reviewed upstream head: `efd8f55` (`chore(release): v0.11.2`, 2026-03-10)
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

## Upstream Changes Intentionally Adapted

- `/stop` -> `/abort`
  - This fork exposes `/abort` as the sole public command to match upstream.
- `/start` reset behavior
  - Upstream clears global project/session/pinned state.
  - This fork only clears non-topic scopes; topic-bound sessions remain attached to their thread.
- Model reconciliation
  - Upstream validates one stored model.
  - This fork validates all scoped stored models.

## Upstream Changes Intentionally Skipped

- Release-only bumps (`v0.11.1`, `v0.11.2`)
- Upstream docs that frame forum topics / parallel thread workflows as out of scope
- Repo template churn that does not affect runtime behavior

## Sync Workflow

1. Compare upstream `main` against the last reviewed commit in this file.
2. Classify changes into:
   - safe cherry-pick / direct port
   - manual adaptation required
   - skip for fork-specific reasons
3. Port runtime/setup fixes first.
4. Port command/state changes only after checking thread-scoped behavior in:
   - `src/bot/commands/`
   - `src/bot/index.ts`
   - `src/interaction/`
   - `src/model/manager.ts`
   - `src/pinned/manager.ts`
   - `src/settings/manager.ts`
5. Run `npm run build`, `npm run lint`, and `npm test`.
6. Update this file:
   - reviewed upstream head
   - what was ported
   - what was skipped and why

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
