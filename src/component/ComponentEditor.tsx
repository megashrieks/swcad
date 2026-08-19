import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilePlusIcon, PlusIcon, TrashIcon } from '@radix-ui/react-icons';
import type { ComponentEntry } from '@core/library/registry';
import { LibraryRegistry } from '@core/library/registry';
import { GraphEngine } from '@core/model/graph';
import { DocumentStore } from '@core/model/store';
import { emptyDocument, type Annotation, type LoadedLibrary } from '@core/model/types';
import { api, type ComponentTemplate } from '@core/io/client';
import { EditorController } from '../editor/EditorController';
import { EditorSurface, useController } from '../editor/EditorSurface';
import { Field, LibraryPanel, Panel } from '../editor/panels/Panels';
import type { ProjectSession } from '../editor/useProject';
import {
  ANNOTATIONS_FILE,
  MANIFEST_FILE,
  SHAPE_FILE,
  formatJson,
  resolvePackage,
  shapeElements,
  type PackageFiles,
} from '../../server/package-format.js';
import { AnnotationPanel } from './AnnotationPanel';
import { CodeEditor } from '../ui/CodeEditor';
import { confirmAndDelete, createLibrary, deleteComponent, filesFor, isLegacy, scaffold, writePackage } from './storage';

/** Ids of the nodes the preview bench uses, kept stable so editing does not reset it. */
const PREVIEW = { component: 'preview', node: 'preview-node', a: 'preview-a', b: 'preview-b', conn: 'preview-conn' };

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

const sameFiles = (a: PackageFiles, b: PackageFiles | null): boolean =>
  b !== null &&
  Object.keys(a).length === Object.keys(b).length &&
  Object.keys(a).every((k) => a[k] === b[k]);

/** Order the file tabs so the ones people reach for first come first. */
const FILE_ORDER = [MANIFEST_FILE, SHAPE_FILE, ANNOTATIONS_FILE, 'script.js'];
const fileRank = (name: string): number => {
  const i = FILE_ORDER.indexOf(name);
  return i === -1 ? FILE_ORDER.length : i;
};

export function ComponentEditor({
  project,
  openRef,
  onOpened,
}: {
  project: ProjectSession;
  /** Component the sheet editor asked to open; cleared through `onOpened`. */
  openRef?: string | null;
  onOpened?: () => void;
}): JSX.Element {
  const [pkg, setPkg] = useState<OpenPackage>(EMPTY);
  const [templates, setTemplates] = useState<ComponentTemplate[]>([]);
  const [template, setTemplate] = useState('shape');
  const [targetLib, setTargetLib] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [selectedElement, setSelectedElement] = useState<string | null>(null);

  // A registry of its own: the project libraries plus a synthetic one holding the
  // component being edited, so the preview renders through the normal pipeline.
  const registry = useMemo(() => new LibraryRegistry(), []);
  const store = useMemo(() => {
    const doc = emptyDocument('preview', 'component-draft');
    doc.grid = { ...doc.grid, size: 10, subdivisions: 2 };
    return new DocumentStore(doc);
  }, []);
  const engine = useMemo(() => new GraphEngine(store, registry), [store, registry]);
  const controller = useMemo(() => {
    const made = new EditorController(store, registry, engine);
    // The bench exists to show what the annotations declare, so ports and anchors stay lit.
    made.revealAnnotations = true;
    return made;
  }, [store, registry, engine]);
  useController(controller);

  const resolved = useMemo(() => resolvePackage(pkg.files, 'component'), [pkg.files]);
  /** The component under edit, as it is published to the bench: `draft/preview`. */
  const draft = useMemo(
    () => ({ def: { ...resolved.def, id: PREVIEW.component }, script: resolved.script as string | null }),
    [resolved],
  );
  const dirty = !sameFiles(pkg.files, pkg.saved);
  const elements = useMemo(() => shapeElements(pkg.files[resolved.shapeFile ?? SHAPE_FILE] ?? ''), [
    pkg.files,
    resolved.shapeFile,
  ]);

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

  // Live preview: publish the component under `draft/preview` and put it on a small
  // bench — one instance, or two boxes joined by it when it is a connector.
  const layout = useRef<'node' | 'connector' | null>(null);
  /** The default size the bench instance was last sized from, so a manual resize sticks. */
  const benchSize = useRef('');
  useEffect(() => {
    // Registration happens in the library effect above, which runs first because it
    // watches the same draft.
    const def = draft.def;

    const wanted = def.connector ? 'connector' : 'node';
    const size = def.defaultSize ?? { w: 120, h: 80 };
    const params = Object.fromEntries((def.params ?? []).map((p) => [p.name, p.default]));

    store.transact('preview', () => {
      if (layout.current !== wanted) {
        const doc = emptyDocument('preview', 'component-draft');
        doc.grid = { ...doc.grid, size: 10, subdivisions: 2 };
        store.replaceDocument(doc);
        controller.selection.clear();
        if (wanted === 'connector') {
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
        } else {
          store.addNode({
            id: PREVIEW.node,
            componentRef: 'draft/preview',
            transform: { x: 0, y: 0, rot: 0, scale: 1 },
            size,
            params,
            z: 0,
          });
        }
        layout.current = wanted;
        benchSize.current = `${size.w}x${size.h}`;
      } else if (wanted === 'node') {
        const node = store.getDocument().nodes[PREVIEW.node];
        // Follow the declared size while it changes; a manual resize survives until it does.
        const declared = `${size.w}x${size.h}`;
        const resize = declared !== benchSize.current;
        benchSize.current = declared;
        if (node) store.updateNode(PREVIEW.node, { size: resize ? size : node.size, params });
      } else {
        store.updateConnection(PREVIEW.conn, { params });
      }
    });
    engine.invalidateAll();
    controller.invalidateGraph();
    controller.notify();
  }, [draft, registry, store, engine, controller]);

  useEffect(() => {
    let cancelled = false;
    void api
      .templates()
      .then(({ templates: list }) => {
        if (cancelled) return;
        setTemplates(list);
        if (list.length && !list.some((t) => t.id === template)) setTemplate(list[0].id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Templates never change while the app runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const discardsWork = useCallback(
    (): boolean =>
      !dirty || pkg.pristine || window.confirm('The open component has unsaved changes. Discard them?'),
    [dirty, pkg.pristine],
  );

  const patchFiles = (files: PackageFiles, active?: string): void =>
    setPkg((prev) => ({ ...prev, files, pristine: false, active: active ?? prev.active }));

  const newComponent = useCallback(
    (templateId: string): void => {
      if (!discardsWork()) return;
      const chosen = templates.find((t) => t.id === templateId) ?? templates[0];
      if (!chosen) {
        setStatus('No templates found in templates/components.');
        return;
      }
      const id = uniqueId(project.registry.all().map((e) => e.def.id));
      const files = scaffold(chosen, { id, name: titleCase(id) });
      setPkg({
        key: (openCount += 1),
        ref: null,
        libId: '',
        copy: false,
        files,
        saved: null,
        pristine: true,
        active: MANIFEST_FILE,
      });
      setSelectedElement(null);
      setStatus(`New component from the “${chosen.name}” template. Save it to write the files.`);
    },
    [templates, discardsWork, project.registry],
  );

  /** Open a component by loading its files — exactly what is on disk, nothing derived. */
  const openComponent = useCallback(
    (entry: ComponentEntry, { confirmDiscard = true }: { confirmDiscard?: boolean } = {}): void => {
      if (confirmDiscard && !discardsWork()) return;
      const files = filesFor(entry);
      const legacy = isLegacy(entry);
      setPkg({
        key: (openCount += 1),
        ref: entry.ref,
        libId: entry.libId,
        copy: entry.readOnly,
        files,
        // A legacy component has no package on disk yet, so it counts as unsaved work.
        saved: legacy || entry.readOnly ? null : files,
        // Nothing has been typed yet, so switching away loses nothing.
        pristine: true,
        active: files[SHAPE_FILE] !== undefined ? SHAPE_FILE : MANIFEST_FILE,
      });
      setSelectedElement(null);
      if (!entry.readOnly) setTargetLib(entry.libId);
      setStatus(
        entry.readOnly
          ? `Opened ${entry.ref} as a copy — ${entry.libId} is read-only, so pick another library to save into.`
          : legacy
            ? `Opened ${entry.ref}, a single-file component. Saving converts it into a package folder.`
            : `Editing ${entry.ref}.`,
      );
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

  const save = async (): Promise<void> => {
    const id = resolved.def.id;
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) {
      setStatus(`"${id}" is not a usable component id — use letters, digits and dashes.`);
      return;
    }
    const lib = project.registry.library(targetLib);
    if (!lib) {
      setStatus('Pick or create a target library first.');
      return;
    }
    if (lib.readOnly) {
      setStatus(`${lib.manifest.id} is read-only; pick another library.`);
      return;
    }
    const dir = `${lib.dir}/components/${id}`;
    const ref = `${lib.manifest.id}/${id}`;
    const previous = pkg.ref && !pkg.copy ? project.registry.get(pkg.ref) : null;
    const movedFrom = previous && previous.ref !== ref ? previous : null;
    // Files the author deleted in the editor only need removing where they were written.
    const remove = movedFrom ? [] : Object.keys(pkg.saved ?? {}).filter((f) => pkg.files[f] === undefined);

    try {
      await writePackage(dir, pkg.files, remove);
      if (movedFrom && !movedFrom.readOnly) {
        const from = project.registry.library(movedFrom.libId);
        if (from && window.confirm(`Delete the old ${movedFrom.ref}? Cancel keeps it as a copy.`)) {
          await deleteComponent(movedFrom, from);
        }
      }
      await project.reloadLibraries();
      setPkg((prev) => ({ ...prev, ref, libId: lib.manifest.id, copy: false, saved: prev.files }));
      setStatus(`Saved ${ref} to ${dir}.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const addLibrary = async (): Promise<void> => {
    const name = window.prompt('New library id (lowercase, no spaces)', 'project');
    if (!name) return;
    const id = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    try {
      await createLibrary(project.root, id);
      await project.reloadLibraries();
      setTargetLib(id);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const addFile = (): void => {
    const name = window.prompt('New file name', 'notes.md');
    if (!name) return;
    const clean = name.trim().replace(/^[./\\]+/, '');
    if (!clean || pkg.files[clean] !== undefined) return;
    patchFiles({ ...pkg.files, [clean]: '' }, clean);
  };

  const removeFile = (name: string): void => {
    if (name === MANIFEST_FILE) {
      setStatus(`${MANIFEST_FILE} cannot be removed — it is what makes this a component.`);
      return;
    }
    if (!window.confirm(`Remove ${name} from this component?`)) return;
    const files = { ...pkg.files };
    delete files[name];
    patchFiles(files, MANIFEST_FILE);
  };

  /** The annotation panel and annotations.json are two views of the same file. */
  const setAnnotations = (next: Record<string, Annotation>): void => {
    if (resolved.annotationsFile === null && Object.keys(next).length === 0) return;
    const file = resolved.annotationsFile ?? ANNOTATIONS_FILE;
    patchFiles({ ...pkg.files, [file]: `${formatJson(next)}\n` });
  };

  // The sheet editor can hand a component over for editing.
  const pendingOpen = useRef<string | null>(null);
  useEffect(() => {
    if (!openRef || pendingOpen.current === openRef) return;
    pendingOpen.current = openRef;
    const entry = project.registry.get(openRef);
    if (entry) openComponent(entry, { confirmDiscard: false });
    else setStatus(`Component ${openRef} is not in any loaded library.`);
    onOpened?.();
  }, [openRef, project.registry, openComponent, onOpened]);

  // Start on something rather than an empty shell.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || templates.length === 0 || Object.keys(pkg.files).length > 0) return;
    seeded.current = true;
    newComponent(template);
  }, [templates, pkg.files, newComponent, template]);

  const writableLibs = project.registry.libraries().filter((l) => !l.readOnly);
  const fileNames = Object.keys(pkg.files).sort((a, b) => fileRank(a) - fileRank(b) || a.localeCompare(b));
  const active = pkg.files[pkg.active] !== undefined ? pkg.active : (fileNames[0] ?? '');
  const inlineAnnotations = resolved.annotationsFile === null && Object.keys(resolved.def.annotations).length > 0;

  return (
    <div className="editor-layout">
      <aside className="side left">
        <Panel
          title="Component"
          actions={
            <button type="button" className="btn" title="Start from a template" onClick={() => newComponent(template)}>
              <span className="btn-icon" aria-hidden="true">
                <PlusIcon />
              </span>
              New
            </button>
          }
        >
          <p className="row-note">
            {pkg.ref ? (
              <>
                {pkg.copy ? 'Copy of ' : 'Editing '}
                <strong>{pkg.ref}</strong>
              </>
            ) : (
              <>New component</>
            )}
            {dirty ? ' • unsaved' : null}
          </p>
          <Field label="Template">
            <select className="input" value={template} onChange={(e) => setTemplate(e.target.value)}>
              {templates.map((t) => (
                <option key={t.id} value={t.id} title={t.description}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Save into">
            <select className="input" value={targetLib} onChange={(e) => setTargetLib(e.target.value)}>
              <option value="">— pick a library —</option>
              {writableLibs.map((l) => (
                <option key={l.manifest.id} value={l.manifest.id}>
                  {l.manifest.id}
                </option>
              ))}
            </select>
          </Field>
          <div className="row">
            <button type="button" className="btn" onClick={() => void addLibrary()}>
              <span className="btn-icon" aria-hidden="true">
                <FilePlusIcon />
              </span>
              New library
            </button>
            <button type="button" className="btn primary" onClick={() => void save()}>
              {pkg.ref && !pkg.copy && pkg.ref === `${targetLib}/${resolved.def.id}` ? 'Save changes' : 'Save as new'}
            </button>
          </div>
          <p className="hint">
            Files go to <code>{targetLib ? `libs/${targetLib}/components/${resolved.def.id}/` : '…'}</code>
          </p>
          {status ? <p className="hint">{status}</p> : null}
        </Panel>

        <LibraryPanel
          controller={controller}
          hideLibs={['draft']}
          onPick={(entry) => openComponent(entry)}
          onEdit={(entry) => openComponent(entry)}
          onDelete={(entry) => void removeComponent(entry)}
        />
      </aside>

      <main className="canvas-area split">
        <div className="preview-pane">
          <EditorSurface controller={controller} />
        </div>
        <div className="code-pane">
          <div className="file-tabs">
            {fileNames.map((name) => (
              <span key={name} className={`file-tab${name === active ? ' is-active' : ''}`}>
                <button type="button" onClick={() => setPkg((prev) => ({ ...prev, active: name }))}>
                  {name}
                </button>
                {name === MANIFEST_FILE ? null : (
                  <button
                    type="button"
                    className="file-close"
                    title={`Remove ${name}`}
                    onClick={() => removeFile(name)}
                  >
                    <TrashIcon />
                  </button>
                )}
              </span>
            ))}
            <button type="button" className="file-tab add" title="Add a file" onClick={addFile}>
              <PlusIcon />
            </button>
          </div>
          {fileNames.length ? (
            <CodeEditor
              className="file-editor"
              scope={String(pkg.key)}
              path={active}
              value={pkg.files[active] ?? ''}
              onChange={(text) => patchFiles({ ...pkg.files, [active]: text })}
            />
          ) : (
            <p className="file-editor empty">Create a component to start editing its files.</p>
          )}
          {resolved.errors.length || resolved.warnings.length ? (
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

      <aside className="side right">
        <AnnotationPanel
          elements={elements}
          annotations={resolved.def.annotations}
          onChange={setAnnotations}
          selected={selectedElement}
          onSelect={setSelectedElement}
          disabled={inlineAnnotations}
          note={
            inlineAnnotations
              ? `Annotations are inlined in ${MANIFEST_FILE}; edit them there.`
              : `Editing ${resolved.annotationsFile ?? ANNOTATIONS_FILE}`
          }
        />
        <Panel title="Summary">
          <dl className="facts">
            <dt>id</dt>
            <dd>{resolved.def.id}</dd>
            <dt>size</dt>
            <dd>
              {resolved.def.defaultSize ? `${resolved.def.defaultSize.w}×${resolved.def.defaultSize.h}` : 'from shape'}
            </dd>
            <dt>params</dt>
            <dd>{resolved.def.params.length}</dd>
            <dt>ports</dt>
            <dd>{Object.values(resolved.def.annotations).filter((a) => a.kind === 'port').length}</dd>
            <dt>script</dt>
            <dd>{resolved.scriptFile ?? 'none'}</dd>
          </dl>
        </Panel>
      </aside>
    </div>
  );
}

/** `my-component` → `My component`, for the human-facing name in a scaffold. */
function titleCase(id: string): string {
  return id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function uniqueId(taken: string[]): string {
  const used = new Set(taken);
  if (!used.has('my-component')) return 'my-component';
  for (let i = 2; ; i += 1) if (!used.has(`my-component-${i}`)) return `my-component-${i}`;
}
