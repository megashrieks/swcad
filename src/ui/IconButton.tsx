import type { ReactNode } from 'react';

/**
 * Toolbar button. With no children it is icon-only, so the accessible name comes from
 * `label` — keep that stable, it is what tooltips and tests read.
 */
export function IconButton({
  label,
  hint,
  icon,
  active,
  className = '',
  onClick,
  children,
}: {
  label: string;
  hint?: string;
  icon: ReactNode;
  active?: boolean;
  className?: string;
  onClick: () => void;
  children?: ReactNode;
}): JSX.Element {
  const iconOnly = children === undefined;
  return (
    <button
      type="button"
      title={hint ?? label}
      aria-label={label}
      {...(active === undefined ? {} : { 'aria-pressed': active })}
      className={`btn${iconOnly ? ' icon' : ''}${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
    >
      <span className="btn-icon" aria-hidden="true">
        {icon}
      </span>
      {children}
    </button>
  );
}
