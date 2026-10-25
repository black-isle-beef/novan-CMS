import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  resolve: {
    tsconfigPaths: true,
  },
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/tools/novan-cli',
  plugins: [],
  test: {
    name: 'novan-cli',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/tools/novan-cli',
      provider: 'v8' as const,
    },
  },
}));
