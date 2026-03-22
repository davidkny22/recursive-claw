import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    fileParallelism: false,
    coverage: {
      include: ['src/**/*.ts'],
    },
  },
});
