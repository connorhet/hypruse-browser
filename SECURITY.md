# Security policy

## Supported versions

Fixes go to the latest release and to `main`.

## Reporting a vulnerability

Report it privately through GitHub's private vulnerability reporting:

```text
https://github.com/IlyasKhallouki/hypruse-browser/security/advisories/new
```

Please do not open a public issue. Include the version, the steps to reproduce, what an attacker
gains, and a fix if you have one. Use made-up page content and neutral sites; never send a real
browsing profile, cookie or password.

## What the extension promises

- It never reads or sends the value of a form field or an editable region.
- It never types into a password field or a field whose `autocomplete` marks it as a payment
  card or password field.
- It never acts on a snapshot that is not the latest one of its page, or on an element that has
  left the page.
- It opens only `http` and `https` URLs and does not run in incognito windows.
- It exchanges messages with one native host, `dev.hypruse.browser`, and makes no network
  requests of its own.

A way to break any of these is a vulnerability. So is a way for a web page to send requests to
the extension, read snapshots, or learn that the extension is installed, and any way for code
other than the extension's own native host to drive it.

## Trust boundaries

Chrome starts the native host only for the extensions named in the `allowed_origins` of the
host's manifest. The public key in `manifest.json` pins this extension's ID, and the private key
stays outside this repository.

Behind the host, hypruse listens on a unix socket in `$XDG_RUNTIME_DIR/hypruse/` that only your
user can open. Anyone who can open it can already control your desktop through hypruse, so the
socket is the boundary. The extension does not try to tell one local client from another.

Web pages can change what a snapshot contains: they choose their own labels and can dress up an
element to look like something else. A program that acts on snapshots should treat names as
text from the page, not as instructions.

Bugs in Chrome itself are out of scope, but a report is still welcome when the extension could
reduce the harm.
