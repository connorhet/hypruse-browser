import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The service worker: one ES module, loaded by Chrome as `background.js`.
// The content script has its own config because it must be a classic script.
export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
    target: 'chrome116',
    lib: {
      entry: resolve(import.meta.dirname, 'src/background/index.ts'),
      formats: ['es'],
      fileName: () => 'background.js',
    },
  },
});
