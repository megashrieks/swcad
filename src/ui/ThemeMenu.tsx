import { DesktopIcon, MoonIcon, SunIcon } from '@radix-ui/react-icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './pomavo';
import { useTheme, useThemeOptions, type Mode } from './theme';

const MODES: { id: Mode; label: string; icon: JSX.Element }[] = [
  { id: 'light', label: 'Light', icon: <SunIcon /> },
  { id: 'dark', label: 'Dark', icon: <MoonIcon /> },
  { id: 'system', label: 'System', icon: <DesktopIcon /> },
];

/** A swatch of the theme's primary colour, so the menu reads at a glance. */
function Swatch({ color }: { color: string }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="size-3 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

export function ThemeMenu(): JSX.Element {
  const { mode, setMode, colorTheme, setColorTheme, resolvedMode } = useTheme();
  const { ayu, accents } = useThemeOptions();
  const modeIcon = MODES.find((m) => m.id === mode)?.icon ?? <MoonIcon />;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Theme"
              className="btn icon font-normal"
            >
              <span className="btn-icon" aria-hidden="true">
                {modeIcon}
              </span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Theme — {resolvedMode}</TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)}>
          {MODES.map((m) => (
            <DropdownMenuRadioItem key={m.id} value={m.id}>
              <span className="flex items-center gap-2">
                {m.icon}
                {m.label}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        {ayu.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onSelect={() => setColorTheme(t.id)}
            data-active={t.id === colorTheme ? 'true' : undefined}
            className="data-[active=true]:text-primary"
          >
            <Swatch color={t.color} />
            {t.name}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Accent</DropdownMenuLabel>
        {accents.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onSelect={() => setColorTheme(t.id)}
            data-active={t.id === colorTheme ? 'true' : undefined}
            className="data-[active=true]:text-primary"
          >
            <Swatch color={t.color} />
            {t.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
