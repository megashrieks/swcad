import { EditorSurface, useController } from '../editor/EditorSurface';
import type { EditorController } from '../editor/EditorController';
import type { ComponentEntry } from '@core/library/registry';
import { DocumentPanel, hasInspectorTarget, InspectorPanel, LibraryPanel } from '../editor/panels/Panels';
import { PageFrame } from './PageFrame';

export function SheetEditor({
  controller,
  onEditComponent,
  onDeleteComponent,
}: {
  controller: EditorController;
  onEditComponent?: (entry: ComponentEntry) => void;
  onDeleteComponent?: (entry: ComponentEntry) => void;
}): JSX.Element {
  useController(controller);
  const doc = controller.store.getDocument();
  // The inspector only exists while something is selected. It floats over the canvas
  // rather than taking a column, so appearing never resizes the drawing.
  const showInspector = hasInspectorTarget(controller);

  return (
    <div className="editor-layout">
      <aside className="side left">
        <LibraryPanel controller={controller} onEdit={onEditComponent} onDelete={onDeleteComponent} />
        <DocumentPanel controller={controller} />
      </aside>

      <main className="canvas-area">
        <EditorSurface
          controller={controller}
          underlay={
            doc.page ? (
              <PageFrame page={doc.page} meta={doc.meta} legend={doc.legend} registry={controller.registry} />
            ) : null
          }
        />

        {showInspector ? (
          <aside className="side right">
            <InspectorPanel controller={controller} />
          </aside>
        ) : null}
      </main>
    </div>
  );
}
