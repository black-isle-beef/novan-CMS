import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig(() => ({
  resolve: {
    tsconfigPaths: true,
  },
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/libs/api/design-systems',
  // SWC replaces Vite's transformer so Nest decorators emit the metadata DI relies on.
  plugins: [swc.vite({ tsconfigFile: './tsconfig.spec.json' })],
  test: {
    name: 'api-design-systems',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    passWithNoTests: true,
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../coverage/libs/api/design-systems',
      provider: 'v8' as const,
    },
  },
}));
