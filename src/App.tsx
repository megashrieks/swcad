import { useEffect, useState } from 'react';
import {
  CheckIcon,
  CodeIcon,
  Component1Icon,
  CornersIcon,
  CursorArrowIcon,
  DotFilledIcon,
  FileIcon,
  FileTextIcon,
  GridIcon,
  HandIcon,
  ImageIcon,
  ResetIcon,
  Share1Icon,
  TargetIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '@radix-ui/react-icons';
import { useProject } from './editor/useProject';
import { useController } from './editor/EditorSurface';
import { SheetEditor } from './sheet/SheetEditor';
import { ComponentEditor } from './component/ComponentEditor';
import { confirmAndDelete } from './component/storage';
import type { ComponentEntry } from '@core/library/registry';
import { downloadPng, downloadText, exportSvg, printPdf } from './editor/export';
import { ButtonGroup } from './ui/ButtonGroup';
import { IconButton } from './ui/IconButton';
import type { ToolId } from './editor/EditorController';

const TOOLS: { id: ToolId; label: string; hint: string; icon: JSX.Element }[] = [
  { id: 'select', label: 'Select', hint: 'V — select, move, resize', icon: <CursorArrowIcon /> },
  { id: 'pan', label: 'Pan', hint: 'H — drag the canvas (or hold space)', icon: <HandIcon /> },
  { id: 'connect', label: 'Connect', hint: 'C — drag between ports', icon: <Share1Icon /> },
];

export function App(): JSX.Element {
  const project = useProject();
  const [mode, setMode] = useState<'sheet' | 'component'>('sheet');
  const [openRef, setOpenRef] = useState<string | null>(null);
  const controller = project.controller;
  useController(controller);

  // Editing a component from the palette hands it to the component editor.
  const editComponent = (entry: ComponentEntry): void => {
    setOpenRef(entry.ref);
    setMode('component');
  };

  const deleteComponentFromPalette = async (entry: ComponentEntry): Promise<void> => {
    try {
      const deleted = await confirmAndDelete(project.registry, controller.store.getDocument(), entry);
      if (deleted) await project.reloadLibraries();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  };

  // Ctrl+S saves the sheet regardless of focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void project.save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [project]);

  if (project.status === 'loading') {
    return <div className="boot">Opening project…</div>;
  }
  if (project.status === 'error') {
    return (
      <div className="boot error">
        <h1>Could not open the project</h1>
        <p>{project.error}</p>
        <p className="hint">Start the file server with `npm run dev` and reload.</p>
      </div>
    );
  }

  const doc = controller.store.getDocument();
  const svgOf = (onlySelection: boolean): string =>
    exportSvg(doc, controller.getGraph(), controller.registry, {
      only: onlySelection && controller.selection.size > 0 ? new Set(controller.selection) : undefined,
    });
  const baseName = (doc.meta.title || 'sheet').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">swcad</div>

        <ButtonGroup label="Editor mode">
          <IconButton
            label="Sheet"
            hint="Sheet editor"
            icon={<FileIcon />}
            active={mode === 'sheet'}
            onClick={() => setMode('sheet')}
          />
          <IconButton
            label="Component editor"
            hint="Component editor"
            icon={<Component1Icon />}
            active={mode === 'component'}
            onClick={() => setMode('component')}
          />
        </ButtonGroup>

        {mode === 'sheet' ? (
          <>
            <ButtonGroup label="Tools">
              {TOOLS.map((tool) => (
                <IconButton
                  key={tool.id}
                  label={tool.label}
                  hint={`${tool.label} — ${tool.hint}`}
                  icon={tool.icon}
                  active={controller.tool === tool.id}
                  onClick={() => {
                    controller.tool = tool.id;
                    controller.placeRef = tool.id === 'place' ? controller.placeRef : null;
                    controller.notify();
                  }}
                />
              ))}
            </ButtonGroup>

            <ButtonGroup label="History">
              <IconButton label="Undo" hint="Undo — Ctrl+Z" icon={<ResetIcon />} onClick={() => controller.store.undo()} />
              <IconButton
                label="Redo"
                hint="Redo — Ctrl+Shift+Z"
                icon={<ResetIcon className="flip-x" />}
                onClick={() => controller.store.redo()}
              />
            </ButtonGroup>

            <ButtonGroup label="View">
              <IconButton
                label="Zoom out"
                icon={<ZoomOutIcon />}
                onClick={() => controller.zoomAt(centre(), 1 / 1.2)}
              />
              <span className="zoom">{Math.round(controller.viewport.zoom * 100)}%</span>
              <IconButton label="Zoom in" icon={<ZoomInIcon />} onClick={() => controller.zoomAt(centre(), 1.2)} />
              <IconButton
                label="Fit"
                hint="Fit the sheet in the viewport"
                icon={<CornersIcon />}
                onClick={() => fitView(controller)}
              />
            </ButtonGroup>

            <ButtonGroup label="Aids">
              <IconButton
                label="Snap"
                hint="Snap to grid and alignment guides"
                icon={<GridIcon />}
                active={controller.snapEnabled}
                onClick={() => {
                  controller.snapEnabled = !controller.snapEnabled;
                  controller.notify();
                }}
              />
              <IconButton
                label="Ports"
                hint="Show port markers"
                icon={<TargetIcon />}
                active={controller.showPorts}
                onClick={() => {
                  controller.showPorts = !controller.showPorts;
                  controller.notify();
                }}
              />
            </ButtonGroup>

            <ButtonGroup label="Export">
              <IconButton
                label="Export SVG"
                icon={<CodeIcon />}
                onClick={() => downloadText(`${baseName}.svg`, svgOf(controller.selection.size > 0))}
              />
              <IconButton
                label="Export PNG"
                icon={<ImageIcon />}
                onClick={() => void downloadPng(`${baseName}.png`, svgOf(controller.selection.size > 0))}
              />
              <IconButton
                label="Export PDF"
                hint="Print to PDF"
                icon={<FileTextIcon />}
                onClick={() => printPdf(svgOf(false), doc.meta.title || 'sheet')}
              />
            </ButtonGroup>
          </>
        ) : null}

        <div className="spacer" />

        <div className="group">
          <span className="path" title={project.root}>
            {project.root}
          </span>
          <IconButton
            label={project.dirty ? 'Save' : 'Saved'}
            hint="Save the project — Ctrl+S"
            icon={project.dirty ? <DotFilledIcon /> : <CheckIcon />}
            className="primary"
            onClick={() => void project.save()}
          >
            {project.dirty ? 'Save' : 'Saved'}
          </IconButton>
        </div>
      </header>

      {mode === 'sheet' ? (
        <SheetEditor
          controller={controller}
          onEditComponent={editComponent}
          onDeleteComponent={(entry) => void deleteComponentFromPalette(entry)}
        />
      ) : (
        <ComponentEditor project={project} openRef={openRef} onOpened={() => setOpenRef(null)} />
      )}
    </div>
  );
}

function centre(): { x: number; y: number } {
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

function fitView(controller: { fit: (size: { w: number; h: number }) => void }): void {
  const el = document.querySelector('.canvas-area');
  const w = el?.clientWidth ?? window.innerWidth;
  const h = el?.clientHeight ?? window.innerHeight;
  controller.fit({ w, h });
}
