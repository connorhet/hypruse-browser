# hypruse browser

A Chrome extension that lets local programs see and operate the browser. Through
[hypruse](https://github.com/IlyasKhallouki/hypruse) it can list and switch tabs, open and close
them, go back and forward, read what on a page can be clicked or typed into, and then click,
type and scroll.

Chrome shows almost nothing to the Linux accessibility bus unless it is started with a flag, so
desktop tools like hypruse cannot see inside a page. hypruse reaches pages through this
extension instead. Its first user is hyprsay, a voice assistant, where "open YouTube, search lofi,
play the second one" turns into a handful of requests to this extension.

The extension has no user interface and never acts on its own. It answers requests from one
native messaging host, `dev.hypruse.browser`, which hypruse provides.

```
 your program -> hypruse.browser client -> $XDG_RUNTIME_DIR/hypruse/browser.sock (owner only)
                                                     |
                                     hypruse browser-host (started by Chrome)
                                                     |  native messaging, stdio
                                            hypruse-browser extension
```

## What a page looks like to a program

A snapshot lists the named things on a page that a person could click or type into, in reading
order, with repeated items numbered:

```json
{
  "snapshot_id": "s3-k3x9",
  "tab_id": 1183,
  "url": "https://www.youtube.com/results?search_query=lofi+hip+hop",
  "title": "lofi hip hop - YouTube",
  "headings": "",
  "viewport": { "width": 1280, "height": 900, "dpr": 1, "scroll_y": 0, "scroll_height": 6119 },
  "elements": [
    {
      "id": "e8",
      "role": "combobox",
      "name": "Search",
      "kind": "search",
      "rect": [339, 16, 491, 24],
      "in_view": true
    },
    {
      "id": "e30",
      "role": "link",
      "name": "1 A.M Study Session [lofi hip hop] 1 hour, 1 minute",
      "kind": "link",
      "rect": [612, 520, 411, 26],
      "in_view": true,
      "list": { "group": "g3", "index": 2, "size": 19 }
    }
  ]
}
```

"Play the second one" is then `page.click` with that snapshot id and `e30`. The numbering comes
from the page's structure, so it works on sites the extension has never heard of.
[docs/PROTOCOL.md](docs/PROTOCOL.md) has every operation, every error and the exact rules for
what counts as an element.

## Install

The extension is loaded unpacked. It is not on the Chrome Web Store.

1. Build it (Node.js 22 or newer, pnpm 10.33):

   ```sh
   pnpm install --frozen-lockfile
   pnpm build
   ```

2. Open `chrome://extensions`, turn on Developer mode, choose "Load unpacked" and pick the
   `dist` folder.
3. Install the native host with hypruse: `hypruse browser install`. It registers
   `dev.hypruse.browser` for each Chromium browser it finds. `hypruse doctor` reports whether
   the host is installed and whether the extension is connected.

The manifest asks for Chrome 116 or newer. Until the host is installed, the extension keeps
retrying quietly in the background.

### The extension ID

The ID is always `pcfjlemgcbbpppclachnobhnnnahpgoj`, wherever the extension is loaded from,
because `manifest.json` carries its public key. That is how the host's manifest can allow this
extension before it is loaded. The private key is not in this repository and is not needed to
build or load the extension. `pnpm build` recomputes the ID from the key and fails if it
changes.

## Permissions

| permission         | why                                                                         |
| ------------------ | --------------------------------------------------------------------------- |
| `nativeMessaging`  | to talk to `dev.hypruse.browser`                                            |
| `tabs`             | to list tabs with their titles and URLs, and to switch, open and close them |
| `scripting`        | to inject the content script that reads and operates a page                 |
| `<all_urls>` hosts | so that script can run on whatever site is open                             |
| `topSites`         | so "open YouTube" goes to the address you actually visit                    |
| `alarms`           | to reconnect to the host if the connection drops                            |

The extension does not run in incognito windows.

## Safety

These rules hold even when a client is careless:

- The value of a field is never read or sent, only its name. That covers inputs, textareas,
  selects and editable regions.
- It refuses to type into password fields and payment card fields.
- A click or a type names a snapshot. If the page has changed since, the answer is
  `stale_snapshot`, never a click on whatever is now at that spot.
- It opens only `http` and `https` URLs, and it cannot touch `chrome://` pages or the Web Store.
- It talks to its own native host and nothing else. It makes no network requests and has no
  telemetry.

The boundary is the host's socket, which only your user can open. Anyone who can reach it can
already drive the whole desktop through hypruse. [SECURITY.md](SECURITY.md) says how to report a
problem.

## Development

```sh
pnpm check       # format, lint, typecheck, unit tests, build: the gate for every commit
pnpm test:e2e    # Playwright end to end tests in Chromium (run pnpm build first)
pnpm dev         # rebuild the service worker on change
```

The end to end tests use Playwright's own Chromium (`pnpm exec playwright install chromium`)
with a throwaway profile, because branded Google Chrome ignores `--load-extension`. They never
touch your browser profile. They run headless; set `HEADED=1` to watch. One test registers a
stand-in native host for that profile and checks the full round trip through Chrome.

To try a request by hand, open the service worker's console from `chrome://extensions` and run:

```js
await __hypruseDispatch({ id: 'x', op: 'page.snapshot', args: {} });
```

The code is small files with one job each:

- `src/shared/protocol.ts`: message types and the request validator.
- `src/background/`: the service worker. `port.ts` keeps the native connection, `dispatch.ts`
  turns a message into exactly one response, `tabs.ts`, `sites.ts` and `page.ts` handle the
  operations, and `inject.ts` runs page operations in the tab.
- `src/content/`: the content script. `snapshot.ts` reads a page with the help of `names.ts`,
  `roles.ts`, `lists.ts` and `visibility.ts`; `click.ts`, `type.ts` and `scroll.ts` act on it.
  Layout goes through `geometry.ts`, so the unit tests run in jsdom without a layout engine.

[CONTRIBUTING.md](CONTRIBUTING.md) has the rest.

## Limits

- Only the top frame of a page is read. Content inside iframes and closed shadow roots is
  invisible, and open shadow roots are not searched yet.
- On a virtualized list, only the rows the page has rendered are numbered.
- A settling snapshot waits for the page to go quiet, not for results to arrive, so a slow
  search with no loading indicator may need a second snapshot.
- Some sites react to trusted input events only. The extension dispatches events from script, so
  those sites may ignore a click or a keystroke.

## License

MIT. See [LICENSE](LICENSE).
