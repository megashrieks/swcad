import { Fragment, type ReactNode } from 'react';
import { ChevronDownIcon } from '@radix-ui/react-icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './pomavo';
import { IconButton } from './IconButton';

export interface SplitMenuItem {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
  active?: boolean;
  /** Draw a rule above this entry. */
  separator?: boolean;
  onSelect: () => void;
}

/**
 * One control with two halves: the default action, and a caret onto the variants. It is
 * what a toolbar wants for a family of actions where one of them is the obvious answer —
 * exporting is *usually* exporting SVG, and the rest belong out of the way rather than
 * taking a button each.
 *
 * The two halves keep separate accessible names (`Export`, `Export options`) so both are
 * addressable.
 */
export function SplitButton({
  label,
  hint,
  icon,
  items,
  menuLabel,
  disabled,
  active,
  onClick,
  children,
}: {
  label: string;
  hint?: string;
  icon: ReactNode;
  items: SplitMenuItem[];
  /** Heading above the menu. Defaults to the button's own label. */
  menuLabel?: string;
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}): JSX.Element {
  const main = (
    <IconButton
      label={label}
      hint={hint}
      icon={icon}
      disabled={disabled || !onClick}
      active={active}
      className="split-main"
      onClick={onClick ?? (() => undefined)}
    >
      {children}
    </IconButton>
  );

  if (items.length === 0) return <span className="split-button">{main}</span>;

  return (
    <span className="split-button">
      {main}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`${label} options`}
                className="btn icon split-caret font-normal"
              >
                <span className="btn-icon" aria-hidden="true">
                  <ChevronDownIcon />
                </span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">More {label.toLowerCase()} options</TooltipContent>
        </Tooltip>

        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>{menuLabel ?? label}</DropdownMenuLabel>
          {items.map((item) => (
            <Fragment key={item.id}>
              {item.separator ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                disabled={item.disabled}
                onSelect={item.onSelect}
                data-active={item.active ? 'true' : undefined}
                className="data-[active=true]:text-primary"
                title={item.hint}
              >
                {item.icon ? (
                  <span className="btn-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                ) : null}
                <span className="flex flex-col">
                  <span>{item.label}</span>
                  {item.hint ? <span className="menu-hint">{item.hint}</span> : null}
                </span>
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
