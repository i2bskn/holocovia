import { useSyncExternalStore } from "react";

export type Route =
  | { name: "home" }
  | { name: "space"; id: string }
  | { name: "page"; id: string }
  | { name: "notFound" };

// hc() puts params into the URL without encoding them, so IDs are limited to characters that cannot
// change the path (no "/", "." or "%"). Server IDs are UUIDs, which always match.
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// Whether an ID may be put into a link or an API URL. Not decoded first.
export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

const ROUTE_PATTERN = /^\/(spaces|pages)\/([^/]+)$/;

export function matchRoute(pathname: string): Route {
  if (pathname === "/") return { name: "home" };
  const match = ROUTE_PATTERN.exec(pathname);
  if (!match) return { name: "notFound" };
  const [, kind, id] = match;
  if (id === undefined || !isValidId(id)) return { name: "notFound" };
  return kind === "spaces" ? { name: "space", id } : { name: "page", id };
}

// Notified by navigate(); popstate covers the back and forward buttons.
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

function getPathname(): string {
  return location.pathname;
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, getPathname);
}

// Moves to a path inside the SPA. The scroll position is not restored on back; that is left to the browser.
export function navigate(path: string): void {
  if (path !== location.pathname + location.search) {
    history.pushState(null, "", path);
    for (const listener of listeners) listener();
  }
  window.scrollTo(0, 0);
}

export type ClickEvent = {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

// Whether a click on a link is handled by the SPA. Other clicks (new tab, new window, download, a
// target attribute) are left to the browser.
export function shouldHandleClick(event: ClickEvent, target?: string): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    target === undefined
  );
}
