import { useState } from 'react';
import { FilePlusIcon } from '@radix-ui/react-icons';
import type { LoadedLibrary } from '@core/model/types';
import { Dialog } from '../ui/Dialog';
import { SelectField } from '../ui/Field';
import { Button } from '../ui/pomavo';

/**
 * Where to write a component that has nowhere to be written yet.
 *
 * A component that came from disk saves itself back over the files it was opened from, so
 * it never asks. This is for the two cases that have no answer: a component scaffolded from
 * a template, and a copy of one that lives in a read-only library. Both need a library
 * picked before anything can be written, and neither has a sensible default to guess.
 *
 * The id is not editable here — it belongs to the manifest, and is edited there.
 */
export function SaveIntoDialog({
  id,
  libs,
  value,
  onNewLibrary,
  onConfirm,
  onDismiss,
}: {
  /** Component id, which decides the folder inside whichever library is chosen. */
  id: string;
  /** The libraries that can be written to. */
  libs: LoadedLibrary[];
  /** Library to start on, if it is still a writable one. */
  value: string;
  /** Create a library and return its id, so a first save need not be a dead end. */
  onNewLibrary: () => Promise<string | null>;
  onConfirm: (libId: string) => void;
  onDismiss: () => void;
}): JSX.Element {
  const [lib, setLib] = useState(() => (libs.some((l) => l.manifest.id === value) ? value : (libs[0]?.manifest.id ?? '')));

  return (
    <Dialog
      title="Save component"
      onDismiss={onDismiss}
      actions={
        <>
          <Button type="button" variant="ghost" size="sm" className="btn font-normal" onClick={onDismiss}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
           
            disabled={lib === ''}
            onClick={() => onConfirm(lib)}
          >
            Save
          </Button>
        </>
      }
    >
      <label className="field">
        <span>Save into</span>
        <SelectField
          value={lib}
          ariaLabel="Save into"
          placeholder="— pick a library —"
          options={libs.map((l) => ({ value: l.manifest.id, label: l.manifest.id }))}
          onChange={setLib}
        />
      </label>
      {libs.length === 0 ? (
        <p className="hint warn">Every library in this project is read-only. Make one to save into.</p>
      ) : (
        <p className="hint">
          Files go to <code>{lib ? `libs/${lib}/components/${id}/` : '…'}</code>
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
              if (made) setLib(made);
            })
          }
        >
          <span className="btn-icon" aria-hidden="true">
            <FilePlusIcon />
          </span>
          New library
        </Button>
      </div>
    </Dialog>
  );
}
