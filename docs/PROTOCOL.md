# Protocol version 1

This is the contract between the extension and hypruse's `browser-host`. The extension answers
requests and sends events. It never acts on its own. `src/shared/protocol.ts` holds the same
rules as code.

## Transport

Chrome starts the host when the extension calls
`chrome.runtime.connectNative("dev.hypruse.browser")`. Messages travel over the host's stdin and
stdout as Chrome native messaging frames: a 4-byte little-endian length, then that many bytes of
UTF-8 JSON. Chrome caps a message from the host at 1 MB.

The host's manifest must allow exactly one origin:

```
chrome-extension://pcfjlemgcbbpppclachnobhnnnahpgoj/
```

The extension ID is fixed by the public key in `manifest.json`, so the manifest can name it
before the extension is loaded.

## Messages

```
extension -> host, once per connection, before anything else
  {"hello": {"protocol": 1, "extension": "0.1.0", "browser": "Chrome/151.0.7922.137"}}

host -> extension
  {"id": "h17", "op": "page.snapshot", "args": {...}}

extension -> host
  {"id": "h17", "ok": true, "result": {...}}
  {"id": "h17", "ok": false, "error": {"code": "stale_snapshot", "message": "..."}}
  {"event": "tabs.changed", "data": {"reason": "activated", "tab_id": 12}}
```

`browser` is the browser's brand and full version, read from client hints: `Chrome/...`,
`Brave/...` or `Chromium/...`. Without client hints the extension falls back to the user agent
string, which Chrome reduces to `Chrome/151.0.0.0`.

Every request gets exactly one response, and the response carries the request's `id`. Requests
run concurrently, so responses can arrive in a different order from the requests.

A message without a non-empty string `id` is not a request. The extension cannot answer it, so it
drops it.

`args` may be left out for operations that take none. The extension checks arguments strictly:
a missing argument, a wrong type, a value out of range or an argument name the operation does
not know is `bad_request`. So a typo such as `tabId` fails loudly instead of falling back to a
default.

## Errors

| code              | meaning                                                                |
| ----------------- | ---------------------------------------------------------------------- |
| `bad_request`     | unknown op, or arguments that do not validate                          |
| `not_found`       | no such tab, no such element in the snapshot, or no page to go back to |
| `stale_snapshot`  | the snapshot is not the latest of its page, or the page has moved on   |
| `refused`         | the extension will not do this (a password field, a `file:` URL)       |
| `restricted_page` | Chrome does not let extensions script this page                        |
| `timeout`         | the operation did not finish in time                                   |
| `internal`        | anything else; the message says what went wrong                        |

`no_extension` belongs to the host, which uses it when no extension is attached. The extension
never sends it.

A request times out after 20 seconds, plus `settle_ms` for a snapshot.

## Operations

| op              | args                                                      | result                      |
| --------------- | --------------------------------------------------------- | --------------------------- |
| `ping`          | none                                                      | `{extension}`               |
| `tabs.list`     | none                                                      | `{tabs}`                    |
| `tabs.activate` | `tab_id`                                                  | `{}`                        |
| `tabs.open`     | `url`, `where`: `new`, `current` or `background`          | `{tab_id}`                  |
| `tabs.close`    | `tab_id`                                                  | `{}`                        |
| `tabs.history`  | `tab_id`, `direction`: `back` or `forward`                | `{}`                        |
| `page.snapshot` | `tab_id`?, `max`? (120), `settle_ms`? (0)                 | a snapshot, below           |
| `page.click`    | `snapshot_id`, `element_id`                               | `{}`                        |
| `page.type`     | `snapshot_id`, `element_id`, `text`, `submit`? (false)    | `{}`                        |
| `page.scroll`   | `tab_id`?, `direction`: `up`, `down`, `top` or `bottom`   | `{scroll_y, scroll_height}` |
| `files.stage`   | `upload_id`, `index`, `total`, `data` (base64)            | `{received}`                |
| `page.upload`   | `snapshot_id`, `element_id`, `upload_id`, `name`, `type`? | `{name, size, files}`       |
| `sites.top`     | none                                                      | `{sites}`                   |

A `?` marks an optional argument, with its default in parentheses. `max` runs from 1 to 1000
and `settle_ms` from 0 to 10000. Without `tab_id`, page operations use the active tab of the
last focused window. Each entry of `tabs` is `{id, window_id, index, active, audible, title,
url}` and each entry of `sites` is `{url, host, title}`.

### Tabs

`tabs.list` covers every normal window, the focused window first (the last focused one when
Chrome itself is not focused), and each window's tabs in order. Popup and app windows are left
out. Incognito windows are invisible to the extension.

`tabs.activate` activates the tab and focuses its window.

`tabs.open` accepts absolute `http:` and `https:` URLs only. Anything else, including a string
that is not a URL at all, is `refused`. `new` opens an active tab in the last focused normal
window. `current` navigates that window's active tab and returns its id. `background` opens a tab
that is not activated in that window, and does not focus the window, so the browser does not
ask the desktop for focus. When no normal window exists, each opens a new window, unfocused
for `background`.

`tabs.history` answers `not_found` when there is no page to go back or forward to.

`sites.top` returns Chrome's most visited sites, `http` and `https` only, with the host name of
each.

## Snapshots

```
{snapshot_id: "s7-k3x9", tab_id, url, title,
 headings: "up to 400 characters of h1..h3 text in document order",
 viewport: {width, height, dpr, scroll_y, scroll_height},
 elements: [{id: "e3", role, name, kind, rect: [x, y, w, h], in_view,
             list?: {group: "g2", index: 1, size: 20}}]}
```

Snapshot ids are opaque. They look like `s7-k3x9`: a counter and a tag chosen at random each
time the service worker starts. Ids never repeat across restarts, so an id from before a restart
is answered with `stale_snapshot` and never mistaken for a newer snapshot of another tab.

Element ids (`e1`, `e2` and so on) and group ids (`g1`, `g2`) are numbered within one
snapshot. `rect` is in CSS pixels, relative to the viewport, rounded to whole pixels. `headings`
holds the text of the visible `h1`, `h2` and `h3` elements, separated by a vertical bar.

### Frames

A snapshot covers the page's frames too, cross-origin ones included: a sign-in or payment form
is often one. Each frame is its own document with its own numbering, so an element of frame 12
is `f12.e3` and its list group `f12.g1`; `page.click` and `page.type` send such an id to that
frame. The top document reports where it shows each frame and the URL it asked the frame to
load, and a frame's elements are moved into the top viewport by that box. They are in view only
when the box is. A frame whose box cannot be matched, such as a frame inside a frame, keeps its
elements out of view with rects relative to itself. Frames with no area are left out. Elements
are ordered top in view, frames in view (by where their box is), then the rest, before the cut
to `max`. A frame the browser will not script is left out rather than failing the snapshot,
and the top frame's `headings`, `title` and `url` describe the page.

### What counts as an element

1. Candidates are `a[href]`, `button`, `input` except `type=hidden`, `textarea`, `select`,
   `summary`, editable elements (`contenteditable` other than `false`), elements with an
   `onclick` attribute, and the ARIA roles button, link, tab, menuitem, option, checkbox,
   radio, switch, searchbox, combobox and textbox.
2. A second pass walks the page for elements whose computed `cursor` is `pointer` and that have
   no candidate ancestor. It reads the style of at most 400 elements that have a box and are in
   or near the viewport.
3. An element is visible when its box has a width and height above 0, it is not
   `visibility: hidden` or `display: none`, and it is not inside `aria-hidden="true"` or `inert`.
4. An element is `in_view` when its box meets the viewport. In view elements must also pass a
   hit test: `document.elementFromPoint` at the centre of the visible part of the box must return
   the element, something inside it, or an ancestor with no other candidate in between. Covered
   elements (under a cookie banner, say) fail it.
5. Elements within one viewport below the visible area are kept too, after the in view ones.
   Anything further away, above the viewport, or off to the side is left out.
6. An element without a name is left out.

### Names

The name is the first non-empty value of: `aria-labelledby` text, `aria-label`, `alt`, `title`,
the associated `<label>`, `placeholder`, the `value` attribute of a submit, reset or button
input (a label the page author wrote), then the visible text. When all of those are empty, the
name comes from the `aria-label`, `alt` or `title` of the first descendant that has one.
Whitespace is collapsed and the name is cut at 60 characters.

Values are never read. Inputs, textareas, selects and editable regions never fall back to their
text, and label or heading text skips any field inside it.

### Roles and kinds

`role` is the first token of the `role` attribute, or the role implied by the tag (`link` for
`a[href]`, `textbox` for a text input, `generic` for a plain element). `kind` is one of:

| kind     | for                                                         |
| -------- | ----------------------------------------------------------- |
| `link`   | role `link`                                                 |
| `button` | role `button`                                               |
| `search` | a search box, see below                                     |
| `input`  | text fields, comboboxes, selects, sliders, editable regions |
| `tab`    | role `tab`                                                  |
| `option` | roles `option`, `menuitem` and `treeitem`                   |
| `toggle` | checkboxes, radios and switches                             |
| `other`  | everything else, including `cursor: pointer` elements       |

An element is a search box when its role is `searchbox`, or when it is a text input or textarea
that has role `combobox`, sits inside a `form[role=search]` (or any `[role=search]` or `<search>`
element), or has "search" in its `name`, `id`, `placeholder`, `aria-label` or `data-testid`,
ignoring case.

### Lists

The extension numbers repeated items so that "click the second video" works without site
specific code. For each element, it walks from the element up through at most 8 ancestors and stops
at the first node whose parent has at least 3 children with the same signature (tag name plus
sorted class list). That node is the item and its parent is the group. Two refinements stop this
from firing on things that only look alike:

- At least 3 of those siblings must be visible and share one shape (the list of their
  children's tag names). Component frameworks give every element inside a component the same
  class. YouTube marks a video's title block and channel block alike, and without this rule they
  would count as a list of two.
- Table and grid cells (`td`, `th`, roles `cell`, `gridcell`, `columnheader` and `rowheader`)
  are never items, so a button in a track row is numbered by its row.

`body` and `html` are never groups. Items are numbered from 1 in visual order (top to bottom,
then left to right) among the group's visible items, including visible items out of range.
Every element inside an item carries `list: {group, index, size}`.

On a virtualized list, such as a long Spotify playlist, only the rows the page has rendered are
numbered, so `index` 1 is the first rendered row and not necessarily the first track.

### Order, duplicates and the cut

In view elements come first in visual order, then the elements below. Outside lists, elements
with the same role and name are merged into the first in visual order. Inside lists, they are
kept, because "the menu of the third video" needs them. The list is then cut to `max`.

### Settling

With `settle_ms` above 0, the snapshot first waits until the page has gone 250 ms without a DOM
change, or until `settle_ms` has passed, whichever comes first. Only structural and text changes
count. Attribute changes are ignored, because video players and animations change attributes
constantly and would keep a page from ever settling.

The wait ends at the first 250 ms of quiet. If a page stays silent for longer than that before
its results arrive (a slow search request with no loading indicator), the snapshot can be taken
before the results appear. A caller that needs the results can snapshot again.

## Acting on a snapshot

The content script keeps, for each document, only the latest snapshot id and weak references to
its elements. `page.click` and `page.type` answer `stale_snapshot` when:

- the snapshot id is unknown, or its tab has closed;
- the snapshot is not the latest one taken of that document;
- the page has navigated since the snapshot (a change of URL other than the fragment, as
  single page apps do);
- the element is no longer in the document.

An element id that the snapshot never had is `not_found`. The extension never clicks whatever
happens to be at the old position.

### Click

When the element's centre is outside the viewport, the element is first scrolled to the middle
with `scrollIntoView({block: "center"})`. Then `pointerover`, `pointerenter`, `mouseover`,
`pointerdown`, `mousedown`, focus, `pointerup` and `mouseup` are dispatched at the element's
centre, bubbling and composed, followed by `element.click()`.

### Type

The target is the element itself when it takes text, otherwise the first field inside it (a
combobox wrapper around its input, say). The extension refuses (`refused`):

- `input[type=password]`;
- any field whose `autocomplete` contains a token starting with `cc-`, or the token
  `current-password` or `new-password`;
- disabled or read-only fields;
- inputs that do not take text (checkboxes, file inputs and the like) and elements that are not
  fields.

Otherwise it focuses the field, selects the existing text, sets the new value through the native
setter of `HTMLInputElement` or `HTMLTextAreaElement` so frameworks like React notice, and
dispatches an `input` event (`InputEvent`, `inputType: "insertText"`) and a `change` event. An
editable region gets `document.execCommand("insertText")`.

With `submit`, it then dispatches `keydown`, `keypress` and `keyup` for Enter (key `Enter`, code
`Enter`, keyCode 13). If the `keydown` was not cancelled and the field is in a form, it calls
`form.requestSubmit()`.

### Upload

`page.upload` puts one file in a file field, as choosing it in the browser's picker would. No
picker opens: Chrome shows one only for a real click. The file arrives first, in chunks, with
`files.stage`, since Chrome caps a message from the host at 1 MB: each chunk is a piece of the
file's base64, `index` counts from 0 to `total - 1` (at most 64), and the chunks may arrive in any
order. The service worker keeps them for 60 seconds, at most 4 uploads at once and 10 MB per
upload (`refused` past either), and `page.upload` takes them: an upload with a chunk missing is
`bad_request`, and an `upload_id` already taken or never staged is `not_found`.

The target is the element itself when it is an `input[type=file]`, the field a `<label>` names, or
the first file field inside the element (a drop zone around a hidden input). Anything else, or a
disabled field, is `refused`. The field's files are replaced by the one file, then `input` and
`change` are dispatched, so the page's own handlers see it. Which files may be sent is the host's
decision: the extension sends what it is given.

### Scroll

The target is the nearest scrollable ancestor of the element at the centre of the viewport
(computed `overflow-y` of `auto`, `scroll` or `overlay`, and `scrollHeight` more than
`clientHeight + 1`), or `document.scrollingElement` when there is none. Spotify scrolls a panel,
not the document. `down` and `up` move by 80 percent of the target's `clientHeight`, smoothly;
`top` and `bottom` go to the ends. The result reports where the scroll is heading, clamped to
the ends, and the target's `scrollHeight`.

## Injection

Page operations run in the tab's top frame, in the extension's isolated world, and a snapshot
in every frame as well, through `executeScript` with `allFrames`. The service
worker calls the page agent with `chrome.scripting.executeScript({func})`. When the document has
no agent yet, it first injects `content.js` with `executeScript({files})`. The agent installs
itself once per document, and injecting again keeps the existing one along with its latest
snapshot.

Operations on pages that Chrome will not let an extension script answer `restricted_page`:
`chrome://`, `chrome-extension://` and other browser schemes, `about:` pages other than
`about:blank`, the Chrome Web Store, and `file:` URLs when the extension has no file access.
An element of a frame that has navigated or gone since its snapshot is `stale_snapshot`.

## Events

`tabs.changed` carries `reason` (`activated`, `created`, `removed` or `updated`) and `tab_id`.
`updated` is sent only when a load completes or the title changes. The extension sends at most
one event per tab every 200 ms. The first change goes out at once, and changes inside the window
collapse into one trailing event with the latest reason, so the last state of a burst always
arrives.

Events go to the current connection only. Nothing is queued while the host is disconnected.

## Connection

The service worker connects at top level, on browser startup and on install, and sends the
hello first on every new connection. When the port drops, it retries after 1, 2, 5, 15 and then
every 30 seconds. A connection that lasted 10 seconds, or that received a message, resets the
backoff. A `chrome.alarms` alarm every 30 seconds reconnects if nothing is connected. A missing
host is normal (hypruse may not be installed yet) and never raises an error.

An open native messaging port keeps a Manifest V3 service worker alive, so while the host runs,
the worker, its snapshot ids and its connection stay up.
