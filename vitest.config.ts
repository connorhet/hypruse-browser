import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __EXTENSION_VERSION__: JSON.stringify('0.0.0-test'),
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
});
