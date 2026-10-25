import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  resolve: {
    tsconfigPaths: true,
  },
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/tools/migrate',
  plugins: [],
  test: {
    name: 'migrate',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['*.spec.ts'],
    reporters: ['default'],
  },
}));
