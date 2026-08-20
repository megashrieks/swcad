import { useCallback, useEffect, useState } from 'react';

/**
 * Where the app is, as a URL.
 *
 * The **path** says what you are looking at — the sheet, or one component in the component
 * editor — so every view is a link you can bookmark, reload, share and reach with the back
 * button. The **query** says which project it belongs to: `?project=` is an absolute
 * filesystem path rather than part of the route, so it is carried across every navigation
 * untouched instead of being spliced into path segments.
 *
 *     /                              the sheet
 *     /sheet                         the same, spelled out
 *     /component                     the component editor, on whatever it last scaffolded
 *     /component/base/box            editing base/box
 *     /component/base/box/script.js  ...with that file open in the code pane
 *
 * Anything unrecognised reads as the sheet, and is rewritten to a canonical path when the
 * app first renders, so a typo cannot leave the address bar describing a view you are not
 * looking at.
 */
export type Route =
  | { view: 'sheet' }
  | {
      view: 'component';
      /** `lib/id` of the open component; null while it has never been saved. */
      ref: string | null;
      /** Package file open in the code pane, if the URL names one. */
      file: string | null;
    };

/** Where the app is mounted, from Vite's `base`; '/' unless the build says otherwise. */
const BASE = normaliseBase(import.meta.env?.BASE_URL);

function normaliseBase(base: string | undefined): string {
  const value = base && base.length > 0 ? base : '/';
  return `/${value.replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');
}

/** Split a pathname into decoded segments, with the mount point taken off the front. */
function segmentsOf(pathname: string): string[] {
  const path = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname.replace(/^\/+/, '');
  return path
    .split('/')
    .filter((part) => part.length > 0)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
}

export function parseRoute(pathname: string): Route {
  const parts = segmentsOf(pathname);
  if (parts[0] === 'component') {
    // A ref is `lib/id`: two segments, and both have to be there to name a component.
    const ref = parts[1] && parts[2] ? `${parts[1]}/${parts[2]}` : null;
    const file = ref && parts.length > 3 ? parts.slice(3).join('/') : null;
    return { view: 'component', ref, file };
  }
  return { view: 'sheet' };
}

/** The path for a route. The sheet is the bare mount point, so the default URL stays clean. */
export function routePath(route: Route): string {
  if (route.view === 'sheet') return BASE;
  const parts = ['component'];
  if (route.ref) {
    parts.push(...route.ref.split('/').slice(0, 2));
    if (route.file) parts.push(route.file);
  }
  return BASE + parts.map((part) => part.split('/').map(encodeURIComponent).join('/')).join('/');
}

export function sameRoute(a: Route, b: Route): boolean {
  if (a.view !== b.view) return false;
  if (a.view !== 'component' || b.view !== 'component') return true;
  return a.ref === b.ref && a.file === b.file;
}

/** A route as an href, keeping the query string — which is where the project lives. */
export function routeHref(route: Route, search = window.location.search): string {
  return `${routePath(route)}${search}`;
}

export interface Navigation {
  route: Route;
  /**
   * Go to `route`. `replace` rewrites the current history entry instead of adding one, for
   * moves that are corrections rather than navigations — switching file tabs, say.
   */
  navigate: (to: Route, options?: { replace?: boolean }) => void;
}

/** The current route, kept in step with the address bar and the back/forward buttons. */
export function useRoute(): Navigation {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onPop = (): void => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Canonicalise on first render: /sheet and any unknown path become the path their route
  // actually renders, without adding a history entry the back button would land on.
  useEffect(() => {
    const canonical = routeHref(parseRoute(window.location.pathname));
    if (canonical !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', canonical);
    }
  }, []);

  const navigate = useCallback((to: Route, options?: { replace?: boolean }): void => {
    const href = routeHref(to);
    if (href !== window.location.pathname + window.location.search) {
      if (options?.replace) window.history.replaceState(null, '', href);
      else window.history.pushState(null, '', href);
    }
    setRoute((prev) => (sameRoute(prev, to) ? prev : to));
  }, []);

  return { route, navigate };
}

/**
 * Name the open project in the URL when it was not asked for by name.
 *
 * Booting without `?project=` opens whatever the server suggests; writing that back makes
 * the address a complete description of what is on screen, so reloading or sharing it lands
 * in the same place. A `?project=` the user typed is never rewritten.
 */
export function nameProjectInUrl(root: string): void {
  if (!root) return;
  const url = new URL(window.location.href);
  if (url.searchParams.get('project')) return;
  url.searchParams.set('project', root);
  window.history.replaceState(null, '', `${url.pathname}${url.search}`);
}

/** The document title, so history and bookmarks read as something other than "swcad". */
export function routeTitle(route: Route): string {
  if (route.view === 'sheet') return 'swcad';
  return route.ref ? `${route.ref} — swcad` : 'New component — swcad';
}
