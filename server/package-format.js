/**
 * The component package format.
 *
 * A component is a folder, the same way a plugin is a folder in most apps:
 *
 *   components/<id>/
 *     component.json     manifest: id, name, version, params, default size
 *     document.json      the drawing, as a document — the same thing a sheet is
 *     script.js          optional behaviour, run in the sandbox
 *     README.md          optional notes
 *
 * A component *is* a project: what you draw a diagram with is what you draw a component
 * with, so the drawing is stored the way a sheet is and edited by the same editor. The
 * compiler (`src/core/library/compile.ts`) flattens that document into the SVG and
 * annotations the runtime draws, once the libraries it draws from have loaded.
 *
 * Primitives have to bottom out somewhere, so a package may instead carry its drawing as
 * markup — `shape.svg` plus an `annotations.json` saying what each element means. That is
 * how `libs/meta` (the parts everything else is drawn from) and hand-written components
 * are stored, and it is what `document.json` compiles down to.
 *
 * Nothing but `component.json` is required, and the other files do not have to be
 * declared: they are picked up by name. This module is the single implementation of
 * that contract — the dev server uses it to serve libraries, and the component editor
 * uses it to resolve the files being edited without a round trip.
 */

export const MANIFEST_FILE = 'component.json';
export const DOCUMENT_FILE = 'document.json';
export const SHAPE_FILE = 'shape.svg';
export const ANNOTATIONS_FILE = 'annotations.json';
export const SCRIPT_FILE = 'script.js';

/** Inner markup of a standalone `shape.svg`, plus the size its viewBox declares. */
export function readShape(text) {
  if (!text || !text.trim()) return { source: '', size: null };
  const open = /<svg\b[^>]*>/i.exec(text);
  if (!open) return { source: text.trim(), size: null };
  const close = text.lastIndexOf('</svg>');
  const source = text.slice(open.index + open[0].length, close === -1 ? undefined : close).trim();
  const viewBox = /viewBox\s*=\s*"([^"]+)"/i.exec(open[0]);
  let size = null;
  if (viewBox) {
    const nums = viewBox[1].trim().split(/[\s,]+/).map(Number);
    const [, , w, h] = nums;
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) size = { w, h };
  }
  return { source, size };
}

/** Wrap component geometry back up as a standalone, viewable `shape.svg`. */
export function writeShape(source, size) {
  const w = size && size.w ? size.w : 100;
  const h = size && size.h ? size.h : 100;
  const body = String(source ?? '').trim();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n${
    body ? formatSvg(body) : ''
  }\n</svg>\n`;
}

/** Pretty-print an SVG fragment: one element per line, indented by nesting depth. */
export function formatSvg(source, indent = '  ') {
  const tokens = String(source).match(/<[^>]+>|[^<]+/g) ?? [];
  const out = [];
  let depth = 1;
  for (const token of tokens) {
    if (!token.trim()) continue;
    if (token.startsWith('</')) {
      depth -= 1;
      // A closing tag that follows text content stays on the same line.
      if (out.length && !/>\s*$/.test(out[out.length - 1])) {
        out[out.length - 1] += token;
        continue;
      }
      out.push(indent.repeat(Math.max(depth, 0)) + token);
    } else if (token.startsWith('<')) {
      out.push(indent.repeat(Math.max(depth, 0)) + token);
      if (!token.endsWith('/>') && !token.startsWith('<?') && !token.startsWith('<!')) depth += 1;
    } else if (out.length) {
      out[out.length - 1] += token;
    }
  }
  return out.join('\n');
}

/** JSON.stringify for files people edit: leaf objects stay on one line while they fit. */
export function formatJson(value, indent = '', width = 110) {
  const inline = (v) => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
    if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
    const body = Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`)
      .join(', ');
    return body ? `{ ${body} }` : '{}';
  };
  const flat = inline(value);
  if (value === null || typeof value !== 'object') return flat;
  if (indent.length + flat.length <= width) return flat;
  const inner = `${indent}  `;
  const parts = Array.isArray(value)
    ? value.map((v) => inner + formatJson(v, inner, width))
    : Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${inner}${JSON.stringify(k)}: ${formatJson(v, inner, width)}`);
  if (parts.length === 0) return Array.isArray(value) ? '[]' : '{}';
  return Array.isArray(value) ? `[\n${parts.join(',\n')}\n${indent}]` : `{\n${parts.join(',\n')}\n${indent}}`;
}

/** Elements that carry an id, in document order, so annotations can be listed against them. */
export function shapeElements(shapeText) {
  const out = [];
  const re = /<\s*([a-zA-Z][\w:-]*)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(String(shapeText ?? '')))) {
    const id = /\bid\s*=\s*"([^"]*)"/.exec(m[2]);
    if (id) out.push({ tag: m[1], id: id[1] });
  }
  return out;
}

/** Element ids declared in a shape, so annotations can be checked against them. */
export function shapeIds(shapeText) {
  return new Set(shapeElements(shapeText).map((el) => el.id));
}

/**
 * Resolve the files of a package into the runtime component definition.
 *
 * `errors` are fatal (nothing can be drawn); `warnings` are things worth telling the
 * author about, such as an annotation pointing at an id the shape does not have.
 */
export function resolvePackage(files, fallbackId = 'component') {
  const errors = [];
  const warnings = [];
  const text = (name) => (name && files[name] !== undefined ? files[name] : null);

  let manifest = {};
  if (files[MANIFEST_FILE] === undefined) {
    errors.push(`${MANIFEST_FILE} is missing`);
  } else {
    try {
      manifest = JSON.parse(files[MANIFEST_FILE]);
    } catch (err) {
      errors.push(`${MANIFEST_FILE}: ${(err && err.message) || err}`);
    }
  }

  const shapeFile =
    typeof manifest.shape === 'string' ? manifest.shape : files[SHAPE_FILE] !== undefined ? SHAPE_FILE : null;
  if (typeof manifest.shape === 'string' && text(shapeFile) === null) errors.push(`${manifest.shape} is missing`);
  const shape = readShape(text(shapeFile) ?? '');

  let annotations = {};
  let annotationsFile = null;
  if (manifest.annotations && typeof manifest.annotations === 'object') {
    annotations = manifest.annotations;
  } else {
    annotationsFile =
      typeof manifest.annotations === 'string'
        ? manifest.annotations
        : files[ANNOTATIONS_FILE] !== undefined
          ? ANNOTATIONS_FILE
          : null;
    const raw = text(annotationsFile);
    if (raw !== null && raw.trim()) {
      try {
        annotations = JSON.parse(raw);
      } catch (err) {
        errors.push(`${annotationsFile}: ${(err && err.message) || err}`);
      }
    }
  }

  const scriptFile =
    typeof manifest.script === 'string' ? manifest.script : files[SCRIPT_FILE] !== undefined ? SCRIPT_FILE : null;
  if (typeof manifest.script === 'string' && text(scriptFile) === null) errors.push(`${manifest.script} is missing`);

  // The drawing as a document. Present means "this component is drawn, not typed": the
  // compiler produces the geometry and annotations from it, so whatever `shape.svg` last
  // held is only a cache and is not read.
  const documentFile = files[DOCUMENT_FILE] !== undefined ? DOCUMENT_FILE : null;
  let document = null;
  if (documentFile) {
    try {
      document = JSON.parse(files[documentFile]);
    } catch (err) {
      errors.push(`${documentFile}: ${(err && err.message) || err}`);
    }
  }

  const ids = shapeIds(text(shapeFile) ?? '');
  if (!documentFile) {
    for (const id of Object.keys(annotations)) {
      if (!ids.has(id)) warnings.push(`annotation "${id}" has no element with that id in the shape`);
    }
  }

  const def = {
    id: manifest.id || fallbackId,
    name: manifest.name || manifest.id || fallbackId,
    version: manifest.version || '1.0.0',
    category: manifest.category,
    description: manifest.description,
    connector: manifest.connector,
    params: Array.isArray(manifest.params) ? manifest.params : [],
    geometry: { type: 'svg', source: shape.source },
    annotations,
    defaultSize: manifest.defaultSize || shape.size || undefined,
    resizable: manifest.resizable,
    marker: manifest.marker,
  };
  if (scriptFile) def.script = scriptFile;
  if (document) def.document = document;

  return {
    def,
    manifest,
    document,
    documentFile,
    shapeFile,
    annotationsFile,
    scriptFile,
    script: text(scriptFile),
    errors,
    warnings,
  };
}

/**
 * Turn an already-compiled definition back into package files. Used to import legacy
 * single-file components: the SVG is copied across verbatim, never reverse-engineered.
 */
export function packageFromDefinition(def, script) {
  const manifest = {
    id: def.id,
    name: def.name,
    version: def.version || '1.0.0',
    category: def.category,
    description: def.description,
  };
  if (def.connector) manifest.connector = true;
  if (def.resizable !== undefined) manifest.resizable = def.resizable;
  const source = String(def.geometry?.source ?? '').replace(/^\s*<g\s*>([\s\S]*)<\/g>\s*$/, '$1');
  if (def.defaultSize && !source.trim()) manifest.defaultSize = def.defaultSize;
  manifest.params = def.params ?? [];

  const files = { [MANIFEST_FILE]: `${formatJson(manifest)}\n` };
  if (source.trim()) files[SHAPE_FILE] = writeShape(source, def.defaultSize);
  if (def.annotations && Object.keys(def.annotations).length) {
    files[ANNOTATIONS_FILE] = `${formatJson(def.annotations)}\n`;
  }
  if (script && script.trim()) files[SCRIPT_FILE] = script;
  return files;
}
