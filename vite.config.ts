import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS === 'true' ? '/gha-preview/' : '/',
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
