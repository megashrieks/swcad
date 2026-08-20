/**
 * Icons swcad draws itself.
 *
 * Radix has no glyph for a router, and the three of them only read as a set when they are
 * the same drawing three ways: one stroke from the same corner to the same corner, bent,
 * direct, or eased. They follow Radix's 15×15 box so they line up with everything else in
 * the toolbar, but are stroked rather than filled, since a route is a line.
 */
import type { SVGProps } from 'react';

function RouteGlyph({ d, ...props }: { d: string } & SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="2.5" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12.5" cy="3" r="1.4" fill="currentColor" />
    </svg>
  );
}

/** Right-angled route: the A* default. */
export function RouteOrthogonalIcon(props: SVGProps<SVGSVGElement>): JSX.Element {
  return <RouteGlyph d="M2.5 12H7.5V3H12.5" {...props} />;
}

/** Direct route: a line between the ports, obstacles and all. */
export function RouteStraightIcon(props: SVGProps<SVGSVGElement>): JSX.Element {
  return <RouteGlyph d="M2.5 12L12.5 3" {...props} />;
}

/** Eased route: a smooth curve leaving each port along its normal. */
export function RouteCurveIcon(props: SVGProps<SVGSVGElement>): JSX.Element {
  return <RouteGlyph d="M2.5 12C7.5 12 7.5 3 12.5 3" {...props} />;
}
