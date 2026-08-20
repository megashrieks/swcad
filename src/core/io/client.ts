import type { LoadedLibrary } from '../model/types';

export interface ProjectPayload {
  root: string;
  project: {
    schemaVersion: number;
    title: string;
    author: string;
    revision: string;
    grid: Record<string, unknown>;
    page: unknown;
    legend: unknown;
    sheets: string[];
    [key: string]: unknown;
  };
  sheets: Record<string, unknown>;
  libraries: LoadedLibrary[];
}

export interface ComponentTemplate {
  id: string;
  name: string;
  description: string;
  /** File name → text, with `{{id}}` / `{{name}}` placeholders. */
  files: Record<string, string>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok || body?.error) throw new Error(body?.error ?? `request failed: ${res.status}`);
  return body;
}

export const api = {
  health: () => request<{ ok: boolean; appRoot: string }>('/health'),

  defaults: () => request<{ home: string; appRoot: string; suggested: string }>('/project/defaults'),

  openProject: (path: string, create = true) =>
    request<ProjectPayload>('/project/open', {
      method: 'POST',
      body: JSON.stringify({ path, create }),
    }),

  libraries: () => request<{ libraries: LoadedLibrary[] }>('/libraries'),

  /** Scaffolding templates for new component packages. */
  templates: () => request<{ templates: ComponentTemplate[] }>('/templates'),

  /** Write a component package: every file in one round trip, removals included. */
  saveComponent: (dir: string, files: Record<string, string>, remove: string[] = []) =>
    request<{ ok: boolean; dir: string }>('/component/save', {
      method: 'POST',
      body: JSON.stringify({ dir, files, remove }),
    }),

  /** Reads a file. `optional` turns a missing file into `content: null` instead of an error. */
  readFile: (path: string, options: { optional?: boolean } = {}) =>
    request<{ content: string | null; missing?: boolean }>(
      `/fs/read?path=${encodeURIComponent(path)}${options.optional ? '&optional=1' : ''}`,
    ),

  writeFile: (path: string, content: string) =>
    request<{ ok: boolean }>('/fs/write', { method: 'POST', body: JSON.stringify({ path, content }) }),

  /**
   * Fire-and-forget write for page teardown, where a normal request would be cancelled
   * with the document. Returns false when the browser refuses to queue it.
   */
  writeFileBeacon: (path: string, content: string): boolean => {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;
    const blob = new Blob([JSON.stringify({ path, content })], { type: 'application/json' });
    return navigator.sendBeacon('/api/fs/write', blob);
  },

  mkdir: (path: string) => request<{ ok: boolean }>('/fs/mkdir', { method: 'POST', body: JSON.stringify({ path }) }),

  remove: (path: string) => request<{ ok: boolean }>('/fs/delete', { method: 'POST', body: JSON.stringify({ path }) }),

  /** Subscribe to library file changes for hot reload. */
  watch(onEvent: (event: { type: string; file: string | null }) => void): () => void {
    const source = new EventSource('/api/watch');
    source.onmessage = (msg) => {
      try {
        onEvent(JSON.parse(msg.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => source.close();
  },
};
