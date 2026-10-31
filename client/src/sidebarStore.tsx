import { type ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Folder, PageSummary, Space } from "../../src/api/types";
import { type ApiClient, type ViewState, loadFolderList, loadPageList, loadSpaceList } from "./load";
import { folderPathIds } from "./sidebar";

// Where the screen shown is, told by the screen. current is the aria-current of the row of that place: "page" when
// the screen shows the place itself, "location" when it shows something about it (the trash, the editor).
export type SidebarLocation = {
  spaceId: string;
  folderId: string | null;
  pageId: string | null;
  current: "page" | "location";
};

// A list loaded for the sidebar. data is kept while it is loaded again, so that the tree does not flicker. stale
// means it is to be loaded (again) the next time it is shown.
export type Cached<T> = { data: T | null; loading: boolean; failed: boolean; stale: boolean };

export type SpaceTreeData = { folders: Folder[]; pages: PageSummary[] };

const NOT_LOADED: Cached<never> = { data: null, loading: false, failed: false, stale: true };

// The width from which the sidebar is always shown next to the screen; below it, it is a drawer.
const WIDE_QUERY = "(min-width: 1024px)";

// The functions that do not change while the app is shown. Screens use only these, so that they are not drawn
// again whenever the sidebar changes.
export type SidebarActions = {
  // Loads the list of spaces again.
  invalidateSpaces(): void;
  // Loads the folders and pages of a space again.
  invalidateSpaceTree(spaceId: string): void;
  // Loads the list of spaces and every tree loaded so far again (the reload button).
  reloadAll(): void;
  openDrawer(): void;
  closeDrawer(): void;
  // Opens or closes a space ("space:<id>") or a folder ("folder:<id>") in the tree.
  toggle(key: string): void;
  setLocation(location: SidebarLocation | null): void;
};

export type SidebarState = {
  spaces: Cached<Space[]>;
  trees: ReadonlyMap<string, Cached<SpaceTreeData>>;
  expanded: ReadonlySet<string>;
  location: SidebarLocation | null;
  drawerOpen: boolean;
  // Whether the window is wide enough for the sidebar next to the screen.
  wide: boolean;
};

const noop = () => {};

// Used outside the provider, so that a screen can be drawn alone.
const NO_ACTIONS: SidebarActions = {
  invalidateSpaces: noop,
  invalidateSpaceTree: noop,
  reloadAll: noop,
  openDrawer: noop,
  closeDrawer: noop,
  toggle: noop,
  setLocation: noop,
};

const NO_STATE: SidebarState = {
  spaces: NOT_LOADED,
  trees: new Map(),
  expanded: new Set(),
  location: null,
  drawerOpen: false,
  wide: false,
};

const ActionsContext = createContext<SidebarActions>(NO_ACTIONS);
const StateContext = createContext<SidebarState>(NO_STATE);

export function spaceKey(spaceId: string): string {
  return `space:${spaceId}`;
}

export function folderKey(folderId: string): string {
  return `folder:${folderId}`;
}

// Compares locations: screens give a new object on every render.
export function locationKey(location: SidebarLocation | null): string {
  if (location === null) return "";
  return [location.spaceId, location.folderId ?? "", location.pageId ?? "", location.current].join("/");
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function markStale<T>(cache: Cached<T>): Cached<T> {
  return cache.stale ? cache : { ...cache, stale: true };
}

// Holds what the sidebar has loaded, for as long as the app is shown, so that moving between screens does not
// load it again (each load reads rows of D1). Lists are loaded only while the tree is shown: the sidebar on a wide
// window, or the open drawer.
export function SidebarProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  const wide = useMediaQuery(WIDE_QUERY);
  const [spaces, setSpaces] = useState<Cached<Space[]>>(NOT_LOADED);
  const [trees, setTrees] = useState<ReadonlyMap<string, Cached<SpaceTreeData>>>(new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [location, setLocationState] = useState<SidebarLocation | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const visible = wide || drawerOpen;

  // Numbers of the latest requests: an answer to an older one is dropped.
  const spacesRequest = useRef(0);
  const treeRequests = useRef(new Map<string, number>());
  // Read by the answer of the list of spaces, which drops the trees of the spaces that are gone.
  const treesRef = useRef(trees);
  treesRef.current = trees;
  // The location whose space and folders were opened, and the one whose tree was loaded again because it did
  // not have the folder or page. Each is done once per location.
  const expandedFor = useRef<string | null>(null);
  const reloadedFor = useRef<string | null>(null);

  const actions = useMemo<SidebarActions>(
    () => ({
      invalidateSpaces: () => setSpaces(markStale),
      invalidateSpaceTree: (spaceId) =>
        setTrees((prev) => {
          const cache = prev.get(spaceId);
          if (!cache || cache.stale) return prev;
          return new Map(prev).set(spaceId, markStale(cache));
        }),
      reloadAll: () => {
        setSpaces(markStale);
        setTrees((prev) => new Map(Array.from(prev, ([id, cache]) => [id, markStale(cache)] as const)));
      },
      openDrawer: () => setDrawerOpen(true),
      closeDrawer: () => setDrawerOpen(false),
      toggle: (key) =>
        setExpanded((prev) => {
          const next = new Set(prev);
          if (!next.delete(key)) next.add(key);
          return next;
        }),
      setLocation: (next) =>
        setLocationState((prev) => (locationKey(prev) === locationKey(next) ? prev : next)),
    }),
    [],
  );

  // The drawer is not needed once the sidebar is shown next to the screen.
  useEffect(() => {
    if (wide) setDrawerOpen(false);
  }, [wide]);

  // Loads the list of spaces while the tree is shown.
  useEffect(() => {
    if (!visible || !spaces.stale) return;
    const number = ++spacesRequest.current;
    setSpaces((prev) => ({ ...prev, loading: true, stale: false }));
    void loadSpaceList(client).then((result) => {
      if (number !== spacesRequest.current) return;
      // The move to the login page has started; nothing changes.
      if (result.kind === "redirecting") return;
      if (result.kind === "error") {
        setSpaces((prev) => ({ ...prev, loading: false, failed: true }));
        return;
      }
      setSpaces({ data: result.value, loading: false, failed: false, stale: false });
      // The trees and the open rows of the spaces that are gone are dropped.
      const ids = new Set(result.value.map((space) => space.id));
      const gone = Array.from(treesRef.current.keys()).filter((id) => !ids.has(id));
      const goneKeys = new Set<string>();
      for (const id of gone) {
        goneKeys.add(spaceKey(id));
        for (const folder of treesRef.current.get(id)?.data?.folders ?? []) goneKeys.add(folderKey(folder.id));
      }
      if (gone.length > 0) {
        setTrees((prev) => {
          const next = new Map(prev);
          for (const id of gone) next.delete(id);
          return next;
        });
      }
      // A space can be open before its tree is loaded.
      const isGone = (key: string) =>
        goneKeys.has(key) || (key.startsWith("space:") && !ids.has(key.slice("space:".length)));
      setExpanded((prev) => {
        const next = new Set(Array.from(prev).filter((key) => !isGone(key)));
        return next.size === prev.size ? prev : next;
      });
    });
    // client does not change while the app is shown.
  }, [visible, spaces.stale]);

  // Loads the trees of the open spaces, and of the space of the location, while the tree is shown. Only spaces in
  // the list are loaded: one that is not there is gone or cannot be seen.
  useEffect(() => {
    if (!visible || spaces.data === null) return;
    const wanted = spaces.data
      .map((space) => space.id)
      .filter((id) => expanded.has(spaceKey(id)) || location?.spaceId === id)
      .filter((id) => trees.get(id)?.stale ?? true);
    if (wanted.length === 0) return;
    setTrees((prev) => {
      const next = new Map(prev);
      for (const id of wanted) next.set(id, { ...(prev.get(id) ?? NOT_LOADED), loading: true, stale: false });
      return next;
    });
    for (const id of wanted) {
      const number = (treeRequests.current.get(id) ?? 0) + 1;
      treeRequests.current.set(id, number);
      void Promise.all([loadFolderList(client, id), loadPageList(client, id)]).then(([folders, pages]) => {
        if (treeRequests.current.get(id) !== number) return;
        // The move to the login page has started; nothing changes.
        if (folders.kind === "redirecting" || pages.kind === "redirecting") return;
        setTrees((prev) => {
          const cache = prev.get(id);
          // Dropped meanwhile, as the space is gone.
          if (!cache) return prev;
          const data = folders.kind === "ok" && pages.kind === "ok" ? { folders: folders.value, pages: pages.value } : null;
          const loaded: Cached<SpaceTreeData> = data
            ? { data, loading: false, failed: false, stale: cache.stale }
            : { ...cache, loading: false, failed: true };
          return new Map(prev).set(id, loaded);
        });
      });
    }
    // client does not change while the app is shown.
  }, [visible, spaces.data, trees, expanded, location]);

  // Opens the space and the folders down to the location, once per location, when its tree is loaded. A tree that
  // does not have the folder or page of the location may be older than it, and is loaded again once first.
  useEffect(() => {
    if (location === null) return;
    const key = locationKey(location);
    if (expandedFor.current === key) return;
    const tree = trees.get(location.spaceId);
    if (!tree || tree.loading || tree.stale) return;
    const data = tree.data;
    if (data !== null && !tree.failed) {
      const missing =
        (location.pageId !== null && !data.pages.some((page) => page.id === location.pageId)) ||
        (location.folderId !== null && !data.folders.some((folder) => folder.id === location.folderId));
      if (missing && reloadedFor.current !== key) {
        reloadedFor.current = key;
        actions.invalidateSpaceTree(location.spaceId);
        return;
      }
    }
    expandedFor.current = key;
    // A tree that failed opens only its space, which shows the error and its reload button.
    const keys = [spaceKey(location.spaceId)];
    if (data !== null && !tree.failed) {
      for (const id of folderPathIds(data.folders, location.folderId)) keys.push(folderKey(id));
    }
    setExpanded((prev) => {
      if (keys.every((k) => prev.has(k))) return prev;
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
  }, [location, trees]);

  const state = useMemo<SidebarState>(
    () => ({ spaces, trees, expanded, location, drawerOpen, wide }),
    [spaces, trees, expanded, location, drawerOpen, wide],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

// The functions to load the lists again and to open the drawer. They do not change, so a screen that uses them is
// not drawn again when the sidebar changes. Outside the provider they do nothing.
export function useSidebarActions(): SidebarActions {
  return useContext(ActionsContext);
}

// Everything about the sidebar, for the sidebar itself and the button that opens the drawer.
export function useSidebar(): SidebarActions & SidebarState {
  const actions = useContext(ActionsContext);
  const state = useContext(StateContext);
  return { ...actions, ...state };
}

// Tells the sidebar where the screen is. null is no place (the home screen, the search screen); undefined keeps
// the place told last, while the screen loads, so that the tree does not flicker. Nothing is told when the screen
// goes away: the next screen tells its own place.
export function useSidebarLocation(location: SidebarLocation | null | undefined): void {
  const { setLocation } = useContext(ActionsContext);
  const key = location === undefined ? undefined : locationKey(location);
  useEffect(() => {
    if (location !== undefined) setLocation(location);
    // location is a new object on every render; key identifies it.
  }, [key]);
}

// The location of a screen for useSidebarLocation, from its state: undefined while it loads or moves to the login
// page, null when it is not found or failed to load.
export function viewLocation<T>(
  state: ViewState<T>,
  readyLocation: (data: T) => SidebarLocation | null,
): SidebarLocation | null | undefined {
  switch (state.kind) {
    case "ready":
      return readyLocation(state.data);
    case "loading":
    case "redirecting":
      return undefined;
    case "notFound":
    case "error":
      return null;
  }
}
