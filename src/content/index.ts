import { createAgent } from './agent';
import { browserGeometry } from './geometry';

// Injected with chrome.scripting.executeScript({files}) before page operations. Installing is
// guarded, so injecting again into the same document keeps its agent and its latest snapshot;
// an agent from an older build of the extension is replaced.
if (globalThis.__hypruseBrowser?.version !== __EXTENSION_VERSION__) {
  globalThis.__hypruseBrowser = createAgent(
    document,
    browserGeometry(window),
    __EXTENSION_VERSION__,
  );
}
