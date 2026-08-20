import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createFsMiddleware } from './server/middleware.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const r = (p: string) => path.resolve(root, p);

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'swcad-fs-api',
      configureServer(server) {
        server.middlewares.use('/api', createFsMiddleware());
      },
      configurePreviewServer(server) {
        server.middlewares.use('/api', createFsMiddleware());
      },
    },
  ],
  resolve: {
    alias: {
      '@core': r('src/core'),
      '@editor': r('src/editor'),
      '@sheet': r('src/sheet'),
      '@component': r('src/component'),
      '@ui': r('src/ui'),
    },
  },
  server: { port: 5273 },
});
