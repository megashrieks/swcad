import { useMemo } from 'react';
import {
  AlignBottomIcon,
  AlignCenterHorizontallyIcon,
  AlignCenterVerticallyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AlignTopIcon,
  CodeIcon,
  DotFilledIcon,
  DownloadIcon,
  ExclamationTriangleIcon,
  FileTextIcon,
  GridIcon,
  ImageIcon,
  MagicWandIcon,
  SpaceEvenlyHorizontallyIcon,
  SpaceEvenlyVerticallyIcon,
} from '@radix-ui/react-icons';
import type { PluginHost } from '@core/plugin/host';
import type { PluginCapabilities, PluginCommand, PluginContext } from '@core/plugin/types';
import {
  commandActive,
  commandUsable,
  createPluginContext,
  runPluginCommand,
} from '@core/plugin/context';
import type { EditorController } from './EditorController';
import { downloadPng, downloadText, exportBackground, exportSvg, printPdf } from './export';
import { ButtonGroup } from '../ui/ButtonGroup';
import { IconButton } from '../ui/IconButton';
import { SplitButton, type SplitMenuItem } from '../ui/SplitButton';
import { showAlert } from '../ui/Dialog';

/**
 * Icons a plugin may ask for by name. A plugin script cannot hand over a React element,
 * and it has no business knowing which icon set the app draws from — so it names an
 * action and the toolbar picks the glyph.
 */
const PLUGIN_ICONS: Record<string, JSX.Element> = {
  align: <MagicWandIcon />,
  'align-left': <AlignLeftIcon />,
  'align-right': <AlignRightIcon />,
  'align-top': <AlignTopIcon />,
  'align-bottom': <AlignBottomIcon />,
  'align-center-h': <AlignCenterHorizontallyIcon />,
  'align-center-v': <AlignCenterVerticallyIcon />,
  'distribute-h': <SpaceEvenlyHorizontallyIcon />,
  'distribute-v': <SpaceEvenlyVerticallyIcon />,
  grid: <GridIcon />,
  download: <DownloadIcon />,
  code: <CodeIcon />,
  image: <ImageIcon />,
  document: <FileTextIcon />,
  warning: <ExclamationTriangleIcon />,
};

function iconOf(name: string | undefined): JSX.Element {
  return (name ? PLUGIN_ICONS[name] : undefined) ?? <DotFilledIcon />;
}

/**
 * Renders every loaded plugin's commands as toolbar groups — one group per plugin, a
 * split button for a command that carries variants.
 *
 * The context is built once per render for `enabled`/`active` to read, and freshly for
 * each run so a command always acts on the document as it is at the moment of the click.
 */
export function PluginToolbar({
  host,
  controller,
  mode,
}: {
  host: PluginHost;
  controller: EditorController;
  mode: 'sheet' | 'component';
}): JSX.Element | null {
  const plugins = host.usable();
  const failures = host.errors();

  // Rebuilt whenever the document or the selection changes, which is exactly when a
  // command's availability can change.
  const revision = controller.store.revision + controller.selection.size;
  const caps = useMemo<PluginCapabilities>(() => makeCapabilities(controller), [controller]);
  const probeCtx = useMemo(
    () => buildContext(controller, mode, caps),
    [controller, mode, caps, revision, [...controller.selection].join(',')],
  );

  if (plugins.length === 0 && failures.length === 0) return null;

  const invoke = (command: PluginCommand): void => {
    const ctx = buildContext(controller, mode, caps);
    void runPluginCommand(command, ctx, controller.store).then((error) => {
      controller.invalidateGraph();
      controller.notify();
      if (error) void showAlert(error, { title: `${command.label} failed` });
    });
  };

  const menuItems = (command: PluginCommand, ctx: PluginContext): SplitMenuItem[] =>
    (command.items ?? []).map((item) => ({
      id: item.id,
      label: item.label,
      hint: item.hint,
      icon: item.icon ? iconOf(item.icon) : undefined,
      disabled: !commandUsable(item, ctx),
      active: commandActive(item, ctx),
      separator: item.separator,
      onSelect: () => invoke(item),
    }));

  return (
    <>
      {plugins.map((plugin) => (
        <ButtonGroup key={plugin.key} label={plugin.title}>
          {plugin.commands.map((command) =>
            command.items && command.items.length > 0 ? (
              <SplitButton
                key={command.id}
                label={command.label}
                hint={command.hint}
                icon={iconOf(command.icon)}
                menuLabel={plugin.title}
                disabled={!commandUsable(command, probeCtx)}
                active={commandActive(command, probeCtx)}
                onClick={command.run ? () => invoke(command) : undefined}
                items={menuItems(command, probeCtx)}
              />
            ) : (
              <IconButton
                key={command.id}
                label={command.label}
                hint={command.hint}
                icon={iconOf(command.icon)}
                disabled={!commandUsable(command, probeCtx)}
                active={commandActive(command, probeCtx) || undefined}
                onClick={() => invoke(command)}
              />
            ),
          )}
        </ButtonGroup>
      ))}

      {failures.length > 0 ? (
        <ButtonGroup label="Plugin errors">
          <IconButton
            label="Plugin errors"
            hint={`${failures.length} plugin${failures.length === 1 ? '' : 's'} failed to load`}
            icon={<ExclamationTriangleIcon />}
            className="danger"
            onClick={() =>
              void showAlert(failures.map((f) => `${f.key}: ${f.message}`).join('\n\n'), {
                title: 'Plugins that did not load',
              })
            }
          />
        </ButtonGroup>
      ) : null}
    </>
  );
}

function buildContext(
  controller: EditorController,
  mode: 'sheet' | 'component',
  caps: PluginCapabilities,
): PluginContext {
  return createPluginContext({
    mode,
    store: controller.store,
    graph: controller.getGraph(),
    selection: controller.selection,
    snapEnabled: controller.snapEnabled,
    select: (ids) => controller.select(ids),
    caps,
  });
}

/** Everything a plugin cannot do for itself: draw the document out, and talk to the user. */
function makeCapabilities(controller: EditorController): PluginCapabilities {
  const svg = (options?: { selection?: boolean }): string => {
    const doc = controller.store.getDocument();
    const onlySelection = options?.selection ?? controller.selection.size > 0;
    return exportSvg(doc, controller.getGraph(), controller.registry, {
      only: onlySelection && controller.selection.size > 0 ? new Set(controller.selection) : undefined,
    });
  };
  return {
    svg,
    download: (name, text, mime) => downloadText(name, text, mime),
    downloadPng: (name, source, scale) =>
      downloadPng(name, source, scale, exportBackground(controller.store.getDocument())),
    print: (source, title) =>
      printPdf(source, title || controller.store.getDocument().meta.title || 'drawing'),
    notify: (message, title) => void showAlert(message, { title: title ?? 'Plugin' }),
  };
}
