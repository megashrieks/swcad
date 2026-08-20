import type { ReactNode } from 'react';
import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from './pomavo';

/**
 * Toolbar button. With no children it is icon-only, so the accessible name comes from
 * `label` — keep that stable, it is what tooltips and tests read.
 *
 * Chrome is Pomavo's `ghost` button: no border at rest, a primary-tinted wash on hover,
 * and a filled tint when pressed. `className` still accepts the old `primary`/`save`
 * hooks, which `theme.css` maps onto the accent colours.
 */
export function IconButton({
  label,
  hint,
  icon,
  active,
  disabled,
  className = '',
  onClick,
  children,
}: {
  label: string;
  hint?: string;
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
  children?: ReactNode;
}): JSX.Element {
  const iconOnly = children === undefined;
  const button = (
    <Button
      type="button"
      variant="ghost"
      size={iconOnly ? 'icon-sm' : 'sm'}
      aria-label={label}
      disabled={disabled}
      {...(active === undefined ? {} : { 'aria-pressed': active })}
      data-active={active ? 'true' : undefined}
      className={cn(
        'btn font-normal',
        iconOnly && 'icon',
        active && 'is-active',
        className,
      )}
      onClick={onClick}
    >
      <span className="btn-icon" aria-hidden="true">
        {icon}
      </span>
      {children}
    </Button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom">{hint ?? label}</TooltipContent>
    </Tooltip>
  );
}
