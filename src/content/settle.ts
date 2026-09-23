export const QUIET_MS = 250;

// Resolves once the DOM has had no structural or text change for QUIET_MS, or after maxMs,
// whichever comes first. Attribute changes are ignored: players and animations change
// attributes all the time and would keep a page from ever settling.
export function settle(doc: Document, maxMs: number, quietMs = QUIET_MS): Promise<void> {
  if (maxMs <= 0) return Promise.resolve();
  const view = doc.defaultView;
  if (!view) return Promise.resolve();
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      observer.disconnect();
      clearTimeout(quiet);
      clearTimeout(deadline);
      resolve();
    };
    const observer = new view.MutationObserver(() => {
      clearTimeout(quiet);
      quiet = setTimeout(finish, quietMs);
    });
    observer.observe(doc, { subtree: true, childList: true, characterData: true });
    quiet = setTimeout(finish, quietMs);
    const deadline = setTimeout(finish, maxMs);
  });
}
