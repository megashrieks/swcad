import type { Annotation, AnnotationKind } from '@core/model/types';
import { Field, Panel } from '../editor/panels/Panels';
import { NumberInput } from '../ui/NumberInput';

const KINDS: { value: AnnotationKind | 'none'; label: string }[] = [
  { value: 'none', label: '— none —' },
  { value: 'port', label: 'port' },
  { value: 'label', label: 'label' },
  { value: 'handle', label: 'handle' },
  { value: 'fill_slot', label: 'fill slot' },
  { value: 'anchor', label: 'anchor' },
  { value: 'hit_area', label: 'hit area' },
];

const SHORT: Record<AnnotationKind, string> = {
  port: 'port',
  label: 'label',
  handle: 'handle',
  fill_slot: 'slot',
  anchor: 'anchor',
  hit_area: 'hit',
};

/** A blank annotation of each kind, so switching kind gives something usable. */
function blank(kind: AnnotationKind, id: string): Annotation {
  switch (kind) {
    case 'port':
      return { kind, name: id, direction: 'inout' };
    case 'label':
      return { kind, bind: 'params.title', align: 'center', editable: true };
    case 'handle':
      return { kind, drives: ['size.w', 'size.h'], axis: 'both' };
    case 'fill_slot':
      return { kind, name: id };
    case 'anchor':
      return { kind, name: id };
    case 'hit_area':
      return { kind };
  }
}

/**
 * Attach meaning to the elements of `shape.svg`. Every id in the shape gets a row; the
 * form writes straight back into `annotations.json`, so this panel and the file are two
 * views of the same thing.
 */
export function AnnotationPanel({
  elements,
  annotations,
  onChange,
  selected,
  onSelect,
  disabled,
  note,
}: {
  elements: { tag: string; id: string }[];
  annotations: Record<string, Annotation>;
  onChange: (next: Record<string, Annotation>) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  disabled?: boolean;
  note?: string | null;
}): JSX.Element {
  const known = new Set(elements.map((el) => el.id));
  const orphans = Object.keys(annotations).filter((id) => !known.has(id));

  const set = (id: string, patch: Partial<Annotation> | null): void => {
    const next = { ...annotations };
    if (patch === null) delete next[id];
    else next[id] = { ...(next[id] as object), ...patch } as Annotation;
    onChange(next);
  };

  const setKind = (id: string, kind: AnnotationKind | 'none'): void => {
    if (kind === 'none') {
      const next = { ...annotations };
      delete next[id];
      onChange(next);
      return;
    }
    onChange({ ...annotations, [id]: blank(kind, id) });
  };

  const row = (id: string, tag: string | null, missing: boolean): JSX.Element => {
    const ann = annotations[id];
    const open = selected === id;
    return (
      <div key={id} className={`ann-row${open ? ' is-open' : ''}${missing ? ' is-missing' : ''}`}>
        <button type="button" className="ann-head" onClick={() => onSelect(open ? null : id)}>
          <code>{id}</code>
          {tag ? <span className="ann-tag">{tag}</span> : null}
          <span className="spacer" />
          {missing ? <span className="tag warn">no element</span> : null}
          {ann ? <span className="tag">{SHORT[ann.kind]}</span> : null}
        </button>
        {open ? (
          <div className="ann-body">
            <Field label="Kind">
              <select
                className="input"
                disabled={disabled}
                value={ann?.kind ?? 'none'}
                onChange={(e) => setKind(id, e.target.value as AnnotationKind | 'none')}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </Field>
            {ann ? <AnnotationFields id={id} ann={ann} set={set} disabled={disabled} /> : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <Panel title="Elements">
      {note ? <p className="hint">{note}</p> : null}
      {elements.length === 0 ? <p className="hint">No elements with an id in shape.svg yet.</p> : null}
      {elements.map((el) => row(el.id, el.tag, false))}
      {orphans.map((id) => row(id, null, true))}
    </Panel>
  );
}

function AnnotationFields({
  id,
  ann,
  set,
  disabled,
}: {
  id: string;
  ann: Annotation;
  set: (id: string, patch: Partial<Annotation> | null) => void;
  disabled?: boolean;
}): JSX.Element | null {
  const patch = (p: Record<string, unknown>): void => set(id, p as Partial<Annotation>);

  if (ann.kind === 'port') {
    const facing = ann.facing ?? [0, 0];
    return (
      <>
        <Field label="Name">
          <input className="input" disabled={disabled} value={ann.name ?? ''} onChange={(e) => patch({ name: e.target.value })} />
        </Field>
        <div className="grid-2">
          <Field label="Direction">
            <select className="input" disabled={disabled} value={ann.direction ?? 'inout'} onChange={(e) => patch({ direction: e.target.value })}>
              {['in', 'out', 'inout', 'none'].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </Field>
          <Field label="Surface">
            <select className="input" disabled={disabled} value={ann.surface ?? 'point'} onChange={(e) => patch({ surface: e.target.value })}>
              <option value="point">point</option>
              <option value="outline">outline</option>
            </select>
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Facing x">
            <NumberInput
              disabled={disabled}
              value={facing[0]}
              onCommit={(x) => patch({ facing: [x, facing[1]] })}
            />
          </Field>
          <Field label="Facing y">
            <NumberInput
              disabled={disabled}
              value={facing[1]}
              onCommit={(y) => patch({ facing: [facing[0], y] })}
            />
          </Field>
        </div>
      </>
    );
  }

  if (ann.kind === 'label') {
    return (
      <>
        <Field label="Binds to">
          <input className="input" disabled={disabled} value={ann.bind} onChange={(e) => patch({ bind: e.target.value })} />
        </Field>
        <div className="grid-2">
          <Field label="Align">
            <select className="input" disabled={disabled} value={ann.align ?? 'start'} onChange={(e) => patch({ align: e.target.value })}>
              {['start', 'center', 'end'].map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Field>
          <label className="check">
            <input
              type="checkbox"
              disabled={disabled}
              checked={ann.editable !== false}
              onChange={(e) => patch({ editable: e.target.checked })}
            />
            <span>Editable</span>
          </label>
        </div>
      </>
    );
  }

  if (ann.kind === 'handle') {
    return (
      <>
        <Field label="Drives (comma separated)">
          <input
            className="input"
            disabled={disabled}
            value={(ann.drives ?? []).join(', ')}
            onChange={(e) => patch({ drives: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
          />
        </Field>
        <div className="grid-2">
          <Field label="Axis">
            <select className="input" disabled={disabled} value={ann.axis ?? 'both'} onChange={(e) => patch({ axis: e.target.value })}>
              {['x', 'y', 'both', 'radial'].map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Field>
          <Field label="Minimum">
            <NumberInput disabled={disabled} value={ann.min ?? 0} onCommit={(min) => patch({ min })} />
          </Field>
        </div>
      </>
    );
  }

  if (ann.kind === 'hit_area') return null;

  return (
    <Field label="Name">
      <input className="input" disabled={disabled} value={ann.name ?? ''} onChange={(e) => patch({ name: e.target.value })} />
    </Field>
  );
}
