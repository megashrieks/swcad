import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckIcon,
  Component1Icon,
  CornersIcon,
  CursorArrowIcon,
  DotFilledIcon,
  ExclamationTriangleIcon,
  FileIcon,
  GridIcon,
  HandIcon,
  MagnifyingGlassIcon,
  ResetIcon,
  RulerSquareIcon,
  Share1Icon,
  TargetIcon,
  UpdateIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '@radix-ui/react-icons';
import { useProject } from './editor/useProject';
import { useController } from './editor/EditorSurface';
import { SheetEditor } from './sheet/SheetEditor';
import { ComponentEditor, type ComponentSession } from './component/ComponentEditor';
import { confirmAndDelete } from './component/storage';
import type { ComponentEntry } from '@core/library/registry';
import { PluginToolbar } from './editor/PluginToolbar';
import { ButtonGroup } from './ui/ButtonGroup';
import { IconButton } from './ui/IconButton';
import { RouteCurveIcon, RouteOrthogonalIcon, RouteStraightIcon } from './ui/icons';
import type { RouteStyle } from '@core/geometry/routing';
import { ThemeMenu } from './ui/ThemeMenu';
import type { SaveStatus } from './editor/autosave';
import type { EditorController, ToolId } from './editor/EditorController';
import { nameProjectInUrl, routeTitle, useRoute } from './routes';
import { showAlert } from './ui/Dialog';

const TOOLS: { id: ToolId; label: string; hint: string; icon: JSX.Element }[] = [
  { id: 'select', label: 'Select', hint: 'V — select, move, resize', icon: <CursorArrowIcon /> },
  { id: 'pan', label: 'Pan', hint: 'H — drag the canvas (or hold space)', icon: <HandIcon /> },
  { id: 'connect', label: 'Connect', hint: 'C — drag between ports', icon: <Share1Icon /> },
];

/**
 * The routers a connector can use. Picking one re-routes the selected connectors and
 * becomes the style the next connector is drawn with, so the group reads as the current
 * setting whether or not anything is selected — and as blank when the selection disagrees.
 */
const ROUTERS: { id: RouteStyle; label: string; hint: string; icon: JSX.Element }[] = [
  { id: 'orthogonal', label: 'Orthogonal', hint: 'right angles, routed around obstacles', icon: <RouteOrthogonalIcon /> },
  { id: 'straight', label: 'Straight', hint: 'a direct line between the ports', icon: <RouteStraightIcon /> },
  { id: 'curve', label: 'Curved', hint: 'a smooth curve leaving each port along its normal', icon: <RouteCurveIcon /> },
];

/** How each auto-save state reads in the toolbar. The button's own name stays "Save". */
const SAVE_STATES: Record<SaveStatus, { text: string; icon: JSX.Element; className: string }> = {
  saved: { text: 'Saved', icon: <CheckIcon />, className: '' },
  pending: { text: 'Unsaved', icon: <DotFilledIcon />, className: ' is-pending' },
  saving: { text: 'Saving…', icon: <UpdateIcon />, className: ' is-saving' },
  error: { text: 'Save failed', icon: <ExclamationTriangleIcon />, className: ' is-error' },
};

export function App(): JSX.Element {
  const project = useProject();
  const { route, navigate } = useRoute();
  const mode = route.view;
  const controller = project.controller;
  /**
   * The component editor builds a canvas of its own, so the toolbar has to be told which
   * one is on screen. A component *is* a project — the same tools, history, view controls
   * and export apply to it, and there was never a reason for it to go without them. The
   * same goes for opening and saving: both editors do it from here, not from a sidebar.
   */
  const [session, setSession] = useState<ComponentSession | null>(null);
  const active = mode === 'component' ? (session?.open ? session.controller : null) : controller;
  useController(active ?? controller);

  // Coming back to the component editor lands on the component you left, not a blank one.
  const lastComponent = useRef<{ ref: string | null; file: string | null }>({ ref: null, file: null });
  if (route.view === 'component') lastComponent.current = { ref: route.ref, file: route.file };
  // The route as the callbacks below see it, without rebuilding them on every navigation.
  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    document.title = routeTitle(route);
  }, [route]);

  // A URL that names the project describes the whole screen, so reloading or sharing it
  // comes back to the same place.
  useEffect(() => {
    if (project.status === 'ready') nameProjectInUrl(project.root);
  }, [project.status, project.root]);

  // Editing a component from the palette hands it to the component editor.
  const editComponent = (entry: ComponentEntry): void => {
    navigate({ view: 'component', ref: entry.ref, file: null });
  };

  /** The component editor reporting what it has open, so the URL keeps up with it. */
  const componentOpened = useCallback(
    (ref: string | null, file: string | null): void => {
      const current = routeRef.current;
      if (current.view !== 'component') return;
      // Opening another component is a navigation; changing file tab is a correction.
      navigate({ view: 'component', ref, file }, { replace: current.ref === ref });
    },
    [navigate],
  );

  const deleteComponentFromPalette = async (entry: ComponentEntry): Promise<void> => {
    try {
      const deleted = await confirmAndDelete(project.registry, controller.store.getDocument(), entry);
      if (deleted) await project.reloadLibraries();
    } catch (err) {
      await showAlert(err instanceof Error ? err.message : String(err), { title: 'Could not delete' });
    }
  };

  // Whatever is on screen saves itself; Ctrl+S just skips the wait. In the component
  // editor that means the component, not the sheet behind it.
  const sessionRef = useRef<ComponentSession | null>(null);
  sessionRef.current = session;
  const saveActive = useCallback((): void => {
    if (routeRef.current.view === 'component') {
      sessionRef.current?.save();
      return;
    }
    void project.save();
  }, [project]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveActive();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveActive]);

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

  // What the save button says, and what it acts on. In the component editor it is the
  // component that is being saved — the sheet behind it is not what is on screen.
  const editingComponent = mode === 'component' && session !== null;
  const saveState = editingComponent
    ? SAVE_STATES[session.established ? session.saveStatus : 'pending']
    : SAVE_STATES[project.saveStatus];

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
            onClick={() => navigate({ view: 'sheet' })}
          />
          <IconButton
            label="Component editor"
            hint="Component editor"
            icon={<Component1Icon />}
            active={mode === 'component'}
            onClick={() => navigate({ view: 'component', ...lastComponent.current })}
          />
        </ButtonGroup>

        {mode === 'component' && session ? (
          <ButtonGroup label="Component">
            <IconButton
              label="Open component"
              hint="Browse the project's components, or start a new one"
              icon={<MagnifyingGlassIcon />}
              onClick={session.browse}
            >
              {!session.open ? 'Open…' : session.copy ? `Copy of ${session.ref}` : (session.ref ?? 'New component')}
            </IconButton>
          </ButtonGroup>
        ) : null}

        {active ? (
          <>
            <ButtonGroup label="Tools">
              {TOOLS.map((tool) => (
                <IconButton
                  key={tool.id}
                  label={tool.label}
                  hint={`${tool.label} — ${tool.hint}`}
                  icon={tool.icon}
                  active={active.tool === tool.id}
                  onClick={() => {
                    active.tool = tool.id;
                    active.placeRef = tool.id === 'place' ? active.placeRef : null;
                    active.notify();
                  }}
                />
              ))}
            </ButtonGroup>

            <ButtonGroup label="Routing">
              {ROUTERS.map((router) => (
                <IconButton
                  key={router.id}
                  label={router.label}
                  hint={`${router.label} connector — ${router.hint}`}
                  icon={router.icon}
                  active={active.activeConnectStyle() === router.id}
                  onClick={() => active.setConnectStyle(router.id)}
                />
              ))}
            </ButtonGroup>

            <ButtonGroup label="History">
              <IconButton label="Undo" hint="Undo — Ctrl+Z" icon={<ResetIcon />} onClick={() => undo(active, false)} />
              <IconButton
                label="Redo"
                hint="Redo — Ctrl+Shift+Z"
                icon={<ResetIcon className="flip-x" />}
                onClick={() => undo(active, true)}
              />
            </ButtonGroup>

            <ButtonGroup label="View">
              <IconButton
                label="Zoom out"
                icon={<ZoomOutIcon />}
                onClick={() => active.zoomAt(centre(active), 1 / 1.2)}
              />
              <span className="zoom">{Math.round(active.viewport.zoom * 100)}%</span>
              <IconButton label="Zoom in" icon={<ZoomInIcon />} onClick={() => active.zoomAt(centre(active), 1.2)} />
              <IconButton
                label="Fit"
                hint="Fit the drawing in the viewport — F"
                icon={<CornersIcon />}
                onClick={() => active.fit()}
              />
            </ButtonGroup>

            <ButtonGroup label="Aids">
              <IconButton
                label="Snap"
                hint="Snap to grid and alignment guides"
                icon={<GridIcon />}
                active={active.snapEnabled}
                onClick={() => {
                  active.snapEnabled = !active.snapEnabled;
                  active.notify();
                }}
              />
              <IconButton
                label="Ports"
                hint="Show port markers"
                icon={<TargetIcon />}
                active={active.showPorts}
                onClick={() => {
                  active.showPorts = !active.showPorts;
                  active.notify();
                }}
              />
              <IconButton
                label="Rulers"
                hint="Coordinate gutters along the top and left edges"
                icon={<RulerSquareIcon />}
                active={active.showRulers}
                onClick={() => {
                  active.showRulers = !active.showRulers;
                  active.notify();
                }}
              />
            </ButtonGroup>

            <PluginToolbar host={project.plugins} controller={active} mode={mode} />
          </>
        ) : null}

        <div className="spacer" />

        <div className="group">
          <span className="path" title={project.root}>
            {project.root}
          </span>
          <ThemeMenu />
          {editingComponent && !session.open ? null : (
            <IconButton
              label="Save"
              hint={
                editingComponent
                  ? session.established
                    ? `Saves itself as you work — Ctrl+S saves ${session.ref} now`
                    : `Not written yet — Ctrl+S saves it as ${session.target}`
                  : project.saveError
                    ? `Could not save: ${project.saveError} — click to try again`
                    : 'Saves itself as you work — Ctrl+S saves now'
              }
              icon={saveState.icon}
              className={`primary save${saveState.className}`}
              onClick={saveActive}
            >
              {saveState.text}
            </IconButton>
          )}
        </div>
      </header>

      {mode === 'sheet' ? (
        <SheetEditor
          controller={controller}
          fitKey={`${project.root}/${project.sheetPath}`}
          onEditComponent={editComponent}
          onDeleteComponent={(entry) => void deleteComponentFromPalette(entry)}
        />
      ) : (
        <ComponentEditor
          project={project}
          openRef={route.view === 'component' ? route.ref : null}
          openFile={route.view === 'component' ? route.file : null}
          onOpened={componentOpened}
          onSession={setSession}
        />
      )}
    </div>
  );
}

function centre(controller: EditorController): { x: number; y: number } {
  const { w, h } = controller.viewSize;
  // Before the surface has measured itself the window is the best guess going.
  if (w <= 0 || h <= 0) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  return { x: w / 2, y: h / 2 };
}

/** Step the document's history and let the graph know it has to be rebuilt. */
function undo(controller: EditorController, redo: boolean): void {
  if (redo) controller.store.redo();
  else controller.store.undo();
  controller.invalidateGraph();
  controller.notify();
}
