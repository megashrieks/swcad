import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { Button } from './button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';
import { cn } from '../lib/utils';

export interface ToolbarIconButtonProps extends Omit<
  ComponentProps<typeof Button>,
  'children' | 'size'
> {
  /** Icon element (typically a Lucide icon). */
  readonly icon: ReactNode;
  /** Tooltip text shown on hover. */
  readonly tooltip: ReactNode;
  /** Applies the "active" muted-background style. */
  readonly active?: boolean;
}

/**
 * Square icon button with a tooltip and optional "active" visual state.
 *
 * Extracts the `<TooltipProvider><Tooltip>...<Button variant="ghost-bordered" size="icon">`
 * pattern repeated across board toolbars, scrum headers, backlog toolbars,
 * search toolbars, and ticket detail panes.
 *
 * @example
 * <ToolbarIconButton
 *   icon={<Eye className="h-4 w-4" />}
 *   tooltip="Show completed tickets"
 *   active={hideTerminal}
 *   onClick={() => setHideTerminal(v => !v)}
 * />
 */
export const ToolbarIconButton = forwardRef<HTMLButtonElement, ToolbarIconButtonProps>(
  function ToolbarIconButton(
    { icon, tooltip, active, variant = 'ghost-bordered', className, ...rest },
    ref
  ) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              ref={ref}
              size="icon"
              variant={variant}
              className={cn(active && 'bg-muted', className)}
              {...rest}
            >
              {icon}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
);
