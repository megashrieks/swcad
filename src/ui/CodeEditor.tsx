import { useEffect, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import { languageFor } from './languages';
import { useTheme } from './theme';

export { languageFor };

interface CodeEditorProps {
  /** Text of the open file; the caller owns it, the editor only reports edits. */
  value: string;
  /** File name, used to pick the language and to keep one model — one undo stack — per file. */
  path: string;
  /**
   * Identifies the document the files belong to. Changing it throws the models away, so
   * undo in one component can never reach back into the one edited before it.
   */
  scope?: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  className?: string;
}

/**
 * Monaco bound to a single file. Each path gets its own model, so switching tabs keeps
 * the cursor, folds and undo history of the file you were in.
 */
export function CodeEditor({
  value,
  path,
  scope = '',
  onChange,
  readOnly = false,
  className = '',
}: CodeEditorProps): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const models = useRef(new Map<string, Monaco.editor.ITextModel>());
  const monaco = useRef<typeof Monaco | null>(null);
  /** Set while we push the caller's text in, so that edit is not reported back as typing. */
  const applying = useRef(false);
  const notify = useRef(onChange);
  notify.current = onChange;
  /** The document the live models belong to; see the `scope` prop. */
  const openScope = useRef(scope);
  const [ready, setReady] = useState(false);
  const { colorTheme, resolvedMode } = useTheme();

  useEffect(() => {
    let cancelled = false;
    const owned = models.current;
    // Monaco is loaded on demand: the sheet editor should not carry a code editor it
    // never shows.
    void import('./monaco')
      .then(async (module) => ({ module, mod: await module.loadMonaco() }))
      .then(({ module, mod }) => {
        if (cancelled || !host.current) return;
        monaco.current = mod;
        const made = mod.editor.create(host.current, {
          theme: module.APP_THEME,
          automaticLayout: true,
          fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
          fontSize: 12,
          lineHeight: 18,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          renderLineHighlight: 'line',
          tabSize: 2,
          insertSpaces: true,
          smoothScrolling: true,
          padding: { top: 8, bottom: 8 },
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          fixedOverflowWidgets: true,
        });
        made.onDidChangeModelContent(() => {
          if (applying.current) return;
          notify.current(made.getValue());
        });
        editor.current = made;
        setReady(true);
      });
    return () => {
      cancelled = true;
      editor.current?.dispose();
      editor.current = null;
      for (const model of owned.values()) model.dispose();
      owned.clear();
    };
  }, []);

  useEffect(() => {
    if (openScope.current === scope) return;
    openScope.current = scope;
    for (const model of models.current.values()) model.dispose();
    models.current.clear();
  }, [scope]);

  // The code pane wears the app's palette, so it has to be repainted when that changes.
  // A frame late, because the theme provider writes the new custom properties in an
  // effect of its own and the theme is built by reading them back off the document.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      if (cancelled) return;
      void import('./monaco').then((module) => module.applyEditorTheme());
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [ready, colorTheme, resolvedMode]);

  useEffect(() => {
    const mod = monaco.current;
    const made = editor.current;
    if (!ready || !mod || !made) return;

    let model = models.current.get(path);
    if (!model || model.isDisposed()) {
      const uri = mod.Uri.parse(`inmemory://package/${encodeURIComponent(scope)}/${path}`);
      model = mod.editor.getModel(uri) ?? mod.editor.createModel(value, languageFor(path), uri);
      models.current.set(path, model);
    }
    if (made.getModel() !== model) made.setModel(model);
    if (model.getValue() !== value) {
      // An edit rather than setValue: the caret and the undo stack survive changes made
      // from outside the editor, such as the annotation panel rewriting annotations.json.
      applying.current = true;
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: value }], () => null);
      applying.current = false;
    }
    made.updateOptions({ readOnly });
  }, [ready, scope, path, value, readOnly]);

  return <div ref={host} className={`code-editor${className ? ` ${className}` : ''}`} />;
}
