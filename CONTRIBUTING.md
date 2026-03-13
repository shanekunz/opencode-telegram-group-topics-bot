# Contributing

Thanks for contributing to OpenCode Telegram Group Topics Bot.

## Before You Start Work

### What can go directly to PR

You can pick up and submit a PR without prior approval when the change is low-risk and aligned with the current direction, for example:

- Bug fixes (`fix`)
- Improvements to existing features that do not fundamentally change how they work
- Small UX polish and technical cleanup

### When to open an issue first

If you want to add a **new feature**, open an issue first and describe:

- The problem and the proposed solution
- User impact and expected behavior
- Any alternatives considered

Please wait for maintainer confirmation before implementation. We use this step to ensure:

- The idea fits the project concept
- The same feature is not already in progress
- The implementation direction is agreed in advance

When in doubt whether a change is an "improvement" or a "new feature", open an issue first.

## Commit Message Convention

This project uses Conventional Commits for release note automation.

Format:

`<type>(<scope>)?: <description>`

Optional major marker:

`feat(<scope>)!: <description>`

Examples:

- `feat(keyboard): add robot icon for model button`
- `fix(model): handle model IDs with colons`
- `docs(readme): clarify setup steps`
- `feat(ui)!: redesign keyboard layout`

## Branch Naming Convention

Use the following branch name format:

`<type>/<short-description>`

Examples:

- `feat/model-selector`
- `fix/session-timeout`
- `docs/contributing-branch-rules`

Rules:

- Use lowercase letters and kebab-case only.
- Use only `a-z`, `0-9`, and `-`.
- Keep `short-description` concise (2-6 words).
- Recommended `type` values: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `ci`, `build`, `perf`, `hotfix`.

## Release Notes Mapping

Release notes are generated automatically from commit subjects.

Sections are shown only when they contain at least one item.

- `Major Changes`: `feat!` only
- `Changes`: `feat`, `perf`
- `Fixes`: `fix`, `revert`
- `Technical`: `refactor`, `chore`, `ci`, `build`, `test`, `style`
- `Documentation`: `docs`
- `Other`: any subject that does not match the rules above

Additional rules:

- Merge commits are excluded.
- `chore(release): vX.Y.Z` commits are excluded.
- Notes use cleaned human-readable text (no commit hashes).

## Version Bump Checklist

This repository is currently in `0.x`, but version bumps still follow a strict SemVer-style policy:

- **Patch (`0.1.1 -> 0.1.2`)**
  - Bug fixes (`fix`)
  - Small UX polish that does not change expected behavior
  - Internal/release/docs/test/ci updates (`chore`, `refactor`, `docs`, `test`, `ci`, `build`, `style`)
  - No breaking changes

- **Minor (`0.1.1 -> 0.2.0`)**
  - New user-visible functionality (`feat`)
  - Meaningful behavior improvements users are expected to notice
  - Additive changes that remain backward-compatible

- **Major (`0.x -> 1.0.0` or `1.x -> 2.0.0`)**
  - Breaking changes that require migration
  - Contract/API changes that can break existing setups
  - Reserved for explicitly planned compatibility breaks

Quick decision rule:

- Mostly fixes/infra/docs -> patch
- At least one clear user-facing feature -> minor
- Any intentional breakage -> major

## Pull Requests

### One change per PR

Each PR must contain exactly one logically complete change: one feature, one fix, one refactor, etc.

If your contribution covers multiple unrelated things, split it into separate PRs. This keeps reviews focused, makes history readable, and ensures release notes stay accurate.

### PR title format

The PR title is used as the commit message after squash merge and becomes a line in the release notes. It must follow the same Conventional Commits format as regular commit messages:

`<type>(<scope>)?: <description>`

Examples:

- `feat(keyboard): add robot icon for model button`
- `fix(model): handle model IDs with colons`
- `docs(readme): clarify setup steps`
- `feat(ui)!: redesign keyboard layout`

A PR with a title that does not follow this format will not be merged until it is corrected.

### OS-sensitive changes

Treat a change as OS-sensitive if it touches OS interaction, including:

- Process management and signals
- Path handling and separators
- Shell command invocation or quoting
- Filesystem behavior and permissions

For OS-sensitive changes, verify behavior on Linux, macOS, and Windows. If you could not test one or more platforms directly, state that explicitly in the PR description and describe known limitations.

### PR Quality Bar

**MUST**

- PR title must follow the Conventional Commits format (see above).
- PR must contain exactly one logically complete change (see above).
- At PR creation time, the branch must be rebased on the latest `main` and be conflict-free.
- CI must pass (`npm run lint`, `npm run build`, `npm test`).
- Changes must be compatible with Linux, macOS, and Windows (our supported platforms).
- If a feature affects OS interaction (processes, paths, shell commands, filesystem behavior), it must work correctly on all three supported platforms.

**SHOULD**

- Add or update tests for behavior changes.
- Describe user-visible impact in 1-2 lines in the PR description.
- If you could not test on one or more supported platforms locally, mention it in the PR description.
