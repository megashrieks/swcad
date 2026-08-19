/**
 * Monaco, wired up for this app: workers bundled with the build rather than pulled from a
 * CDN, a Monokai Pro theme so the code pane matches the rest of the chrome, and language
 * defaults suited to component packages. Imported dynamically by `CodeEditor`, so the
 * sheet editor never pays for it.
 */
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
    /** Handy in devtools, and how the e2e tests read and write the code pane. */
    monaco?: typeof monaco;
  }
}

export const MONOKAI_PRO = 'monokai-pro';

let configured = false;

function configure(): void {
  window.MonacoEnvironment = {
    getWorker(_id, label) {
      if (label === 'json') return new JsonWorker();
      if (label === 'javascript' || label === 'typescript') return new TsWorker();
      return new EditorWorker();
    },
  };

  monaco.editor.defineTheme(MONOKAI_PRO, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'fcfcfa' },
      { token: 'comment', foreground: '727072', fontStyle: 'italic' },
      { token: 'string', foreground: 'ffd866' },
      { token: 'string.key.json', foreground: 'fcfcfa' },
      { token: 'string.value.json', foreground: 'ffd866' },
      { token: 'number', foreground: 'ab9df2' },
      { token: 'keyword', foreground: 'ff6188' },
      { token: 'keyword.json', foreground: 'ab9df2' },
      { token: 'operator', foreground: 'ff6188' },
      { token: 'delimiter', foreground: '939293' },
      { token: 'type', foreground: '78dce8' },
      { token: 'identifier', foreground: 'fcfcfa' },
      { token: 'tag', foreground: 'ff6188' },
      { token: 'metatag', foreground: '727072' },
      { token: 'attribute.name', foreground: 'a9dc76' },
      { token: 'attribute.value', foreground: 'ffd866' },
    ],
    colors: {
      'editor.background': '#19181a',
      'editor.foreground': '#fcfcfa',
      'editor.lineHighlightBackground': '#221f22',
      'editor.selectionBackground': '#403e41',
      'editor.inactiveSelectionBackground': '#2d2a2e',
      'editorCursor.foreground': '#fcfcfa',
      'editorLineNumber.foreground': '#5b595c',
      'editorLineNumber.activeForeground': '#c1c0c0',
      'editorGutter.background': '#19181a',
      'editorIndentGuide.background1': '#2d2a2e',
      'editorIndentGuide.activeBackground1': '#5b595c',
      'editorWhitespace.foreground': '#403e41',
      'editorBracketMatch.background': '#403e41',
      'editorBracketMatch.border': '#78dce8',
      'editorWidget.background': '#221f22',
      'editorWidget.border': '#5b595c',
      'editorSuggestWidget.background': '#221f22',
      'editorSuggestWidget.selectedBackground': '#403e41',
      'editorHoverWidget.background': '#221f22',
      'editorError.foreground': '#ff6188',
      'editorWarning.foreground': '#ffd866',
      'scrollbarSlider.background': '#403e4188',
      'scrollbarSlider.hoverBackground': '#5b595caa',
      'scrollbarSlider.activeBackground': '#727072cc',
      'minimap.background': '#19181a',
    },
  });

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
