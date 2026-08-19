import { useEffect, useMemo, useRef, useState } from 'react';
import { LibraryRegistry } from '@core/library/registry';
import { GraphEngine } from '@core/model/graph';
import { DocumentStore } from '@core/model/store';
import { api, type ProjectPayload } from '@core/io/client';
import { deserializeDocument, documentToJson } from '@core/io/serialize';
import { emptyDocument } from '@core/model/types';
import { EditorController } from './EditorController';

export interface ProjectSession {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  root: string;
  sheetPath: string;
  store: DocumentStore;
  registry: LibraryRegistry;
  engine: GraphEngine;
  controller: EditorController;
  dirty: boolean;
  save: () => Promise<void>;
  reloadLibraries: () => Promise<void>;
}

/**
 * Boots a project: opens the folder on the server, loads libraries and the
 * first sheet, and keeps the library registry hot-reloaded from the watcher.
 */
export function useProject(initialPath?: string): ProjectSession {
  const registry = useMemo(() => new LibraryRegistry(), []);
  const store = useMemo(() => new DocumentStore(emptyDocument()), []);
  const engine = useMemo(() => new GraphEngine(store, registry), [store, registry]);
  const controller = useMemo(() => new EditorController(store, registry, engine), [store, registry, engine]);

  const [status, setStatus] = useState<ProjectSession['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [root, setRoot] = useState('');
  const [sheetPath, setSheetPath] = useState('sheets/main.sheet.json');
  const [dirty, setDirty] = useState(false);
  const savedRevision = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const boot = async (): Promise<void> => {
      try {
        const defaults = await api.defaults();
        const fromUrl = new URLSearchParams(window.location.search).get('project');
        const path = initialPath ?? fromUrl ?? defaults.suggested;
        const payload: ProjectPayload = await api.openProject(path, true);
        if (cancelled) return;

        registry.load(payload.libraries ?? []);
        const first = payload.project.sheets?.[0] ?? 'sheets/main.sheet.json';
        const raw = payload.sheets?.[first];
        const doc = raw ? deserializeDocument(raw) : emptyDocument();
        doc.meta = {
          ...doc.meta,
          title: doc.meta.title || payload.project.title,
          author: doc.meta.author || payload.project.author,
        };
        store.replaceDocument(doc);
        engine.invalidateAll();
        controller.invalidateGraph();

        setRoot(payload.root);
        setSheetPath(first);
        savedRevision.current = store.revision;
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [initialPath, registry, store, engine, controller]);

  useEffect(() => store.subscribe(() => setDirty(store.revision !== savedRevision.current)), [store]);

  // Hot reload libraries when files change on disk.
  useEffect(() => {
    if (status !== 'ready') return;
    let timer: number | undefined;
    const stop = api.watch(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void api
          .libraries()
          .then(({ libraries }) => {
            registry.load(libraries);
            engine.invalidateAll();
            controller.invalidateGraph();
            controller.notify();
          })
          .catch(() => undefined);
      }, 150);
    });
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [status, registry, engine, controller]);

  const save = async (): Promise<void> => {
    if (!root) return;
    await api.writeFile(`${root}/${sheetPath}`, documentToJson(store.getDocument()));
    savedRevision.current = store.revision;
    setDirty(false);
  };

  const reloadLibraries = async (): Promise<void> => {
    const { libraries } = await api.libraries();
    registry.load(libraries);
    engine.invalidateAll();
    controller.invalidateGraph();
    controller.notify();
  };

  return { status, error, root, sheetPath, store, registry, engine, controller, dirty, save, reloadLibraries };
}
