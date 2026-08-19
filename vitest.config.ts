import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const r = (p: string) => path.resolve(root, p);

export default defineConfig({
  resolve: {
    alias: {
      '@core': r('src/core'),
      '@editor': r('src/editor'),
      '@sheet': r('src/sheet'),
      '@component': r('src/component'),
      '@ui': r('src/ui'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
