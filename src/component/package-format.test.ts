import { describe, expect, it } from 'vitest';
import {
  ANNOTATIONS_FILE,
  MANIFEST_FILE,
  SCRIPT_FILE,
  SHAPE_FILE,
  formatJson,
  packageFromDefinition,
  readShape,
  resolvePackage,
  shapeElements,
  shapeIds,
  writeShape,
} from '../../server/package-format.js';
import type { ComponentDef } from '../core/model/types';

const manifest = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id: 'widget', name: 'Widget', version: '2.1.0', ...extra });

const shape = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 72" width="120" height="72">\n' +
  '  <rect id="body" x="0" y="0" width="120" height="72" />\n</svg>\n';

describe('readShape / writeShape', () => {
  it('takes the inner markup and the size from the viewBox', () => {
    const { source, size } = readShape(shape);
    expect(source).toBe('<rect id="body" x="0" y="0" width="120" height="72" />');
    expect(size).toEqual({ w: 120, h: 72 });
  });

  it('accepts a bare fragment with no wrapper', () => {
    expect(readShape('  <circle id="c" r="4" />  ')).toEqual({ source: '<circle id="c" r="4" />', size: null });
  });

  it('reports no size for a missing or degenerate viewBox', () => {
    expect(readShape('<svg><rect id="a" /></svg>').size).toBeNull();
    expect(readShape('<svg viewBox="0 0 0 40"><rect id="a" /></svg>').size).toBeNull();
  });

  it('round-trips through writeShape', () => {
    const first = readShape(shape);
    const written = writeShape(first.source, first.size);
    expect(readShape(written)).toEqual(first);
    expect(written).toContain('viewBox="0 0 120 72"');
  });

  it('falls back to a 100x100 box when no size is known', () => {
    expect(writeShape('<rect id="a" />', null)).toContain('viewBox="0 0 100 100"');
  });

  it('indents nested elements and keeps text on its own element line', () => {
    const written = writeShape('<g id="g"><text id="t">Hi</text></g>', { w: 10, h: 10 });
    expect(written).toContain('  <g id="g">\n    <text id="t">Hi</text>\n  </g>');
  });
});

describe('formatJson', () => {
  it('keeps a leaf object on one line while it fits', () => {
    expect(formatJson({ kind: 'port', name: 'north' })).toBe('{ "kind": "port", "name": "north" }');
  });

  it('breaks a container whose inline form is too wide', () => {
    const wide = { a: { kind: 'port', name: 'north', facing: [0, -1], direction: 'inout', accepts: ['x'] }, b: 1 };
    const out = formatJson(wide, '', 40);
    expect(out.startsWith('{\n')).toBe(true);
    expect(out).toContain('  "b": 1');
    expect(JSON.parse(out)).toEqual(wide);
  });

  it('drops undefined members and renders empties', () => {
    expect(formatJson({ a: 1, b: undefined })).toBe('{ "a": 1 }');
    expect(formatJson({})).toBe('{}');
    expect(formatJson([])).toBe('[]');
  });
});

describe('shapeElements', () => {
  it('lists only elements carrying an id, in document order', () => {
    const text = '<rect id="body" /><circle r="2" /><g id="grp"><text id="t">x</text></g>';
    expect(shapeElements(text)).toEqual([
      { tag: 'rect', id: 'body' },
      { tag: 'g', id: 'grp' },
      { tag: 'text', id: 't' },
    ]);
    expect([...shapeIds(text)]).toEqual(['body', 'grp', 't']);
  });
});

describe('resolvePackage', () => {
  it('picks up the conventional files without them being declared', () => {
    const res = resolvePackage({
      [MANIFEST_FILE]: manifest(),
      [SHAPE_FILE]: shape,
      [ANNOTATIONS_FILE]: '{ "body": { "kind": "fill_slot", "name": "body" } }',
      [SCRIPT_FILE]: 'defineComponent({})',
      'README.md': '# Widget',
    });
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(res.shapeFile).toBe(SHAPE_FILE);
    expect(res.scriptFile).toBe(SCRIPT_FILE);
    expect(res.script).toBe('defineComponent({})');
    expect(res.def.id).toBe('widget');
    expect(res.def.version).toBe('2.1.0');
    expect(res.def.geometry).toEqual({ type: 'svg', source: '<rect id="body" x="0" y="0" width="120" height="72" />' });
    expect(res.def.defaultSize).toEqual({ w: 120, h: 72 });
    expect(res.def.annotations).toEqual({ body: { kind: 'fill_slot', name: 'body' } });
  });

  it('falls back to the folder name and defaults when the manifest is bare', () => {
    const res = resolvePackage({ [MANIFEST_FILE]: '{}' }, 'thing');
    expect(res.errors).toEqual([]);
    expect(res.def).toMatchObject({ id: 'thing', name: 'thing', version: '1.0.0', params: [] });
    expect(res.def.defaultSize).toBeUndefined();
    expect(res.scriptFile).toBeNull();
  });

  it('honours manifest overrides of the file names', () => {
    const res = resolvePackage({
      [MANIFEST_FILE]: manifest({ shape: 'art.svg', script: 'main.js', annotations: 'ann.json' }),
      'art.svg': shape,
      'main.js': '// main',
      'ann.json': '{ "body": { "kind": "hit_area" } }',
    });
    expect(res.errors).toEqual([]);
    expect(res.shapeFile).toBe('art.svg');
    expect(res.scriptFile).toBe('main.js');
    expect(res.annotationsFile).toBe('ann.json');
    expect(res.def.annotations).toEqual({ body: { kind: 'hit_area' } });
  });

  it('accepts annotations inlined in the manifest', () => {
    const res = resolvePackage({
      [MANIFEST_FILE]: manifest({ annotations: { body: { kind: 'label', bind: 'params.title' } } }),
      [SHAPE_FILE]: shape,
    });
    expect(res.annotationsFile).toBeNull();
    expect(res.def.annotations).toEqual({ body: { kind: 'label', bind: 'params.title' } });
  });

  it('prefers an explicit defaultSize over the viewBox', () => {
    const res = resolvePackage({ [MANIFEST_FILE]: manifest({ defaultSize: { w: 40, h: 40 } }), [SHAPE_FILE]: shape });
    expect(res.def.defaultSize).toEqual({ w: 40, h: 40 });
  });

  it('reports a missing manifest, bad JSON and declared-but-absent files as errors', () => {
    expect(resolvePackage({}).errors).toEqual([`${MANIFEST_FILE} is missing`]);
    expect(resolvePackage({ [MANIFEST_FILE]: '{ nope }' }).errors[0]).toContain(MANIFEST_FILE);
    expect(resolvePackage({ [MANIFEST_FILE]: manifest({ shape: 'art.svg' }) }).errors).toEqual(['art.svg is missing']);
    expect(resolvePackage({ [MANIFEST_FILE]: manifest({ script: 'main.js' }) }).errors).toEqual(['main.js is missing']);
    expect(
      resolvePackage({ [MANIFEST_FILE]: manifest(), [ANNOTATIONS_FILE]: '{ oops' }).errors[0],
    ).toContain(ANNOTATIONS_FILE);
  });

  it('warns about an annotation with no matching element', () => {
    const res = resolvePackage({
      [MANIFEST_FILE]: manifest(),
      [SHAPE_FILE]: shape,
      [ANNOTATIONS_FILE]: '{ "ghost": { "kind": "port" } }',
    });
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual(['annotation "ghost" has no element with that id in the shape']);
  });
});

describe('packageFromDefinition', () => {
  it('splits a compiled definition into files and resolves back to the same component', () => {
    const def: ComponentDef = {
      id: 'widget',
      name: 'Widget',
      version: '2.1.0',
      params: [{ name: 'w', type: 'number', default: 120 }],
      geometry: { type: 'svg', source: '<g><rect id="body" width="120" height="72" /></g>' },
      annotations: { body: { kind: 'fill_slot', name: 'body' } },
      defaultSize: { w: 120, h: 72 },
    };
    const files = packageFromDefinition(def, 'defineComponent({})');
    expect(Object.keys(files).sort()).toEqual([ANNOTATIONS_FILE, MANIFEST_FILE, SCRIPT_FILE, SHAPE_FILE].sort());
    expect(files[SHAPE_FILE]).toContain('<rect id="body" width="120" height="72" />');
    expect(files[SHAPE_FILE]).not.toContain('<g>');

    const back = resolvePackage(files, 'widget');
    expect(back.errors).toEqual([]);
    expect(back.def).toMatchObject({ id: 'widget', name: 'Widget', version: '2.1.0', params: def.params });
    expect(back.def.defaultSize).toEqual(def.defaultSize);
    expect(back.def.annotations).toEqual(def.annotations);
    expect(back.script).toBe('defineComponent({})');
  });

  it('omits files a definition does not have and keeps the connector flag', () => {
    const wire: ComponentDef = {
      id: 'wire',
      name: 'Wire',
      version: '1.0.0',
      connector: true,
      params: [],
      annotations: {},
      geometry: { type: 'svg', source: '' },
      defaultSize: { w: 8, h: 8 },
    };
    const files = packageFromDefinition(wire, '');
    expect(Object.keys(files)).toEqual([MANIFEST_FILE]);
    const back = resolvePackage(files, 'wire');
    expect(back.def.connector).toBe(true);
    expect(back.def.defaultSize).toEqual({ w: 8, h: 8 });
  });
});
