import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const { version } = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8'),
) as { version: string };

// The content script is injected with chrome.scripting.executeScript({files}), which runs
// classic scripts only, so it is bundled as a single IIFE next to the service worker.
export default defineConfig({
  publicDir: false,
  define: {
    __EXTENSION_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: false,
    minify: false,
    target: 'chrome116',
    lib: {
      entry: resolve(import.meta.dirname, 'src/content/index.ts'),
      formats: ['iife'],
      name: 'hypruseBrowserContent',
      fileName: () => 'content.js',
    },
  },
});
