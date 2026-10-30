// Drafts of the page form, kept in the browser's localStorage so that the inputs survive the move to the
// login page, the back button and a crashed tab. They are never sent to the server.

// baseVersion is the version of the page the draft was written on; only drafts of existing pages have it.
// savedAt is UNIX time in milliseconds.
export type PageDraft = {
  title: string;
  body: string;
  folderId: string | null;
  baseVersion?: number;
  savedAt: number;
};

const DRAFT_KEY_PREFIX = "holocovia:draft:";

// Drafts older than this are ignored and removed.
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function pageDraftKey(userId: string, pageId: string): string {
  return `${DRAFT_KEY_PREFIX}${userId}:page:${pageId}`;
}

export function newPageDraftKey(userId: string, spaceId: string): string {
  return `${DRAFT_KEY_PREFIX}${userId}:new:${spaceId}`;
}

// localStorage, or null where it cannot be used (reading it can throw, e.g. when storage is blocked).
export function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// The draft in value, or null if it is not JSON of the expected shape.
export function parseDraft(value: string): PageDraft | null {
  let data: unknown;
  try {
    data = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const { title, body, folderId, baseVersion, savedAt } = data as Record<string, unknown>;
  if (typeof title !== "string" || typeof body !== "string") return null;
  if (folderId !== null && typeof folderId !== "string") return null;
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;
  const draft: PageDraft = { title, body, folderId, savedAt };
  if (baseVersion !== undefined) {
    if (typeof baseVersion !== "number" || !Number.isSafeInteger(baseVersion) || baseVersion < 1) return null;
    draft.baseVersion = baseVersion;
  }
  return draft;
}

function isExpired(draft: PageDraft, now: number): boolean {
  return now - draft.savedAt > DRAFT_TTL_MS;
}

// The draft under key. null if there is none, it is of another shape, it has expired (it is removed then)
// or storage cannot be read.
export function readDraft(storage: Storage | null, key: string, now: number): PageDraft | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(key);
    if (value === null) return null;
    const draft = parseDraft(value);
    if (!draft) return null;
    if (isExpired(draft, now)) {
      storage.removeItem(key);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

// Removes the expired drafts of every user. The keys are collected first, as removing an item changes
// the indexes of Storage.key(). Drafts of another shape are left alone.
export function removeExpiredDrafts(storage: Storage, now: number): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null && key.startsWith(DRAFT_KEY_PREFIX)) keys.push(key);
  }
  for (const key of keys) {
    const value = storage.getItem(key);
    const draft = value === null ? null : parseDraft(value);
    if (draft && isExpired(draft, now)) storage.removeItem(key);
  }
}

// Writes a draft and removes the expired ones. Returns whether the draft was written (false when storage
// cannot be used or is full).
export function writeDraft(storage: Storage | null, key: string, draft: PageDraft): boolean {
  if (!storage) return false;
  try {
    removeExpiredDrafts(storage, draft.savedAt);
  } catch {
    // Cleaning up is not needed to write the draft.
  }
  try {
    storage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function removeDraft(storage: Storage | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Storage cannot be used; there is nothing to remove.
  }
}
