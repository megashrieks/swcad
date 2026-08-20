import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LibraryRegistry } from '@core/library/registry';
import { GraphEngine } from '@core/model/graph';
import { DocumentStore } from '@core/model/store';
import { api, type ProjectPayload } from '@core/io/client';
import { deserializeDocument, documentToJson } from '@core/io/serialize';
import { decodeHistory, encodeHistory, historyPath } from '@core/io/history';
import { emptyDocument } from '@core/model/types';
import { EditorController } from './EditorController';
import { Autosave, type SaveStatus } from './autosave';

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
  /** What auto-save is doing right now. */
  saveStatus: SaveStatus;
  /** Message from the last failed save, if any. */
  saveError: string | null;
  /** Write now instead of waiting for auto-save. */
  save: () => Promise<void>;
  reloadLibraries: () => Promise<void>;
}

/**
 * Boots a project: opens the folder on the server, loads libraries and the first sheet,
 * keeps the library registry hot-reloaded from the watcher, and auto-saves both the sheet
 * and its undo journal as you work.
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
  const [save, setSave] = useState<{ status: SaveStatus; error: string | null }>({ status: 'saved', error: null });
  const savedRevision = useRef(0);
  const savedHistoryRevision = useRef(0);
  // Auto-save runs from one long-lived scheduler, so where to write lives in a ref.
  const target = useRef({ root: '', sheetPath: 'sheets/main.sheet.json' });

  /** Writes the sheet and its journal together — they are only useful as a pair. */
  const writeProject = useCallback(async (): Promise<void> => {
    const { root: dir, sheetPath: rel } = target.current;
    if (!dir) return;
    const revision = store.revision;
    const historyRevision = store.historyRevision;
    const json = documentToJson(store.getDocument());
    const journal = encodeHistory(json, store.exportHistory());
    await api.writeFile(`${dir}/${rel}`, json);
    await api.writeFile(historyPath(dir, rel), journal);
    savedRevision.current = revision;
    savedHistoryRevision.current = historyRevision;
    setDirty(store.revision !== revision || store.historyRevision !== historyRevision);
  }, [store]);

  const autosave = useMemo(
    () =>
      new Autosave({
        save: writeProject,
        // Mid-gesture the document is only a preview; wait for the pointer to come up.
        defer: () => controller.drag !== null,
        onStatus: (next, err) => setSave({ status: next, error: err }),
      }),
    [writeProject, controller],
  );
  useEffect(() => {
    autosave.resume();
    return () => autosave.dispose();
  }, [autosave]);

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
        // Fingerprint the sheet as it sits on disk, before project defaults are folded
        // in, so it can be matched against the journal saved alongside it.
        const onDisk = documentToJson(doc);
        doc.meta = {
          ...doc.meta,
          title: doc.meta.title || payload.project.title,
          author: doc.meta.author || payload.project.author,
        };
        store.replaceDocument(doc);
        engine.invalidateAll();
        controller.invalidateGraph();
        await restoreHistory(store, payload.root, first, onDisk);
        if (cancelled) return;

        setRoot(payload.root);
        setSheetPath(first);
        target.current = { root: payload.root, sheetPath: first };
        savedRevision.current = store.revision;
        savedHistoryRevision.current = store.historyRevision;
        setDirty(false);
        autosave.reset();
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
  }, [initialPath, registry, store, engine, controller, autosave]);

  // Every document or journal change queues an auto-save.
  useEffect(
    () =>
      store.subscribe(() => {
        const changed =
          store.revision !== savedRevision.current || store.historyRevision !== savedHistoryRevision.current;
        setDirty(changed);
        if (changed && status === 'ready') autosave.markDirty();
      }),
    [store, status, autosave],
  );

  // Leaving the tab must not cost the last few seconds of work.
  useEffect(() => {
    if (status !== 'ready') return;
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') void autosave.flush();
    };
    // Teardown cancels in-flight fetches, so the parting write goes out as a beacon.
    const onPageHide = (): void => {
      if (!autosave.pending) return;
      const { root: dir, sheetPath: rel } = target.current;
      if (!dir) return;
      const json = documentToJson(store.getDocument());
      api.writeFileBeacon(`${dir}/${rel}`, json);
      api.writeFileBeacon(historyPath(dir, rel), encodeHistory(json, store.exportHistory()));
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [status, store, autosave]);

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

  const reloadLibraries = async (): Promise<void> => {
    const { libraries } = await api.libraries();
    registry.load(libraries);
    engine.invalidateAll();
    controller.invalidateGraph();
    controller.notify();
  };

  return {
    status,
    error,
    root,
    sheetPath,
    store,
    registry,
    engine,
    controller,
    dirty,
    saveStatus: save.status,
    saveError: save.error,
    save: () => autosave.flush(),
    reloadLibraries,
  };
}

/** Puts a previously saved undo journal back on the store, if it still matches the sheet. */
async function restoreHistory(store: DocumentStore, root: string, sheetPath: string, onDisk: string): Promise<void> {
  try {
    const { content } = await api.readFile(historyPath(root, sheetPath), { optional: true });
    const journal = content ? decodeHistory(content, onDisk) : null;
    if (journal) store.importHistory(journal.undo, journal.redo);
  } catch {
    // An unreadable journal costs undo depth and nothing else: start with an empty one.
  }
}
