import type { IncomingMessage, ServerResponse } from 'node:http';

export interface FsMiddlewareOptions {
  appRoot?: string;
}

export type FsMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void | Promise<void>;

export function createFsMiddleware(options?: FsMiddlewareOptions): FsMiddleware;
