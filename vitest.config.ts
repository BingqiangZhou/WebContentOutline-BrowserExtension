import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['checks/**/*.test.mjs'],
    globals: false,
    testTimeout: 10000,
  },
});
