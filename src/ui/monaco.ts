/**
 * Monaco, wired up for this app: workers bundled with the build rather than pulled from a
 * CDN, a theme built from the app's own palette so the code pane follows whatever the
 * chrome is wearing, and language defaults suited to component packages. Imported
 * dynamically by `CodeEditor`, so the sheet editor never pays for it.
 */
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { readHexColor } from './canvasPalette';

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
    /** Handy in devtools, and how the e2e tests read and write the code pane. */
    monaco?: typeof monaco;
  }
}

export const APP_THEME = 'swcad';

let configured = false;

/**
 * The palette the code pane paints with, as custom properties.
 *
 * Chrome first, then the six hues. The hues are the legacy `--mk-*` slots, which are no
 * longer Monokai's: they are fed by the active theme's destructive colour and its five
 * chart colours, so a theme that has never heard of a syntax highlighter still supplies a
 * coherent set of six distinguishable colours for one.
 */
const INK = {
  bg: '--well',
  widget: '--bg',
  fg: '--text',
  muted: '--muted',
  faint: '--faint',
  line: '--line',
  hover: '--hover',
  sunken: '--sunken',
  accent: '--accent',
  accent2: '--accent-2',
  danger: '--danger',
  red: '--mk-red',
  orange: '--mk-orange',
  yellow: '--mk-yellow',
  green: '--mk-green',
  cyan: '--mk-cyan',
  purple: '--mk-purple',
} as const;

type Ink = Record<keyof typeof INK, string>;

function readInk(): Ink {
  const out = {} as Ink;
  for (const [key, cssVar] of Object.entries(INK)) {
    out[key as keyof typeof INK] = readHexColor(cssVar, '#808080');
  }
  return out;
}

/** Perceived lightness of an opaque `#rrggbb`, for deciding which base theme to inherit. */
function isLight(hex: string): boolean {
  const [r, g, b] = bytes(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
}

type Rgb = [number, number, number];

function bytes(hex: string): Rgb {
  const n = parseInt(hex.slice(1, 7), 16);
  if (Number.isNaN(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = ([r, g, b]: Rgb): string =>
  `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

function luminance([r, g, b]: Rgb): number {
  const channel = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const blend = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * Drag a hue toward the foreground until it is readable on the background.
 *
 * The six hues come from the theme's chart colours, which were chosen to sit next to each
 * other in a legend — not to be read as small text on the editor's background. A mid
 * yellow on a light theme measures under 2:1, which is unreadable for the string literals
 * that make up most of a manifest. Blending toward the foreground fixes the lightness
 * while keeping enough of the hue to tell the tokens apart, and it terminates because a
 * full blend *is* the foreground.
 */
function legible(hex: string, bg: Rgb, fg: Rgb, min = 4): string {
  const colour = bytes(hex);
  if (contrast(colour, bg) >= min) return hex;
  for (let t = 0.1; t < 1; t += 0.1) {
    const mixed = blend(colour, fg, t);
    if (contrast(mixed, bg) >= min) return toHex(mixed);
  }
  return toHex(fg);
}

/** Token rules take six digits and no `#`; anything translucent has to lose its alpha. */
const rule = (hex: string): string => hex.replace('#', '').slice(0, 6);

/**
 * Build the editor theme from the palette as it stands right now.
 *
 * The base is chosen from the actual background rather than from the light/dark switch,
 * so a light theme left on "dark" mode — or the reverse — still gets legible defaults for
 * the parts no rule below covers.
 */
function buildTheme(ink: Ink): monaco.editor.IStandaloneThemeData {
  const bg = bytes(ink.bg);
  const fg = bytes(ink.fg);
  const hue = (name: keyof Ink): string => rule(legible(ink[name], bg, fg));
  // Comments and punctuation are meant to recede, but not to vanish: the app's muted
  // colour is measured against the app's background, and the code pane's is a shade off.
  const quiet = rule(legible(ink.muted, bg, fg, 3));
  return {
    base: isLight(ink.bg) ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: rule(ink.fg) },
      { token: 'comment', foreground: quiet, fontStyle: 'italic' },
      { token: 'string', foreground: hue('yellow') },
      { token: 'string.key.json', foreground: rule(ink.fg) },
      { token: 'string.value.json', foreground: hue('yellow') },
      { token: 'number', foreground: hue('purple') },
      { token: 'keyword', foreground: hue('red') },
      { token: 'keyword.json', foreground: hue('purple') },
      { token: 'operator', foreground: hue('red') },
      { token: 'delimiter', foreground: quiet },
      { token: 'type', foreground: hue('cyan') },
      { token: 'identifier', foreground: rule(ink.fg) },
      { token: 'tag', foreground: hue('red') },
      { token: 'metatag', foreground: quiet },
      { token: 'attribute.name', foreground: hue('green') },
      { token: 'attribute.value', foreground: hue('yellow') },
    ],
    colors: {
      // The pane behind the editor is `--well`; matching it means no seam at the edges.
      'editor.background': ink.bg,
      'editor.foreground': ink.fg,
      'editor.lineHighlightBackground': ink.sunken,
      'editor.selectionBackground': ink.hover,
      'editor.inactiveSelectionBackground': ink.sunken,
      'editorCursor.foreground': ink.accent,
      'editorLineNumber.foreground': ink.faint,
      'editorLineNumber.activeForeground': ink.fg,
      'editorGutter.background': ink.bg,
      'editorIndentGuide.background1': ink.line,
      'editorIndentGuide.activeBackground1': ink.muted,
      'editorWhitespace.foreground': ink.line,
      'editorBracketMatch.background': ink.hover,
      'editorBracketMatch.border': ink.accent2,
      // Widgets float above the pane, so they take the step of background that every
      // other floating surface in the app takes.
      'editorWidget.background': ink.widget,
      'editorWidget.border': ink.line,
      'editorWidget.foreground': ink.fg,
      'editorSuggestWidget.background': ink.widget,
      'editorSuggestWidget.border': ink.line,
      'editorSuggestWidget.foreground': ink.fg,
      'editorSuggestWidget.selectedBackground': ink.hover,
      'editorSuggestWidget.highlightForeground': ink.accent,
      'editorHoverWidget.background': ink.widget,
      'editorHoverWidget.border': ink.line,
      'editorError.foreground': ink.danger,
      'editorWarning.foreground': ink.orange,
      'editorGutter.modifiedBackground': ink.accent2,
      'input.background': ink.widget,
      'input.foreground': ink.fg,
      'input.border': ink.line,
      'focusBorder': ink.accent,
      'scrollbarSlider.background': ink.sunken,
      'scrollbarSlider.hoverBackground': ink.hover,
      'scrollbarSlider.activeBackground': ink.hover,
      'minimap.background': ink.bg,
    },
  };
}

/**
 * Rebuild the theme from the palette and apply it to every open editor.
 *
 * Monaco themes are global and named, so redefining under the same name and setting it
 * again is the whole of it — no editor has to be recreated. Called once at startup and
 * then whenever the app's theme changes.
 */
export function applyEditorTheme(): void {
  monaco.editor.defineTheme(APP_THEME, buildTheme(readInk()));
  monaco.editor.setTheme(APP_THEME);
}

function configure(): void {
  window.MonacoEnvironment = {
    getWorker(_id, label) {
      if (label === 'json') return new JsonWorker();
      if (label === 'javascript' || label === 'typescript') return new TsWorker();
      return new EditorWorker();
    },
  };

  applyEditorTheme();

  // Manifests and annotations are plain data files: validate the syntax, but never go
  // looking for a schema over the network.
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    enableSchemaRequest: false,
    schemas: [],
  });

  // Component scripts are ES modules that import host modules like `lib:style`, which the
  // checker cannot resolve. Syntax errors are worth flagging; missing imports are not.
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    allowNonTsExtensions: true,
  });

  window.monaco = monaco;
  configured = true;
}

/** The configured Monaco namespace, set up on first use. */
export async function loadMonaco(): Promise<typeof monaco> {
  if (!configured) configure();
  return monaco;
}
