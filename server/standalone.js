import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createFsMiddleware } from './middleware.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const distDir = path.join(appRoot, 'dist');
const api = createFsMiddleware();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api')) {
    req.url = url.pathname.slice(4) + url.search;
    api(req, res, () => {
      res.statusCode = 404;
      res.end('not found');
    });
    return;
  }
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.join(distDir, rel);
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(distDir, 'index.html');
  if (!fs.existsSync(target)) {
    res.statusCode = 404;
    res.end('build missing: run `npm run build` first');
    return;
  }
  res.setHeader('content-type', MIME[path.extname(target)] ?? 'application/octet-stream');
  fs.createReadStream(target).pipe(res);
});

const port = Number(process.env.PORT ?? 5273);
server.listen(port, () => console.log(`swcad serving on http://localhost:${port}`));
