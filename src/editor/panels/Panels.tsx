import { useMemo, useState } from 'react';
import { LinkBreak2Icon, Pencil1Icon, TrashIcon } from '@radix-ui/react-icons';
import type { ComponentEntry } from '@core/library/registry';
import type { ParamDef } from '@core/model/types';
import { PAGE_PRESETS, makePage } from '@core/model/types';
import type { EditorController } from '../EditorController';
import { staticMarkup } from '../render';
import { NumberInput } from '../../ui/NumberInput';

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

function ComponentPreview({ entry }: { entry: ComponentEntry }): JSX.Element {
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

export function LibraryPanel({
  controller,
  hideLibs,
  onPick,
  onEdit,
  onDelete,
}: {
  controller: EditorController;
  hideLibs?: string[];
  /** Overrides the default click action (arming placement on the canvas). */
  onPick?: (entry: ComponentEntry) => void;
  /** Open a component for editing. Shown per item when supplied. */
  onEdit?: (entry: ComponentEntry) => void;
  /** Delete a component from its library. Only offered for writable libraries. */
  onDelete?: (entry: ComponentEntry) => void;
}): JSX.Element {
  const [filter, setFilter] = useState('');
  const entries = controller.registry.all();
  const byLib = new Map<string, ComponentEntry[]>();
  for (const entry of entries) {
    if (hideLibs?.includes(entry.libId)) continue;
    if (filter && !`${entry.def.name} ${entry.ref}`.toLowerCase().includes(filter.toLowerCase())) continue;
    const list = byLib.get(entry.libId) ?? [];
    list.push(entry);
    byLib.set(entry.libId, list);
  }

  return (
    <Panel title="Libraries">
      <input
        className="input"
        placeholder="Filter components"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {[...byLib.entries()].map(([libId, list]) => {
        const lib = controller.registry.library(libId);
        // In-memory palettes (the meta primitives, the live draft) have no files to open.
        const onDisk = Boolean(lib && !/^(builtin|memory):/.test(lib.dir));
        const editable = onEdit && onDisk;
        const deletable = onDelete && onDisk && !lib?.readOnly;
        return (
          <div key={libId} className="lib-group">
            <div className="lib-name">
              {libId}
              {lib?.readOnly ? <span className="tag">read-only</span> : null}
            </div>
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
                      controller.tool = entry.def.connector ? 'connect' : 'place';
                      controller.notify();
                    }}
                    onDoubleClick={!onPick && editable ? () => onEdit!(entry) : undefined}
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
                          onClick={() => onEdit!(entry)}
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
          </div>
        );
      })}
    </Panel>
  );
}

/** True when the selection has something the inspector can show. */
export function hasInspectorTarget(controller: EditorController): boolean {
  const graph = controller.getGraph();
  for (const id of controller.selection) {
    if (graph.nodes.has(id) || graph.connections.has(id)) return true;
  }
  return false;
}

export function InspectorPanel({ controller }: { controller: EditorController }): JSX.Element | null {
  const graph = controller.getGraph();
  const selected = [...controller.selection];
  const nodeId = selected.find((id) => graph.nodes.has(id));
  const connId = selected.find((id) => graph.connections.has(id));
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
      </Panel>
    );
  }

  if (!info) return null;
  const node = info.node;

  return (
    <Panel title={info.def?.name ?? 'Component'}>
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

      <div className="subhead">Ports</div>
      <ul className="list">
        {info.ports.map((port) => (
          <li key={port.id}>
            <span className={`dot${port.connected ? ' is-connected' : ''}`} />
            {port.name}
            <span className="muted">
              {port.direction} · {port.connections.length} link{port.connections.length === 1 ? '' : 's'}
            </span>
          </li>
        ))}
        {info.ports.length === 0 && <li className="muted">no ports</li>}
      </ul>

      {info.anchors.length > 0 && (
        <>
          <div className="subhead">Attachment</div>
          {node.attachment ? (
            <div className="row">
              <span className="muted">
                pinned to {node.attachment.parentId.slice(0, 8)} · {node.attachment.anchorId}
              </span>
              <button type="button" className="btn" title="Unpin from the parent" onClick={() => controller.detach(node.id)}>
                <span className="btn-icon" aria-hidden="true">
                  <LinkBreak2Icon />
                </span>
                Detach
              </button>
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
    </Panel>
  );
}

function AttachControl({ controller, nodeId }: { controller: EditorController; nodeId: string }): JSX.Element {
  const graph = controller.getGraph();
  const options: { value: string; label: string }[] = [];
  for (const info of graph.nodes.values()) {
    if (info.id === nodeId) continue;
    for (const anchor of info.anchors) {
      options.push({ value: `${info.id}|${anchor.id}`, label: `${info.def?.name ?? info.id} · ${anchor.name}` });
    }
  }
  if (options.length === 0) return <p className="hint">No anchors available on other components.</p>;
  return (
    <select
      className="input"
      defaultValue=""
      onChange={(e) => {
        const [parentId, anchorId] = e.target.value.split('|');
        if (parentId) controller.attachTo(nodeId, parentId, anchorId);
      }}
    >
      <option value="">Attach to anchor…</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ParamEditor({
  params,
  values,
  onChange,
}: {
  params: ParamDef[];
  values: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
}): JSX.Element | null {
  if (params.length === 0) return null;
  return (
    <>
      <div className="subhead">Parameters</div>
      {params.map((param) => {
        const value = values[param.name] ?? param.default;
        if (param.type === 'boolean') {
          return (
            <label key={param.name} className="check">
              <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(param.name, e.target.checked)} />
              <span>{param.label ?? param.name}</span>
            </label>
          );
        }
        if (param.type === 'enum') {
          return (
            <Field key={param.name} label={param.label ?? param.name}>
              <select className="input" value={String(value ?? '')} onChange={(e) => onChange(param.name, e.target.value)}>
                {(param.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
          );
        }
        if (param.type === 'color') {
          return (
            <Field key={param.name} label={param.label ?? param.name}>
              <input type="color" className="input color" value={String(value ?? '#ffffff')} onChange={(e) => onChange(param.name, e.target.value)} />
            </Field>
          );
        }
        if (param.type === 'number') {
          return (
            <Field key={param.name} label={param.label ?? param.name}>
              <NumberInput
                value={Number(value ?? 0)}
                min={param.min}
                max={param.max}
                step={param.step ?? 1}
                onCommit={(next) => onChange(param.name, next)}
              />
            </Field>
          );
        }
        return (
          <Field key={param.name} label={param.label ?? param.name}>
            <input className="input" value={String(value ?? '')} onChange={(e) => onChange(param.name, e.target.value)} />
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
      <div className="subhead">Grid</div>
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
      <label className="check">
        <input type="checkbox" checked={grid.visible} onChange={(e) => controller.store.setGrid({ visible: e.target.checked })} />
        <span>Show grid</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={grid.snap} onChange={(e) => controller.store.setGrid({ snap: e.target.checked })} />
        <span>Snap to grid</span>
      </label>

      <div className="subhead">Page</div>
      <Field label="Size">
        <select
          className="input"
          value={page?.preset ?? 'none'}
          onChange={(e) => {
            const preset = e.target.value;
            if (preset === 'none') {
              controller.store.setPage(null);
              controller.store.setLegend(null);
            } else {
              controller.store.setPage(makePage(preset, page?.orientation ?? 'landscape'));
              if (!doc.legend) controller.store.setLegend({ componentRef: 'base/title-block', fields: {} });
            }
          }}
        >
          <option value="none">No page (infinite canvas)</option>
          {Object.keys(PAGE_PRESETS).map((preset) => (
            <option key={preset} value={preset}>
              {preset}
            </option>
          ))}
        </select>
      </Field>

      {page && (
        <>
          <Field label="Orientation">
            <select
              className="input"
              value={page.orientation}
              onChange={(e) => controller.store.setPage(makePage(page.preset, e.target.value as 'portrait' | 'landscape'))}
            >
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
            </select>
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
          <label className="check">
            <input type="checkbox" checked={page.frame} onChange={(e) => controller.store.setPage({ ...page, frame: e.target.checked })} />
            <span>Blueprint frame</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={page.zones} onChange={(e) => controller.store.setPage({ ...page, zones: e.target.checked })} />
            <span>Zone markings</span>
          </label>

          <div className="subhead">Legend</div>
          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(doc.legend)}
              onChange={(e) =>
                controller.store.setLegend(e.target.checked ? { componentRef: 'base/title-block', fields: {} } : null)
              }
            />
            <span>Show title block</span>
          </label>
          {doc.legend && (
            <>
              <Field label="Template">
                <select
                  className="input"
                  value={doc.legend.componentRef}
                  onChange={(e) => controller.store.setLegend({ ...doc.legend!, componentRef: e.target.value })}
                >
                  {controller.registry
                    .all()
                    .filter((entry) => entry.def.category === 'sheet' || entry.ref === doc.legend?.componentRef)
                    .map((entry) => (
                      <option key={entry.ref} value={entry.ref}>
                        {entry.def.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Title">
                <input className="input" value={String(doc.meta.title ?? '')} onChange={(e) => controller.store.setMeta({ title: e.target.value })} />
              </Field>
              <Field label="Author">
                <input className="input" value={String(doc.meta.author ?? '')} onChange={(e) => controller.store.setMeta({ author: e.target.value })} />
              </Field>
              <Field label="Revision">
                <input className="input" value={String(doc.meta.revision ?? '')} onChange={(e) => controller.store.setMeta({ revision: e.target.value })} />
              </Field>
              <Field label="Date">
                <input className="input" value={String(doc.meta.date ?? '')} placeholder="today" onChange={(e) => controller.store.setMeta({ date: e.target.value })} />
              </Field>
            </>
          )}
        </>
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
