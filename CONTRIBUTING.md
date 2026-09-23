# Contributing

This extension can read and operate every page a person has open. A small change that is easy
to review has a much better chance of being accepted than a broad rewrite.

## Setup

You need Node.js 22 or newer and pnpm 10.33.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium   # once, for the end to end tests
pnpm check                              # format, lint, typecheck, unit tests, build
pnpm build && pnpm test:e2e             # end to end tests in Playwright's Chromium
```

`pnpm check` is the gate. It must pass before every commit, exactly as CI runs it. Run the end
to end tests before you open a pull request; CI runs them too.

## Rules

- The protocol is shared with hypruse's `browser-host` and its Python client. A change to a
  message, an operation, an argument or an error code needs a matching change to
  [docs/PROTOCOL.md](docs/PROTOCOL.md) and to hypruse, and usually a new protocol version.
- Never read the value of a field or send it anywhere. Snapshots carry names only.
- Never type into password or payment fields, and never act on a snapshot that is not the
  latest one of its page.
- Talk to Chrome through the interfaces in `src/background/chrome.ts` and to layout through
  `src/content/geometry.ts`, so the logic stays testable without a browser.
- Validate everything that arrives from the host before acting on it.
- A new permission needs an issue first and a clear reason. The same goes for a new runtime
  dependency; the extension has one, zod.
- Add tests that fail without your change: a unit test for logic, an end to end test for anything
  that depends on a real page.
- Keep the extension ID stable. Do not change the `key` in `manifest.json`.

## Commits and pull requests

Commits follow the conventional style (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`) with
a short imperative subject and a body that says why. Keep them small. Do not put credentials,
private URLs or generated attribution lines in commit messages.

Public issues and fixtures should use neutral example sites and made-up page content. Report
security problems privately, as [SECURITY.md](SECURITY.md) describes.
