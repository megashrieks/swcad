import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  TrashIcon,
} from '@radix-ui/react-icons';
import type { ComponentEntry } from '@core/library/registry';
import { LibraryRegistry } from '@core/library/registry';
import { GraphEngine } from '@core/model/graph';
import { DocumentStore } from '@core/model/store';
import { emptyDocument, type LoadedLibrary } from '@core/model/types';
import { api, type ComponentTemplate } from '@core/io/client';
import { deserializeDocument, documentToJson } from '@core/io/serialize';
import { EditorController } from '../editor/EditorController';
import { EditorSurface, useController } from '../editor/EditorSurface';
import { hasInspectorTarget, InspectorPanel, LibraryPanel } from '../editor/panels/Panels';
import { Autosave, type SaveStatus } from '../editor/autosave';
import type { ProjectSession } from '../editor/useProject';
import { DOCUMENT_FILE, MANIFEST_FILE, resolvePackage, type PackageFiles } from '../../server/package-format.js';
import { CodeEditor } from '../ui/CodeEditor';
import { confirmAndDelete, createLibrary, deleteComponent, filesFor, isLegacy, scaffold, writePackage } from './storage';
import { ComponentPicker } from './ComponentPicker';
import { showAlert, showConfirm, showPrompt } from '../ui/Dialog';
import { Button } from '../ui/pomavo';
import { SaveIntoDialog } from './SaveIntoDialog';

/**
 * The component editor.
 *
 * A component is a project. There is no second editor here: the drawing is a document, the
 * canvas below is the same canvas a sheet is drawn on, and the palette offers the `meta`
 * library — rectangles, arcs, ports, labels — alongside every component the project already
 * has, so a component can be drawn out of other components. Selecting anything on the
 * canvas inspects it in the ordinary way, because it *is* an ordinary node.
 *
 * What is different is what surrounds the canvas: the manifest and script are edited as
 * files on the right, and saving writes a package folder rather than a sheet.
 *
 * Connectors are the exception. They are drawn by code from two endpoints, so there is
 * nothing to place on a canvas; those open on a small bench instead — two boxes with the
 * connector under edit strung between them.
 */

/** Ids of the nodes the connector bench uses, kept stable so editing does not reset it. */
const PREVIEW = { component: 'preview', a: 'preview-a', b: 'preview-b', conn: 'preview-conn' };

/** What is open in the editor: the files of a component, and where they came from. */
interface OpenPackage {
  /** Distinguishes one editing session from the next, so the code editor can drop the
   * models — and the undo history — of the component that was open before. */
  key: number;
  /** `lib/id` once it has been saved, null for a component that has never been written. */
  ref: string | null;
  libId: string;
  /** Opened from a read-only library, so saving has to go somewhere else. */
  copy: boolean;
  files: PackageFiles;
  /** The files as they are on disk; null when nothing has been saved yet. */
  saved: PackageFiles | null;
  /** Scaffolded from a template and not touched yet, so there is no work to lose. */
  pristine: boolean;
  active: string;
}

const EMPTY: OpenPackage = {
  key: 0,
  ref: null,
  libId: '',
  copy: false,
  files: {},
  saved: null,
  pristine: true,
  active: MANIFEST_FILE,
};

/** Bumped every time a component is opened or scaffolded; see `OpenPackage.key`. */
let openCount = 0;

/** Whether the file pane was left open, remembered across reloads. */
const CODE_PANE_KEY = 'swcad.component.filePane';

function readCodePaneOpen(): boolean {
  try {
    return window.localStorage.getItem(CODE_PANE_KEY) !== 'closed';
  } catch {
    return true;
  }
}

const sameFiles = (a: PackageFiles, b: PackageFiles | null): boolean =>
  b !== null &&
  Object.keys(a).length === Object.keys(b).length &&
  Object.keys(a).every((k) => a[k] === b[k]);

/** Order the file tabs so the ones people reach for first come first. */
const FILE_ORDER = [MANIFEST_FILE, DOCUMENT_FILE, 'script.js', 'README.md'];
const fileRank = (name: string): number => {
  const i = FILE_ORDER.indexOf(name);
  return i === -1 ? FILE_ORDER.length : i;
};

/**
 * What the topbar needs to know about the component being edited: enough to drive its
 * canvas, say what is open, and save it. Reported upward because opening and saving live
 * in the topbar, next to the same controls for a sheet, while the state behind them
 * belongs to this editor.
 */
export interface ComponentSession {
  /** Whether a component is actually open. Nothing else here means much when it is not. */
  open: boolean;
  /** The canvas on screen, so the toolbar acts on this drawing rather than the sheet's. */
  controller: EditorController;
  /** `lib/id` once it has been written; null for a component that never has been. */
  ref: string | null;
  /** Opened from a read-only library, so saving writes a new component elsewhere. */
  copy: boolean;
  /** Where a save would put it, as `lib/id` — not necessarily where it came from. */
  target: string;
  /** Saving writes back over what was opened, rather than somewhere new. */
  established: boolean;
  saveStatus: SaveStatus;
  dirty: boolean;
  /** Open the browse-and-create dialog. */
  browse: () => void;
  /** Save now, asking where to put it if that is not settled. */
  save: () => void;
}

export function ComponentEditor({
  project,
  openRef,
  openFile,
  onOpened,
  onSession,
}: {
  project: ProjectSession;
  /** Component the URL names; opened when it changes, from wherever it came from. */
  openRef?: string | null;
  /** Package file the URL names, if any. */
  openFile?: string | null;
  /** What is open now, so the address bar can follow the editor. */
  onOpened?: (ref: string | null, file: string | null) => void;
  /**
   * What this editor is working on, so the topbar can drive it — `null` while nothing is
   * open, which is when there is nothing for the topbar to act on.
   */
  onSession?: (session: ComponentSession | null) => void;
}): JSX.Element {
  const [pkg, setPkg] = useState<OpenPackage>(EMPTY);
  const [templates, setTemplates] = useState<ComponentTemplate[]>([]);
  const [targetLib, setTargetLib] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  /** Browsing and creating happen in a dialog, not in the sidebar. */
  const [picking, setPicking] = useState(false);
  /** Set while a save is waiting to be told which library to write to. */
  const [saveInto, setSaveInto] = useState<{ resolve: (libId: string | null) => void } | null>(null);
  /** The file pane can be shut to give the drawing the whole pane. */
  const [codeOpen, setCodeOpen] = useState(readCodePaneOpen);

  useEffect(() => {
    try {
      window.localStorage.setItem(CODE_PANE_KEY, codeOpen ? 'open' : 'closed');
    } catch {
      // A browser refusing storage is not a reason to fail; the choice just does not stick.
    }
  }, [codeOpen]);

  // A registry of its own: the project libraries plus a synthetic one holding the
  // component being edited, so a connector bench renders through the normal pipeline.
  const registry = useMemo(() => new LibraryRegistry(), []);
  const store = useMemo(() => new DocumentStore(emptyDocument('draft', 'component-draft')), []);
  const engine = useMemo(() => new GraphEngine(store, registry), [store, registry]);
  const controller = useMemo(() => {
    const made = new EditorController(store, registry, engine);
    // Ports and anchors are the point of the exercise here, so they stay lit even when
    // nothing is selected.
    made.revealAnnotations = true;
    return made;
  }, [store, registry, engine]);
  useController(controller);

  /**
   * The drawing, as text. The document store owns it while the editor is open — the file
   * is read once, when a component is opened, and written back from the store after that.
   * Reading it again on every keystroke would fight the canvas for control of the drawing.
   */
  const [documentText, setDocumentText] = useState<string | null>(null);
  const files = useMemo(
    () => (documentText === null ? pkg.files : { ...pkg.files, [DOCUMENT_FILE]: documentText }),
    [pkg.files, documentText],
  );
  const resolved = useMemo(() => resolvePackage(files, 'component'), [files]);
  const drawn = documentText !== null;
  const dirty = !sameFiles(files, pkg.saved);

  /** The component under edit, as it is published to the bench: `draft/preview`. */
  const draft = useMemo(
    () => ({ def: { ...resolved.def, id: PREVIEW.component }, script: resolved.script as string | null }),
    [resolved],
  );

  // Opening a component loads its drawing into the store. Everything downstream — the
  // canvas, the inspector, undo — works off the store from then on.
  useEffect(() => {
    const raw = pkg.files[DOCUMENT_FILE];
    if (raw === undefined) {
      setDocumentText(null);
      return;
    }
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
    const doc = deserializeDocument(parsed);
    doc.kind = 'component-draft';
    store.replaceDocument(doc);
    setDocumentText(documentToJson(doc));
    controller.selection.clear();
    // A component can be opened from the palette or the URL; either way nothing should be
    // left armed to drop onto the drawing that has just appeared.
    controller.disarmPlace();
    controller.notify();
    // Only a fresh open reloads the drawing; edits flow the other way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkg.key, store, controller]);

  // ...and the drawing is written back as it changes, so the file and the canvas never
  // disagree about what the component looks like.
  useEffect(() => {
    if (!drawn) return undefined;
    return store.subscribe(() => {
      const doc = store.getDocument();
      if (doc.kind !== 'component-draft') return;
      setDocumentText(documentToJson(doc));
      setPkg((prev) => ({ ...prev, pristine: false }));
    });
  }, [store, drawn]);

  useEffect(() => {
    const projectLibs = project.registry.libraries();
    const target = projectLibs.find((l) => l.manifest.id === targetLib);
    const draftLib: LoadedLibrary = {
      manifest: { id: 'draft', name: 'Draft', version: '0.0.0' },
      // The draft is part of the library rather than something added afterwards, so
      // reloading the project's libraries re-registers it instead of dropping it and
      // leaving the bench showing "missing component".
      components: { [`components/${draft.def.id}`]: draft.def },
      scripts: draft.def.script && draft.script !== null ? { [draft.def.script]: draft.script } : {},
      shared: target?.shared ?? projectLibs.find((l) => l.manifest.id === 'base')?.shared ?? {},
      dir: 'memory:draft',
      readOnly: false,
    };
    registry.load([...projectLibs, draftLib]);
    engine.invalidateAll();
    controller.invalidateGraph();
    controller.notify();
  }, [project.registry, project.registry.revision, targetLib, draft, registry, engine, controller]);

  useEffect(() => {
    const writable = project.registry.libraries().filter((l) => !l.readOnly);
    if (!targetLib && writable.length > 0) setTargetLib(writable[0].manifest.id);
  }, [project.registry.revision, project.registry, targetLib]);

  // A connector has no drawing to place, so it is shown at work instead: two boxes with
  // the connector under edit strung between them.
  const bench = !drawn && Boolean(resolved.def.connector);
  const benchUp = useRef(false);
  useEffect(() => {
    if (!bench) {
      benchUp.current = false;
      return;
    }
    const params = Object.fromEntries((draft.def.params ?? []).map((p) => [p.name, p.default]));
    store.transact('preview', () => {
      if (benchUp.current) {
        store.updateConnection(PREVIEW.conn, { params });
        return;
      }
      const doc = emptyDocument('preview', 'component-draft');
      doc.grid = { ...doc.grid, size: 10, subdivisions: 2 };
      store.replaceDocument(doc);
      controller.selection.clear();
      const hasBox = registry.has('base/box');
      store.addNode({
        id: PREVIEW.a,
        componentRef: hasBox ? 'base/box' : 'draft/preview',
        transform: { x: 0, y: 0, rot: 0, scale: 1 },
        size: { w: 120, h: 70 },
        params: { title: 'from' },
        z: 0,
      });
      store.addNode({
        id: PREVIEW.b,
        componentRef: hasBox ? 'base/box' : 'draft/preview',
        transform: { x: 260, y: 150, rot: 0, scale: 1 },
        size: { w: 120, h: 70 },
        params: { title: 'to' },
        z: 1,
      });
      store.addConnection({
        id: PREVIEW.conn,
        componentRef: 'draft/preview',
        from: { kind: 'port', nodeId: PREVIEW.a, portId: 'p-e' },
        to: { kind: 'port', nodeId: PREVIEW.b, portId: 'p-w' },
        waypoints: [],
        params,
        z: 2,
      });
      benchUp.current = true;
    });
    engine.invalidateAll();
    controller.invalidateGraph();
    controller.notify();
  }, [bench, draft, registry, store, engine, controller]);

  useEffect(() => {
    let cancelled = false;
    void api
      .templates()
      .then(({ templates: list }) => {
        if (cancelled) return;
        setTemplates(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Templates never change while the app runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const discardsWork = useCallback(
    async (): Promise<boolean> =>
      !dirty ||
      pkg.pristine ||
      (await showConfirm('The open component has unsaved changes.', {
        title: 'Discard changes?',
        confirmLabel: 'Discard',
        tone: 'danger',
      })),
    [dirty, pkg.pristine],
  );

  const patchFiles = (next: PackageFiles, active?: string): void =>
    setPkg((prev) => ({ ...prev, files: next, pristine: false, active: active ?? prev.active }));

  const newComponent = useCallback(
    async (
      chosen: ComponentTemplate,
      target: { id: string; name: string; libId: string },
      { confirmDiscard = true }: { confirmDiscard?: boolean } = {},
    ): Promise<boolean> => {
      if (confirmDiscard && !(await discardsWork())) return false;
      const next = scaffold(chosen, { id: target.id, name: target.name });
      setPkg({
        key: (openCount += 1),
        ref: null,
        libId: '',
        copy: false,
        files: next,
        saved: null,
        pristine: true,
        active: MANIFEST_FILE,
      });
      if (target.libId) setTargetLib(target.libId);
      setStatus(`New component from the “${chosen.name}” template. Save it to write the files.`);
      return true;
    },
    [discardsWork],
  );

  /** Nothing open at all: the editor is a shell waiting for the picker. */
  const closeComponent = useCallback((): void => {
    setPkg({ ...EMPTY, key: (openCount += 1) });
    setDocumentText(null);
    setStatus(null);
  }, []);

  /** Open a component by loading its files — exactly what is on disk, nothing derived. */
  const openComponent = useCallback(
    async (entry: ComponentEntry, { confirmDiscard = true }: { confirmDiscard?: boolean } = {}): Promise<boolean> => {
      if (confirmDiscard && !(await discardsWork())) return false;
      const next = filesFor(entry);
      const legacy = isLegacy(entry);
      setPkg({
        key: (openCount += 1),
        ref: entry.ref,
        libId: entry.libId,
        copy: entry.readOnly,
        files: next,
        // A legacy component has no package on disk yet, so it counts as unsaved work.
        saved: legacy || entry.readOnly ? null : next,
        // Nothing has been typed yet, so switching away loses nothing.
        pristine: true,
        active: MANIFEST_FILE,
      });
      if (!entry.readOnly) setTargetLib(entry.libId);
      setStatus(
        entry.readOnly
          ? `Opened ${entry.ref} as a copy — ${entry.libId} is read-only, so saving asks where to put it.`
          : legacy
            ? `Opened ${entry.ref}, a single-file component. Saving converts it into a package folder.`
            : // Which component is open is written in the topbar; saying so again is noise.
              null,
      );
      return true;
    },
    [discardsWork],
  );

  const removeComponent = useCallback(
    async (entry: ComponentEntry): Promise<void> => {
      try {
        const deleted = await confirmAndDelete(project.registry, project.store.getDocument(), entry);
        if (!deleted) return;
        await project.reloadLibraries();
        if (pkg.ref === entry.ref) setPkg((prev) => ({ ...prev, ref: null, saved: null }));
        setStatus(`Deleted ${entry.ref}.`);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err));
      }
    },
    [project, pkg.ref],
  );

  // Saving has to see this render's files, but auto-save owns *when* it happens, so the
  // work lives in a ref that the scheduler below reads at the moment it fires.
  const saveNow = useRef<(into?: string) => Promise<void>>(async () => undefined);
  saveNow.current = async (into = targetLib): Promise<void> => {
    const id = resolved.def.id;
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) {
      throw new Error(`"${id}" is not a usable component id — use letters, digits and dashes.`);
    }
    const lib = project.registry.library(into);
    if (!lib) throw new Error('Pick or create a target library first.');
    if (lib.readOnly) throw new Error(`${lib.manifest.id} is read-only; pick another library.`);

    const dir = `${lib.dir}/components/${id}`;
    const ref = `${lib.manifest.id}/${id}`;
    const previous = pkg.ref && !pkg.copy ? project.registry.get(pkg.ref) : null;
    const movedFrom = previous && previous.ref !== ref ? previous : null;
    // Files the author deleted in the editor only need removing where they were written.
    const remove = movedFrom ? [] : Object.keys(pkg.saved ?? {}).filter((f) => files[f] === undefined);

    await writePackage(dir, files, remove);
    if (movedFrom && !movedFrom.readOnly) {
      const from = project.registry.library(movedFrom.libId);
      const drop =
        from &&
        (await showConfirm(`${movedFrom.ref} was saved under a new id.`, {
          title: 'Delete the old component?',
          confirmLabel: 'Delete it',
          cancelLabel: 'Keep as a copy',
          tone: 'danger',
        }));
      if (from && drop) await deleteComponent(movedFrom, from);
    }
    await project.reloadLibraries();
    setTargetLib(lib.manifest.id);
    setPkg((prev) => ({ ...prev, ref, libId: lib.manifest.id, copy: false, saved: files }));
    setStatus(`Saved ${ref} to ${dir}.`);
  };

  /**
   * A component saves itself the way a sheet does, once it has somewhere to be saved: a
   * component that has never been written has no folder yet, and guessing one would litter
   * the project with every abandoned scaffold.
   */
  const autosave = useMemo(
    () =>
      new Autosave({
        save: () => saveNow.current(),
        onStatus: (state) => setSaveStatus(state),
      }),
    [],
  );
  useEffect(() => {
    autosave.resume();
    return () => autosave.dispose();
  }, [autosave]);
  const established = pkg.ref !== null && !pkg.copy;
  useEffect(() => {
    if (!established) return;
    if (dirty) autosave.markDirty();
    else autosave.reset();
  }, [autosave, dirty, established, files]);

  const saveManually = async (): Promise<void> => {
    try {
      if (established) {
        autosave.markDirty();
        await autosave.flush();
        return;
      }
      // Nowhere to write yet. A scaffold knows where it is going — the library was picked
      // when it was created — but a copy of a read-only component does not, and neither
      // does anything whose library has since gone away.
      const lib = project.registry.library(targetLib);
      let into = lib && !lib.readOnly ? lib.manifest.id : null;
      if (pkg.copy || into === null) {
        into = await new Promise<string | null>((resolve) => setSaveInto({ resolve }));
        if (into === null) return;
      }
      await saveNow.current(into);
    } catch (err) {
      await showAlert(err instanceof Error ? err.message : String(err), { title: 'Could not save' });
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const addLibrary = async (): Promise<string | null> => {
    const name = await showPrompt('New library id — lowercase, no spaces.', {
      title: 'New library',
      value: 'project',
      confirmLabel: 'Create',
    });
    if (!name) return null;
    const id = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    try {
      await createLibrary(project.root, id);
      await project.reloadLibraries();
      setTargetLib(id);
      return id;
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
      return null;
    }
  };

  const addFile = async (): Promise<void> => {
    const name = await showPrompt('Name of the file to add to this component.', {
      title: 'New file',
      value: 'notes.md',
      confirmLabel: 'Add',
    });
    if (!name) return;
    const clean = name.trim().replace(/^[./\\]+/, '');
    if (!clean || files[clean] !== undefined) return;
    patchFiles({ ...pkg.files, [clean]: '' }, clean);
  };

  const removeFile = async (name: string): Promise<void> => {
    if (name === MANIFEST_FILE) {
      setStatus(`${MANIFEST_FILE} cannot be removed — it is what makes this a component.`);
      return;
    }
    if (name === DOCUMENT_FILE) {
      setStatus(`${DOCUMENT_FILE} is the drawing — clear it on the canvas, not here.`);
      return;
    }
    const ok = await showConfirm(`Remove ${name} from this component?`, {
      title: 'Remove file',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    const next = { ...pkg.files };
    delete next[name];
    patchFiles(next, MANIFEST_FILE);
  };

  // The URL says which component is open. Anything that changes it — the sheet palette's
  // edit button, a bookmark, the back button — arrives here as a new `openRef`.
  //
  // `reported` is what the editor last told the address bar. A route that still matches it
  // is this editor's own echo arriving a render late, not a request: acting on it would
  // reopen the component the user has just moved on from, and the two would trade places
  // forever.
  const reported = useRef<{ ref: string | null } | null>(null);
  useEffect(() => {
    const ref = openRef ?? null;
    if (reported.current !== null && reported.current.ref === ref) return;
    if (ref === null) {
      // Backing out of a component lands on /component, which is the picker. Only a real
      // navigation counts: while the editor's own report is still in flight the URL has
      // not caught up yet, and reading it as "close" would undo the open that caused it.
      if (reported.current !== null && pkg.ref !== null) {
        closeComponent();
        setPicking(true);
      }
      return;
    }
    if (ref === pkg.ref) return;
    const entry = project.registry.get(ref);
    if (entry) void openComponent(entry, { confirmDiscard: false });
    else setStatus(`Component ${ref} is not in any loaded library.`);
    // A hot reload can bring in the library the URL is asking for, so retry on revision.
  }, [openRef, pkg.ref, project.registry, project.registry.revision, openComponent, closeComponent]);

  // Arriving with nothing named in the URL: ask what to work on rather than inventing a
  // component nobody asked for. Only on the way in — dismissing the picker leaves the
  // editor empty, and it is reopened from the sidebar.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    if ((openRef ?? null) === null) setPicking(true);
  }, [openRef]);

  const writableLibs = project.registry.libraries().filter((l) => !l.readOnly);
  /*
   * Every file the component is made of gets a tab, the drawing included — asking "where is
   * the geometry kept?" and finding no answer in the file list is worse than a tab you
   * cannot type into. It comes from `files` rather than `pkg.files` so it shows the drawing
   * as it is on the canvas right now, not as it was last written, and it is read-only for
   * the same reason: the store owns the drawing while the component is open and re-serialises
   * it on every change, so anything typed here would be overwritten by the next nudge of a
   * shape. Edit it on the canvas; this tab is for reading and copying.
   */
  const fileNames = Object.keys(files).sort((a, b) => fileRank(a) - fileRank(b) || a.localeCompare(b));
  const active = files[pkg.active] !== undefined ? pkg.active : (fileNames[0] ?? '');
  const activeReadOnly = active === DOCUMENT_FILE;

  // A URL that names a file opens it, as long as the package has one by that name. The
  // value is consumed once: after that the editor owns which tab is active, and the URL
  // follows it — otherwise the two would chase each other whenever a component is opened
  // with a different file already in the address bar.
  const urlFile = useRef<string | null>(null);
  const wantedFile = useRef<{ key: number; file: string } | null>(null);
  useEffect(() => {
    if (!openFile || openFile === urlFile.current || files[openFile] === undefined) return;
    urlFile.current = openFile;
    if (openFile === active) return;
    wantedFile.current = { key: pkg.key, file: openFile };
    setPkg((prev) => ({ ...prev, active: openFile }));
  }, [openFile, files, pkg.key, active]);

  // ...and the address bar follows the editor the rest of the time. Two silences matter:
  // an empty shell has nothing to report (and would wipe the ref out of a deep link before
  // it is even read), and while a file the URL asked for is still landing this render's
  // `active` is the old one, so reporting it would undo the request.
  useEffect(() => {
    const wanted = wantedFile.current;
    if (wanted !== null) {
      if (wanted.key === pkg.key && wanted.file !== active) return;
      wantedFile.current = null;
    }
    if (active === '') return;
    reported.current = { ref: pkg.ref };
    onOpened?.(pkg.ref, active);
  }, [pkg.ref, pkg.key, active, onOpened]);

  const open = Object.keys(pkg.files).length > 0;
  const problemCount = resolved.errors.length + resolved.warnings.length;
  const inspectorFallback = bench ? PREVIEW.conn : null;
  const showInspector = open && hasInspectorTarget(controller, inspectorFallback);

  // Opening and saving live in the topbar, alongside the same controls for a sheet. This
  // is what puts them in reach of the state behind them.
  //
  // The reported object has to be stable while nothing about it has changed: the topbar
  // holds it in state, so a fresh object on every render would re-render this editor,
  // which would make another one. Hence the memo, and the two callbacks that survive a
  // render — `saveManually` is rebuilt each time, so it is reached through a ref.
  const browse = useCallback(() => setPicking(true), []);
  const saveHandler = useRef<() => void>(() => undefined);
  saveHandler.current = () => void saveManually();
  const save = useCallback(() => saveHandler.current(), []);
  const target = `${targetLib}/${resolved.def.id}`;
  const session = useMemo<ComponentSession>(
    () => ({ open, controller, ref: pkg.ref, copy: pkg.copy, target, established, saveStatus, dirty, browse, save }),
    [open, controller, pkg.ref, pkg.copy, target, established, saveStatus, dirty, browse, save],
  );
  useEffect(() => {
    onSession?.(session);
  }, [onSession, session]);
  // Leaving for the sheet leaves nothing to drive. Kept apart from the report above so
  // that an ordinary change does not blink the topbar controls out and back in.
  useEffect(() => () => onSession?.(null), [onSession]);

  const picker = picking ? (
    <ComponentPicker
      registry={project.registry}
      revision={project.registry.revision}
      templates={templates}
      currentRef={pkg.ref}
      defaultLib={targetLib}
      onOpen={(entry) => openComponent(entry)}
      onCreate={(chosen, target) => newComponent(chosen, target)}
      onDelete={(entry) => removeComponent(entry)}
      onNewLibrary={addLibrary}
      onDismiss={() => setPicking(false)}
    />
  ) : null;

  return (
    <div className={`editor-layout${open ? '' : ' no-palette'}`}>
      {picker}
      {saveInto ? (
        <SaveIntoDialog
          id={resolved.def.id}
          libs={writableLibs}
          value={targetLib}
          onNewLibrary={addLibrary}
          onConfirm={(libId) => {
            saveInto.resolve(libId);
            setSaveInto(null);
          }}
          onDismiss={() => {
            saveInto.resolve(null);
            setSaveInto(null);
          }}
        />
      ) : null}
      {open ? (
        <aside className="side left">
          {status ? <p className="side-status">{status}</p> : null}
          <LibraryPanel controller={controller} hideLibs={['draft']} showParts />
        </aside>
      ) : null}

      {!open ? (
        <main className="canvas-area">
          <div className="editor-empty">
            <h2>No component open</h2>
            <p>Pick one to edit, or start a new one from a template.</p>
            <Button type="button" size="sm" onClick={() => setPicking(true)}>
              Browse components
            </Button>
          </div>
        </main>
      ) : (
      <main className="canvas-area split">
        <div className="preview-pane">
          {drawn || bench ? (
            <EditorSurface controller={controller} fitKey={pkg.key} fitMaxZoom={2} />
          ) : (
            <p className="file-editor empty">
              This component has no drawing. Add a <code>{DOCUMENT_FILE}</code>, or start from a template.
            </p>
          )}

          {/* Whatever is selected on the canvas, inspected exactly as it would be on a sheet —
              because it is the same thing. Nothing selected falls back to the connector under
              edit, which is the only thing on a bench worth looking at; with neither, the panel
              goes away entirely rather than standing there empty. It floats over the drawing,
              so showing it never resizes the preview. */}
          {showInspector ? (
            <aside className="side right">
              <InspectorPanel controller={controller} fallbackId={inspectorFallback} />
            </aside>
          ) : null}
        </div>
        <div className={`code-pane${codeOpen ? '' : ' is-collapsed'}`}>
          <div className="file-tabs">
            {fileNames.map((name) => (
              <span
                key={name}
                className={`file-tab${name === active && codeOpen ? ' is-active' : ''}${name === MANIFEST_FILE || name === DOCUMENT_FILE ? ' is-fixed' : ''}`}
              >
                <button
                  type="button"
                  title={
                    name === DOCUMENT_FILE
                      ? 'The drawing as it will be saved — read-only, edit it on the canvas'
                      : undefined
                  }
                  onClick={() => {
                    // Reaching for a file while the pane is shut plainly means "open it".
                    setPkg((prev) => ({ ...prev, active: name }));
                    setCodeOpen(true);
                  }}
                >
                  {name}
                </button>
                {name === MANIFEST_FILE || name === DOCUMENT_FILE ? null : (
                  <button
                    type="button"
                    className="file-close"
                    title={`Remove ${name}`}
                    onClick={() => void removeFile(name)}
                  >
                    <TrashIcon />
                  </button>
                )}
              </span>
            ))}
            <button
              type="button"
              className="file-tab add"
              title="Add a file"
              onClick={() => {
                setCodeOpen(true);
                void addFile();
              }}
            >
              <PlusIcon />
            </button>
            <div className="tab-end">
              {!codeOpen && problemCount > 0 ? (
                <button
                  type="button"
                  className="file-problems"
                  title={`${problemCount} problem${problemCount === 1 ? '' : 's'} — open the pane to read them`}
                  onClick={() => setCodeOpen(true)}
                >
                  <ExclamationTriangleIcon />
                  {problemCount}
                </button>
              ) : null}
              <button
                type="button"
                className="pane-toggle"
                title={codeOpen ? 'Minimise the file pane' : 'Show the file pane'}
                aria-expanded={codeOpen}
                onClick={() => setCodeOpen((was) => !was)}
              >
                {codeOpen ? <ChevronDownIcon /> : <ChevronUpIcon />}
              </button>
            </div>
          </div>
          {!codeOpen ? null : fileNames.length ? (
            <CodeEditor
              className="file-editor"
              scope={String(pkg.key)}
              path={active}
              value={files[active] ?? ''}
              readOnly={activeReadOnly}
              onChange={(text) => {
                if (activeReadOnly) return;
                patchFiles({ ...pkg.files, [active]: text });
              }}
            />
          ) : (
            <p className="file-editor empty">Create a component to start editing its files.</p>
          )}
          {codeOpen && problemCount > 0 ? (
            <div className="problems">
              {resolved.errors.map((e) => (
                <p key={e} className="error">
                  {e}
                </p>
              ))}
              {resolved.warnings.map((w) => (
                <p key={w} className="hint warn">
                  {w}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </main>
      )}
    </div>
  );
}
