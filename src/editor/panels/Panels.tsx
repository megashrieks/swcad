import { useMemo, useState } from 'react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  LinkBreak2Icon,
  Pencil1Icon,
  PinBottomIcon,
  PinTopIcon,
  TrashIcon,
} from '@radix-ui/react-icons';
import type { ComponentEntry } from '@core/library/registry';
import type { Node, ParamDef } from '@core/model/types';
import { PAGE_PRESETS, makePage } from '@core/model/types';
import type { EditorController } from '../EditorController';
import { staticMarkup } from '../render';
import { NumberInput } from '../../ui/NumberInput';
import { CheckField, ColorField, SelectField, TextField } from '../../ui/Field';
import { IconButton } from '../../ui/IconButton';
import { Button } from '../../ui/pomavo';

export function Panel({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }): JSX.Element {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{title}</h2>
        {actions}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** A component drawn at rest, with its default parameters — the picture in every palette. */
export function ComponentPreview({ entry }: { entry: ComponentEntry }): JSX.Element {
  const { markup, size } = useMemo(
    () => staticMarkup(entry.def, { params: defaultParams(entry.def.params), meta: {} }),
    [entry.def],
  );
  const w = Math.max(size.w, 1);
  const h = Math.max(size.h, 1);
  return (
    <svg className="preview" viewBox={`-6 -6 ${w + 12} ${h + 12}`} preserveAspectRatio="xMidYMid meet">
      <g dangerouslySetInnerHTML={{ __html: markup }} />
    </svg>
  );
}

function defaultParams(params: ParamDef[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of params) out[p.name] = p.default;
  return out;
}

/** Which library groups the user has folded away, remembered across reloads. */
const COLLAPSED_LIBS_KEY = 'swcad.palette.collapsed';
/** The same, for the named sections inside a panel. */
const COLLAPSED_SECTIONS_KEY = 'swcad.panel.collapsed';

/**
 * Fold state is an explicit `id -> collapsed` map rather than a list of folded ids, so
 * "never touched" stays distinguishable from "opened" and each group keeps its own default.
 */
function readFolds(key: string): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [id, collapsed] of Object.entries(parsed)) {
      if (typeof collapsed === 'boolean') out[id] = collapsed;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Remembers which of a group of foldable things are closed. The writer re-reads storage
 * rather than trusting its own copy, so sibling `Section`s — each holding its own state
 * for the same key — cannot overwrite one another's choice.
 */
function useFolds(key: string): [Record<string, boolean>, (id: string, collapsed: boolean) => void] {
  const [folds, setFolds] = useState(() => readFolds(key));
  const setFold = (id: string, collapsed: boolean): void => {
    const next = { ...readFolds(key), [id]: collapsed };
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Fold state is a convenience; a browser that refuses storage still works.
    }
    setFolds(next);
  };
  return [folds, setFold];
}

/** A named block inside a panel, folded away by clicking its heading. */
export function Section({
  id,
  title,
  defaultCollapsed = true,
  children,
}: {
  /** Storage key for the fold state. Unique across the app, not just the panel. */
  id: string;
  title: string;
  /** Sections start folded: the sheet settings are set once and then stay out of the way. */
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  const [folds, setFold] = useFolds(COLLAPSED_SECTIONS_KEY);
  const open = !(folds[id] ?? defaultCollapsed);
  return (
    <>
      <button
        type="button"
        className={`subhead${open ? '' : ' is-collapsed'}`}
        aria-expanded={open}
        title={`${open ? 'Collapse' : 'Expand'} ${title.toLowerCase()}`}
        onClick={() => setFold(id, open)}
      >
        <ChevronDownIcon className="subhead-caret" />
        <span>{title}</span>
      </button>
      {open ? children : null}
    </>
  );
}

export function LibraryPanel({
  controller,
  hideLibs,
  showParts,
  onPick,
  onEdit,
  onDelete,
}: {
  controller: EditorController;
  hideLibs?: string[];
  /**
   * Offer the libraries marked `editorOnly` — the primitives a component is drawn from.
   * They are parts rather than finished components, so they have no business on a sheet.
   */
  showParts?: boolean;
  /** Overrides the default click action (arming placement on the canvas). */
  onPick?: (entry: ComponentEntry) => void;
  /** Open a component for editing. Shown per item when supplied. */
  onEdit?: (entry: ComponentEntry) => void;
  /** Delete a component from its library. Only offered for writable libraries. */
  onDelete?: (entry: ComponentEntry) => void;
}): JSX.Element {
  const [filter, setFilter] = useState('');
  const [libFolds, setLibFold] = useFolds(COLLAPSED_LIBS_KEY);
  const entries = controller.registry.all();
  const byLib = new Map<string, ComponentEntry[]>();
  for (const entry of entries) {
    if (hideLibs?.includes(entry.libId)) continue;
    if (!showParts && controller.registry.library(entry.libId)?.manifest.editorOnly) continue;
    if (filter && !`${entry.def.name} ${entry.ref}`.toLowerCase().includes(filter.toLowerCase())) continue;
    const list = byLib.get(entry.libId) ?? [];
    list.push(entry);
    byLib.set(entry.libId, list);
  }

  return (
    <Panel title="Libraries">
      <TextField placeholder="Filter components" value={filter} onChange={setFilter} />
      {[...byLib.entries()].map(([libId, list]) => {
        const lib = controller.registry.library(libId);
        // In-memory palettes (the meta primitives, the live draft) have no files to open.
        const onDisk = Boolean(lib && !/^(builtin|memory):/.test(lib.dir));
        const editable = onEdit && onDisk;
        const deletable = onDelete && onDisk && !lib?.readOnly;
        // A filter that matched something has already narrowed the list to what was asked
        // for; folding it away again would answer a search with an empty panel.
        const open = !(libFolds[libId] ?? false) || filter.length > 0;
        return (
          <div key={libId} className="lib-group">
            <button
              type="button"
              className={`lib-name${open ? '' : ' is-collapsed'}`}
              aria-expanded={open}
              title={`${open ? 'Collapse' : 'Expand'} ${libId}`}
              onClick={() => setLibFold(libId, open)}
            >
              <ChevronDownIcon className="lib-caret" />
              <span className="lib-label">{libId}</span>
              {lib?.readOnly ? <span className="tag">read-only</span> : null}
              <span className="lib-count">{list.length}</span>
            </button>
            {open ? (
              <div className="lib-grid">
                {list.map((entry) => (
                  <div key={entry.ref} className="lib-cell">
                    <button
                      type="button"
                      className={`lib-item${controller.placeRef === entry.ref ? ' is-active' : ''}`}
                      title={`${entry.def.description ?? entry.def.name} (${entry.ref})${
                        !onPick && editable ? ' — double-click to edit' : ''
                      }`}
                      onClick={() => {
                        if (onPick) {
                          onPick(entry);
                          return;
                        }
                        controller.placeRef = entry.ref;
                        controller.onPlace = null;
                        controller.tool = entry.def.connector ? 'connect' : 'place';
                        controller.notify();
                      }}
                      onDoubleClick={
                        !onPick && editable
                          ? () => {
                              // The click that made this a double-click armed the place tool;
                              // leaving it armed drops a copy on the first click after opening.
                              controller.disarmPlace();
                              onEdit!(entry);
                            }
                          : undefined
                      }
                    >
                      <ComponentPreview entry={entry} />
                      <span>{entry.def.name}</span>
                    </button>
                    {editable || deletable ? (
                      <div className="lib-actions">
                        {editable ? (
                          <button
                            type="button"
                            className="lib-action"
                            title={entry.readOnly ? `Open ${entry.def.name} as a copy` : `Edit ${entry.def.name}`}
                            onClick={() => {
                              controller.disarmPlace();
                              onEdit!(entry);
                            }}
                          >
                            <Pencil1Icon />
                          </button>
                        ) : null}
                        {deletable ? (
                          <button
                            type="button"
                            className="lib-action danger"
                            title={`Delete ${entry.def.name}`}
                            onClick={() => onDelete!(entry)}
                          >
                            <TrashIcon />
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </Panel>
  );
}

/** True when the selection — or the caller's fallback — has something the inspector can show. */
export function hasInspectorTarget(controller: EditorController, fallbackId?: string | null): boolean {
  const graph = controller.getGraph();
  for (const id of controller.selection) {
    if (graph.nodes.has(id) || graph.connections.has(id)) return true;
  }
  return Boolean(fallbackId && (graph.nodes.has(fallbackId) || graph.connections.has(fallbackId)));
}

export function InspectorPanel({
  controller,
  fallbackId,
}: {
  controller: EditorController;
  /**
   * What to inspect while nothing is selected. The sheet has no such thing — an empty
   * selection means an empty inspector there — but the component editor's bench exists to
   * show one subject, and blanking the column every time a click misses it reads as a bug.
   */
  fallbackId?: string | null;
}): JSX.Element | null {
  const graph = controller.getGraph();
  const selected = [...controller.selection].filter((id) => graph.nodes.has(id) || graph.connections.has(id));
  const pool = selected.length > 0 ? selected : fallbackId ? [fallbackId] : [];

  // More than one subject: everything below reads one thing, so the shared editor takes over.
  if (pool.length > 1) return <MultiInspector controller={controller} ids={pool} />;

  const nodeId = pool.find((id) => graph.nodes.has(id));
  const connId = pool.find((id) => graph.connections.has(id));
  const info = nodeId ? graph.nodes.get(nodeId) : null;
  const conn = connId ? graph.connections.get(connId) : null;

  // Nothing selected: the panel (and, in the sheet editor, the pane holding it) is hidden
  // rather than showing an empty shell.
  if (!info && !conn) return null;

  if (conn && !info) {
    const entry = controller.registry.get(conn.conn.componentRef);
    return (
      <Panel title="Connector">
        <div className="row-note">{conn.conn.componentRef}</div>
        <ParamEditor
          params={entry?.def.params ?? []}
          values={conn.conn.params}
          onChange={(name, value) =>
            controller.store.updateConnection(conn.id, (c) => ({ params: { ...c.params, [name]: value } }))
          }
        />
        <div className="row-note">
          {describeEndpoint(conn.conn.from)} → {describeEndpoint(conn.conn.to)}
        </div>
        {conn.error && <p className="error">{conn.error}</p>}
        {conn.warning && <p className="warning">{conn.warning}</p>}
      </Panel>
    );
  }

  if (!info) return null;
  const node = info.node;

  return (
    <Panel title={info.def?.name ?? 'Component'} actions={<OrderControls controller={controller} />}>
      <div className="row-note">{node.componentRef}</div>

      <div className="grid-2">
        <Field label="X">
          <NumberInput
            value={node.transform.x}
            onCommit={(x) => controller.store.updateNode(node.id, (n) => ({ transform: { ...n.transform, x } }))}
          />
        </Field>
        <Field label="Y">
          <NumberInput
            value={node.transform.y}
            onCommit={(y) => controller.store.updateNode(node.id, (n) => ({ transform: { ...n.transform, y } }))}
          />
        </Field>
        {info.def?.resizable === false ? null : (
          <>
            <Field label="Width">
              <NumberInput
                value={node.size.w}
                onCommit={(w) => controller.store.updateNode(node.id, (n) => ({ size: { ...n.size, w } }))}
              />
            </Field>
            <Field label="Height">
              <NumberInput
                value={node.size.h}
                onCommit={(h) => controller.store.updateNode(node.id, (n) => ({ size: { ...n.size, h } }))}
              />
            </Field>
          </>
        )}
        <Field label="Rotation">
          <NumberInput
            value={node.transform.rot}
            step={15}
            onCommit={(rot) => controller.store.updateNode(node.id, (n) => ({ transform: { ...n.transform, rot } }))}
          />
        </Field>
      </div>

      <ParamEditor
        params={info.def?.params ?? []}
        values={node.params}
        onChange={(name, value) => controller.store.updateNode(node.id, (n) => ({ params: { ...n.params, [name]: value } }))}
      />

      {info.ports.length > 0 && (
        <>
          <div className="subhead">Ports</div>
          <ul className="list">
            {/* Same-named pins are one logical port with one merged link list, so
                listing each would repeat the same row and the same count. */}
            {info.ports
              .filter((port) => !port.group || port.group[0] === port.id)
              .map((port) => (
                <li key={port.id}>
                  <span className={`dot${port.connected ? ' is-connected' : ''}`} />
                  {port.name}
                  <span className="muted">
                    {port.direction} · {port.connections.length} link{port.connections.length === 1 ? '' : 's'}
                    {port.group ? ` · ${port.group.length} pins` : ''}
                  </span>
                </li>
              ))}
          </ul>
        </>
      )}

      {info.anchors.length > 0 && (
        <>
          <div className="subhead">Attachment</div>
          {node.attachment ? (
            <div className="row">
              <span className="muted">
                pinned to {node.attachment.parentId.slice(0, 8)} · {node.attachment.anchorId}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="btn font-normal"
                title="Unpin from the parent"
                onClick={() => controller.detach(node.id)}
              >
                <span className="btn-icon" aria-hidden="true">
                  <LinkBreak2Icon />
                </span>
                Detach
              </Button>
            </div>
          ) : (
            <AttachControl controller={controller} nodeId={node.id} />
          )}
        </>
      )}

      {info.logs.length > 0 && (
        <>
          <div className="subhead">Script output</div>
          <pre className="logs">{info.logs.join('\n')}</pre>
        </>
      )}
      {info.error && <p className="error">{info.error}</p>}
      {info.warning && <p className="warning">{info.warning}</p>}
    </Panel>
  );
}

/**
 * Where the selection sits in the paint order.
 *
 * The buttons live in the panel header because ordering is a property of the *selection*,
 * not of any one field below, and because a header costs no vertical space in a panel that
 * floats over the drawing. Both pairs grey out at the ends of the stack, so the panel says
 * "this is already at the front" without you having to click to find out.
 *
 * Connections are not reorderable: they are painted as their own layer beneath every node,
 * so there is no stack for them to move through.
 */
function OrderControls({ controller }: { controller: EditorController }): JSX.Element {
  const forward = controller.canMoveForward();
  const backward = controller.canMoveBackward();
  return (
    <div className="order-actions">
      <IconButton
        label="Send to back"
        hint="Send to back"
        icon={<PinBottomIcon />}
        disabled={!backward}
        onClick={() => controller.sendToBack()}
      />
      <IconButton
        label="Move back"
        hint="Move back one"
        icon={<ArrowDownIcon />}
        disabled={!backward}
        onClick={() => controller.moveBackward()}
      />
      <IconButton
        label="Move forward"
        hint="Move forward one"
        icon={<ArrowUpIcon />}
        disabled={!forward}
        onClick={() => controller.moveForward()}
      />
      <IconButton
        label="Bring to front"
        hint="Bring to front"
        icon={<PinTopIcon />}
        disabled={!forward}
        onClick={() => controller.bringToFront()}
      />
    </div>
  );
}

/** One selected thing, reduced to what the shared editor needs to know about it. */
interface Subject {
  id: string;
  ref: string;
  /** The parameters its component declares. */
  params: ParamDef[];
  /** The values it actually stores; a name missing here falls back to the def's default. */
  values: Record<string, unknown>;
  node: Node | null;
  resizable: boolean;
}

function subjectsOf(controller: EditorController, ids: string[]): Subject[] {
  const graph = controller.getGraph();
  const out: Subject[] = [];
  for (const id of ids) {
    const info = graph.nodes.get(id);
    if (info) {
      out.push({
        id,
        ref: info.node.componentRef,
        params: info.def?.params ?? [],
        values: info.node.params,
        node: info.node,
        resizable: info.def?.resizable !== false,
      });
      continue;
    }
    const conn = graph.connections.get(id);
    if (conn) {
      out.push({
        id,
        ref: conn.conn.componentRef,
        params: controller.registry.get(conn.conn.componentRef)?.def.params ?? [],
        values: conn.conn.params,
        node: null,
        resizable: false,
      });
    }
  }
  return out;
}

/**
 * The parameters every subject declares, in the first one's order.
 *
 * Matching is by name *and* shape: two components that both call something `stroke` but mean
 * a colour in one and a dash pattern in the other have nothing in common, and writing one
 * editor's value into the other would only corrupt it. Enums additionally have to offer the
 * same options, or the value the picker shows may not be one the other component accepts.
 */
function commonParams(subjects: Subject[]): ParamDef[] {
  const [first, ...rest] = subjects;
  if (!first) return [];
  return first.params.filter(
    (param) =>
      !param.hidden &&
      rest.every((other) =>
        other.params.some(
          (q) =>
            q.name === param.name &&
            q.type === param.type &&
            !q.hidden &&
            (q.type !== 'enum' || String(q.options) === String(param.options)),
        ),
      ),
  );
}

/** The one value every subject agrees on, or null when they disagree. */
function shared<S, T>(subjects: readonly S[], read: (s: S) => T): { value: T } | null {
  if (subjects.length === 0) return null;
  const first = read(subjects[0]);
  return subjects.every((s) => Object.is(read(s), first)) ? { value: first } : null;
}

/**
 * The inspector for a multiple selection.
 *
 * It shows the properties the selected things have in common — the *property*, not the value:
 * a field appears as long as every subject has one by that name, and carries a value only when
 * they all already agree on it. A field left blank is not "empty", it is "various"; typing into
 * one writes it to every subject at once, as a single undo step.
 */
function MultiInspector({ controller, ids }: { controller: EditorController; ids: string[] }): JSX.Element | null {
  const subjects = subjectsOf(controller, ids);
  if (subjects.length === 0) return null;

  const nodes = subjects.filter((s): s is Subject & { node: Node } => Boolean(s.node));
  const allNodes = nodes.length === subjects.length;
  const resizable = allNodes && nodes.every((s) => s.resizable);
  const refs = [...new Set(subjects.map((s) => s.ref))];

  const edit = (label: string, fn: (s: Subject) => void): void => {
    controller.store.transact(label, () => {
      for (const s of subjects) fn(s);
    });
  };

  const setTransform = (key: 'x' | 'y' | 'rot', value: number): void =>
    edit('move selection', (s) => {
      if (s.node) controller.store.updateNode(s.id, (n) => ({ transform: { ...n.transform, [key]: value } }));
    });

  const setSize = (key: 'w' | 'h', value: number): void =>
    edit('resize selection', (s) => {
      if (s.node) controller.store.updateNode(s.id, (n) => ({ size: { ...n.size, [key]: value } }));
    });

  const setParam = (name: string, value: unknown): void =>
    edit('edit selection', (s) => {
      if (s.node) controller.store.updateNode(s.id, (n) => ({ params: { ...n.params, [name]: value } }));
      else controller.store.updateConnection(s.id, (c) => ({ params: { ...c.params, [name]: value } }));
    });

  const params = commonParams(subjects);
  const values: Record<string, unknown> = {};
  const mixed = new Set<string>();
  for (const param of params) {
    const agreed = shared(subjects, (s) => s.values[param.name] ?? s.params.find((q) => q.name === param.name)?.default);
    if (agreed) values[param.name] = agreed.value;
    else mixed.add(param.name);
  }

  const geometry = (read: (n: Node) => number): number | null => shared(nodes, (s) => read(s.node))?.value ?? null;

  return (
    <Panel
      title={`${subjects.length} selected`}
      actions={nodes.length > 0 ? <OrderControls controller={controller} /> : undefined}
    >
      <div className="row-note">{refs.length === 1 ? refs[0] : `${refs.length} kinds of part`}</div>

      {allNodes && (
        <div className="grid-2">
          <Field label="X">
            <NumberInput value={geometry((n) => n.transform.x)} placeholder="Mixed" onCommit={(x) => setTransform('x', x)} />
          </Field>
          <Field label="Y">
            <NumberInput value={geometry((n) => n.transform.y)} placeholder="Mixed" onCommit={(y) => setTransform('y', y)} />
          </Field>
          {resizable && (
            <>
              <Field label="Width">
                <NumberInput value={geometry((n) => n.size.w)} placeholder="Mixed" onCommit={(w) => setSize('w', w)} />
              </Field>
              <Field label="Height">
                <NumberInput value={geometry((n) => n.size.h)} placeholder="Mixed" onCommit={(h) => setSize('h', h)} />
              </Field>
            </>
          )}
          <Field label="Rotation">
            <NumberInput
              value={geometry((n) => n.transform.rot)}
              step={15}
              placeholder="Mixed"
              onCommit={(rot) => setTransform('rot', rot)}
            />
          </Field>
        </div>
      )}

      <ParamEditor params={params} values={values} mixed={mixed} onChange={setParam} />

      {!allNodes && params.length === 0 && <p className="hint">These parts have no properties in common.</p>}
    </Panel>
  );
}

function AttachControl({ controller, nodeId }: { controller: EditorController; nodeId: string }): JSX.Element {  const graph = controller.getGraph();
  const options: { value: string; label: string }[] = [];
  for (const info of graph.nodes.values()) {
    if (info.id === nodeId) continue;
    for (const anchor of info.anchors) {
      options.push({ value: `${info.id}|${anchor.id}`, label: `${info.def?.name ?? info.id} · ${anchor.name}` });
    }
  }
  if (options.length === 0) return <p className="hint">No anchors available on other components.</p>;
  return (
    <SelectField
      value=""
      ariaLabel="Attach to anchor"
      placeholder="Attach to anchor…"
      options={options}
      onChange={(value) => {
        const [parentId, anchorId] = value.split('|');
        if (parentId) controller.attachTo(nodeId, parentId, anchorId);
      }}
    />
  );
}

export function ParamEditor({
  params,
  values,
  mixed,
  onChange,
}: {
  params: ParamDef[];
  values: Record<string, unknown>;
  /** Names whose subjects disagree: the control is shown, but empty rather than wrong. */
  mixed?: ReadonlySet<string>;
  onChange: (name: string, value: unknown) => void;
}): JSX.Element | null {
  const shown = params.filter((param) => !param.hidden);
  if (shown.length === 0) return null;
  return (
    <>
      <div className="subhead">Parameters</div>
      {shown.map((param) => {
        const various = mixed?.has(param.name) ?? false;
        const value = values[param.name] ?? param.default;
        if (param.type === 'boolean') {
          return (
            <CheckField
              key={param.name}
              checked={various ? 'indeterminate' : Boolean(value)}
              onChange={(checked) => onChange(param.name, checked)}
            >
              {param.label ?? param.name}
            </CheckField>
          );
        }
        if (param.type === 'enum') {
          return (
            <Field key={param.name} label={param.label ?? param.name}>
              <SelectField
                value={various ? '' : String(value ?? '')}
                placeholder={various ? 'Mixed' : undefined}
                onChange={(next) => onChange(param.name, next)}
                options={(param.options ?? []).map((option) => ({ value: option, label: option }))}
              />
            </Field>
          );
        }
        if (param.type === 'color') {
          return (
            <Field key={param.name} label={param.label ?? param.name}>
              <ColorField
                value={various ? '' : String(value ?? '#ffffff')}
                onChange={(next) => onChange(param.name, next)}
              />
            </Field>
          );
        }
        if (param.type === 'number') {
          return (
            <Field key={param.name} label={param.label ?? param.name}>
              <NumberInput
                value={various ? null : Number(value ?? 0)}
                min={param.min}
                max={param.max}
                step={param.step ?? 1}
                placeholder={various ? 'Mixed' : undefined}
                onCommit={(next) => onChange(param.name, next)}
              />
            </Field>
          );
        }
        return (
          <Field key={param.name} label={param.label ?? param.name}>
            <TextField
              value={various ? '' : String(value ?? '')}
              placeholder={various ? 'Mixed' : undefined}
              onChange={(next) => onChange(param.name, next)}
            />
          </Field>
        );
      })}
    </>
  );
}

export function DocumentPanel({ controller }: { controller: EditorController }): JSX.Element {
  const doc = controller.store.getDocument();
  const grid = doc.grid;
  const page = doc.page;

  return (
    <Panel title="Sheet">
      <Section id="sheet.grid" title="Grid">
        <div className="grid-2">
          <Field label="Cell size">
            <NumberInput value={grid.size} min={1} onCommit={(size) => controller.store.setGrid({ size })} />
          </Field>
          <Field label="Subdivisions">
            <NumberInput
              value={grid.subdivisions}
              min={1}
              max={20}
              onCommit={(subdivisions) => controller.store.setGrid({ subdivisions })}
            />
          </Field>
          <Field label="Origin X">
            <NumberInput value={grid.origin.x} onCommit={(x) => controller.store.setGrid({ origin: { ...grid.origin, x } })} />
          </Field>
          <Field label="Origin Y">
            <NumberInput value={grid.origin.y} onCommit={(y) => controller.store.setGrid({ origin: { ...grid.origin, y } })} />
          </Field>
        </div>
        <CheckField
          checked={grid.visible}
          onChange={(visible) => controller.store.setGrid({ visible })}
        >
          Show grid
        </CheckField>
        <CheckField checked={grid.snap} onChange={(snap) => controller.store.setGrid({ snap })}>
          Snap to grid
        </CheckField>
      </Section>

      <Section id="sheet.page" title="Page">
        <Field label="Size">
          <SelectField
            value={page?.preset ?? 'none'}
            ariaLabel="Page size"
            options={[
              { value: 'none', label: 'No page (infinite canvas)' },
              ...Object.keys(PAGE_PRESETS).map((preset) => ({ value: preset, label: preset })),
            ]}
            onChange={(preset) => {
              if (preset === 'none') {
                controller.store.setPage(null);
                controller.store.setLegend(null);
              } else {
                controller.store.setPage(makePage(preset, page?.orientation ?? 'landscape'));
                if (!doc.legend) controller.store.setLegend({ componentRef: 'base/title-block', fields: {} });
              }
            }}
          />
        </Field>

        {page && (
          <>
            <Field label="Orientation">
              <SelectField
                value={page.orientation}
                ariaLabel="Orientation"
                options={[
                  { value: 'landscape', label: 'Landscape' },
                  { value: 'portrait', label: 'Portrait' },
                ]}
                onChange={(next) => controller.store.setPage(makePage(page.preset, next as 'portrait' | 'landscape'))}
              />
            </Field>
            <div className="grid-2">
              <Field label="Margin (mm)">
                <NumberInput value={page.margin} min={0} onCommit={(margin) => controller.store.setPage({ ...page, margin })} />
              </Field>
              <Field label="Units / mm">
                <NumberInput
                  value={page.scale}
                  min={0.5}
                  step={0.5}
                  onCommit={(scale) => controller.store.setPage({ ...page, scale })}
                />
              </Field>
            </div>
            <CheckField
              checked={page.frame}
              onChange={(frame) => controller.store.setPage({ ...page, frame })}
            >
              Blueprint frame
            </CheckField>
            <CheckField
              checked={page.zones}
              onChange={(zones) => controller.store.setPage({ ...page, zones })}
            >
              Zone markings
            </CheckField>
          </>
        )}
      </Section>

      {page && (
        <Section id="sheet.legend" title="Legend">
          <CheckField
            checked={Boolean(doc.legend)}
            onChange={(show) =>
              controller.store.setLegend(show ? { componentRef: 'base/title-block', fields: {} } : null)
            }
          >
            Show title block
          </CheckField>
          {doc.legend && (
            <>
              <Field label="Template">
                <SelectField
                  value={doc.legend.componentRef}
                  ariaLabel="Title block template"
                  options={controller.registry
                    .all()
                    .filter((entry) => entry.def.category === 'sheet' || entry.ref === doc.legend?.componentRef)
                    .map((entry) => ({ value: entry.ref, label: entry.def.name }))}
                  onChange={(componentRef) => controller.store.setLegend({ ...doc.legend!, componentRef })}
                />
              </Field>
              <Field label="Title">
                <TextField
                  value={String(doc.meta.title ?? '')}
                  onChange={(title) => controller.store.setMeta({ title })}
                />
              </Field>
              <Field label="Author">
                <TextField
                  value={String(doc.meta.author ?? '')}
                  onChange={(author) => controller.store.setMeta({ author })}
                />
              </Field>
              <Field label="Revision">
                <TextField
                  value={String(doc.meta.revision ?? '')}
                  onChange={(revision) => controller.store.setMeta({ revision })}
                />
              </Field>
              <Field label="Date">
                <TextField
                  value={String(doc.meta.date ?? '')}
                  placeholder="today"
                  onChange={(date) => controller.store.setMeta({ date })}
                />
              </Field>
            </>
          )}
        </Section>
      )}
    </Panel>
  );
}

function describeEndpoint(ep: { kind: string; nodeId?: string; portId?: string; anchorId?: string; x?: number; y?: number }): string {
  if (ep.kind === 'free') return `(${round(ep.x ?? 0)}, ${round(ep.y ?? 0)})`;
  return `${(ep.nodeId ?? '').slice(0, 8)}·${ep.portId ?? ep.anchorId}`;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
