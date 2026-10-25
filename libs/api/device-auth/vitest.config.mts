import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig(() => ({
  resolve: {
    tsconfigPaths: true,
  },
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/libs/api/device-auth',
  // SWC replaces Vite's transformer so Nest decorators emit the metadata DI relies on.
  plugins: [swc.vite({ tsconfigFile: './tsconfig.spec.json' })],
  test: {
    name: 'api-device-auth',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    passWithNoTests: true,
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../coverage/libs/api/device-auth',
      provider: 'v8' as const,
    },
  },
}));
