import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/tools/migrate',
  plugins: [nxViteTsPaths()],
  test: {
    name: 'migrate',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['*.spec.ts'],
    reporters: ['default'],
  },
}));
