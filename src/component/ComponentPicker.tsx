import { useMemo, useState } from 'react';
import { FilePlusIcon, MagnifyingGlassIcon, TrashIcon } from '@radix-ui/react-icons';
import type { ComponentEntry, LibraryRegistry } from '@core/library/registry';
import type { ComponentTemplate } from '@core/io/client';
import { ComponentPreview } from '../editor/panels/Panels';
import { Dialog } from '../ui/Dialog';
import { SelectField, TextField } from '../ui/Field';
import { Button } from '../ui/pomavo';

/**
 * The way into the component editor.
 *
 * Opening the editor used to scaffold a component on the spot, which answered a question
 * nobody had asked: most of the time you are going back to something that already exists,
 * and a blank "My component" had to be discarded first. So the editor opens on this
 * instead — every component in the project on the left, a template to start from on the
 * right — and nothing is created until you say so.
 *
 * It is also the only place either of those two things happens. The editor's sidebar is
 * about the component that is open; browsing and creating live here.
 */

/** Libraries that hold parts rather than components, and the live draft, are not offered. */
function browsable(registry: LibraryRegistry): ComponentEntry[] {
  return registry.all().filter((entry) => {
    const lib = registry.library(entry.libId);
    if (!lib || lib.manifest.editorOnly) return false;
    // In-memory libraries have no files to open, so there is nothing to edit.
    return !/^(builtin|memory):/.test(lib.dir);
  });
}

/** `my-component` → `My component`, for the human-facing name in a scaffold. */
export function titleCase(id: string): string {
  return id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** A component id nothing in the project is using yet. */
export function uniqueId(taken: string[]): string {
  const used = new Set(taken);
  if (!used.has('my-component')) return 'my-component';
  for (let i = 2; ; i += 1) if (!used.has(`my-component-${i}`)) return `my-component-${i}`;
}

export function ComponentPicker({
  registry,
  revision,
  templates,
  currentRef,
  defaultLib,
  onOpen,
  onCreate,
  onDelete,
  onNewLibrary,
  onDismiss,
}: {
  /** The project's libraries — not the editor's, which carries the draft and the parts. */
  registry: LibraryRegistry;
  /** Bumped whenever the libraries reload, so a delete or a new library shows up here. */
  revision: number;
  templates: ComponentTemplate[];
  /** What the editor has open, so the list can say so. */
  currentRef: string | null;
  /** Library the create form starts on. */
  defaultLib: string;
  /** Open one for editing. Falsy means the editor refused — keep the dialog up. */
  onOpen: (entry: ComponentEntry) => Promise<boolean>;
  onCreate: (template: ComponentTemplate, target: { id: string; name: string; libId: string }) => Promise<boolean>;
  onDelete: (entry: ComponentEntry) => Promise<void>;
  /** Make a library to save into; resolves to its id, or null if the user backed out. */
  onNewLibrary: () => Promise<string | null>;
  onDismiss: () => void;
}): JSX.Element {
  const [filter, setFilter] = useState('');
  const [template, setTemplate] = useState<string | null>(null);
  const [libId, setLibId] = useState(defaultLib);
  const entries = useMemo(() => browsable(registry), [registry, revision]);
  const [id, setId] = useState(() => uniqueId(registry.all().map((e) => e.def.id)));
  const [busy, setBusy] = useState(false);

  const writable = registry.libraries().filter((l) => !l.readOnly && !l.manifest.editorOnly);
  // Templates and libraries both land after the first render, so neither choice is stored
  // until it is made: whatever is first stands in for it in the meantime.
  const chosen = templates.find((t) => t.id === template) ?? templates[0] ?? null;
  const lib = writable.some((l) => l.manifest.id === libId) ? libId : (writable[0]?.manifest.id ?? '');

  const clean = id.trim();
  const idError = !clean
    ? 'Give the component an id.'
    : !/^[a-z0-9][a-z0-9-]*$/i.test(clean)
      ? 'Letters, digits and dashes only.'
      : !lib
        ? 'Pick a library to save into.'
        : registry.has(`${lib}/${clean}`)
          ? `${lib} already has a ${clean}.`
          : null;

  const groups = new Map<string, ComponentEntry[]>();
  const needle = filter.trim().toLowerCase();
  for (const entry of entries) {
    if (needle && !`${entry.def.name} ${entry.ref}`.toLowerCase().includes(needle)) continue;
    const list = groups.get(entry.libId) ?? [];
    list.push(entry);
    groups.set(entry.libId, list);
  }

  /** Run one of the actions, keeping the dialog up until it says it is done. */
  const run = async (action: () => Promise<boolean>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      if (await action()) onDismiss();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Components"
      size="xl"
      className="dialog-picker"
      onDismiss={onDismiss}
      actions={
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          Close
        </Button>
      }
    >
      <div className="picker">
        <section className="picker-col picker-browse">
          <header className="picker-head">
            <h3>Edit a component</h3>
            <div className="picker-search">
              <MagnifyingGlassIcon />
              <TextField placeholder="Filter components" value={filter} onChange={setFilter} />
            </div>
          </header>

          <div className="picker-list">
            {groups.size === 0 ? (
              <p className="hint">
                {entries.length === 0
                  ? 'No components on disk yet. Start one from a template.'
                  : `Nothing matches “${filter}”.`}
              </p>
            ) : (
              [...groups.entries()].map(([lib, list]) => {
                const readOnly = registry.library(lib)?.readOnly;
                return (
                  <div key={lib} className="lib-group">
                    <div className="lib-name">
                      {lib}
                      {readOnly ? <span className="tag">read-only</span> : null}
                    </div>
                    <div className="lib-grid picker-grid">
                      {list.map((entry) => (
                        <div key={entry.ref} className="lib-cell">
                          <button
                            type="button"
                            className={`lib-item${entry.ref === currentRef ? ' is-active' : ''}`}
                            title={
                              entry.readOnly
                                ? `Open ${entry.ref} as a copy — ${lib} is read-only`
                                : `Edit ${entry.ref}`
                            }
                            disabled={busy}
                            onClick={() => void run(() => onOpen(entry))}
                          >
                            <ComponentPreview entry={entry} registry={registry} />
                            <span>{entry.def.name}</span>
                          </button>
                          {readOnly ? null : (
                            <div className="lib-actions">
                              <button
                                type="button"
                                className="lib-action danger"
                                title={`Delete ${entry.def.name}`}
                                onClick={() => void onDelete(entry)}
                              >
                                <TrashIcon />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="picker-col picker-new">
          <header className="picker-head">
            <h3>New component</h3>
          </header>

          <div className="picker-templates">
            {templates.length === 0 ? (
              <p className="hint">No templates found in templates/components.</p>
            ) : (
              templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`tmpl-item${t.id === chosen?.id ? ' is-active' : ''}`}
                  onClick={() => setTemplate(t.id)}
                >
                  <strong>{t.name}</strong>
                  {t.description ? <span>{t.description}</span> : null}
                </button>
              ))
            )}
          </div>

          <label className="field">
            <span>Id</span>
            <TextField value={id} placeholder="my-component" onChange={setId} />
          </label>
          <label className="field">
            <span>Save into</span>
            <SelectField
              value={lib}
              ariaLabel="Save into"
              placeholder="— pick a library —"
              options={writable.map((l) => ({ value: l.manifest.id, label: l.manifest.id }))}
              onChange={setLibId}
            />
          </label>

          {idError ? (
            <p className="hint warn">{idError}</p>
          ) : (
            <p className="hint">
              Files go to <code>libs/{lib}/components/{clean}/</code>
            </p>
          )}

          <div className="row">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="btn font-normal"
              onClick={() =>
                void onNewLibrary().then((made) => {
                  if (made) setLibId(made);
                })
              }
            >
              <span className="btn-icon" aria-hidden="true">
                <FilePlusIcon />
              </span>
              New library
            </Button>
            <Button
              type="button"
              size="sm"
             
              disabled={busy || chosen === null || idError !== null}
              onClick={() =>
                void run(() => onCreate(chosen!, { id: clean, name: titleCase(clean), libId: lib }))
              }
            >
              Create
            </Button>
          </div>
        </section>
      </div>
    </Dialog>
  );
}
