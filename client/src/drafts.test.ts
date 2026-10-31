import { describe, expect, it } from "vitest";
import {
  DRAFT_TTL_MS,
  type PageDraft,
  newPageDraftKey,
  pageDraftKey,
  parseDraft,
  readDraft,
  removeDraft,
  removeExpiredDrafts,
  writeDraft,
} from "./drafts";

// Storage backed by a Map, in the order the keys were added.
class MemoryStorage implements Storage {
  readonly items = new Map<string, string>();

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

// Storage whose every call throws, as when the storage is blocked.
class BrokenStorage implements Storage {
  get length(): number {
    throw new Error("blocked");
  }

  clear(): void {
    throw new Error("blocked");
  }

  getItem(): string | null {
    throw new Error("blocked");
  }

  key(): string | null {
    throw new Error("blocked");
  }

  removeItem(): void {
    throw new Error("blocked");
  }

  setItem(): void {
    throw new Error("blocked");
  }
}

const NOW = 1_800_000_000_000;
const KEY = pageDraftKey("u1", "p1");
const DRAFT: PageDraft = { title: "手順", body: "# 手順", folderId: "f1", baseVersion: 3, savedAt: NOW };

describe("draft keys", () => {
  it("include the user and the page or space", () => {
    expect(pageDraftKey("u1", "p1")).toBe("libreno:draft:u1:page:p1");
    expect(newPageDraftKey("u1", "s1")).toBe("libreno:draft:u1:new:s1");
  });
});

describe("writeDraft and readDraft", () => {
  it("writes a draft that is read back", () => {
    const storage = new MemoryStorage();
    expect(writeDraft(storage, KEY, DRAFT)).toBe(true);
    expect(readDraft(storage, KEY, NOW)).toEqual(DRAFT);
  });

  it("keeps a draft without baseVersion and with the top level", () => {
    const storage = new MemoryStorage();
    const draft: PageDraft = { title: "", body: "本文", folderId: null, savedAt: NOW };
    writeDraft(storage, newPageDraftKey("u1", "s1"), draft);
    expect(readDraft(storage, newPageDraftKey("u1", "s1"), NOW)).toEqual(draft);
  });

  it("returns null without a draft", () => {
    expect(readDraft(new MemoryStorage(), KEY, NOW)).toBeNull();
  });

  it("removes the draft", () => {
    const storage = new MemoryStorage();
    writeDraft(storage, KEY, DRAFT);
    removeDraft(storage, KEY);
    expect(readDraft(storage, KEY, NOW)).toBeNull();
  });

  it("ignores and removes a draft older than 30 days", () => {
    const storage = new MemoryStorage();
    writeDraft(storage, KEY, DRAFT);
    expect(readDraft(storage, KEY, NOW + DRAFT_TTL_MS)).toEqual(DRAFT);
    expect(readDraft(storage, KEY, NOW + DRAFT_TTL_MS + 1)).toBeNull();
    expect(storage.items.has(KEY)).toBe(false);
  });

  it("removes every expired draft of any user when writing", () => {
    const storage = new MemoryStorage();
    const old = { ...DRAFT, savedAt: NOW - DRAFT_TTL_MS - 1 };
    storage.setItem(pageDraftKey("u1", "old1"), JSON.stringify(old));
    storage.setItem(pageDraftKey("u2", "old2"), JSON.stringify(old));
    storage.setItem(newPageDraftKey("u3", "old3"), JSON.stringify(old));
    storage.setItem(pageDraftKey("u2", "fresh"), JSON.stringify(DRAFT));
    storage.setItem("libreno:draft:u1:page:broken", "{");
    storage.setItem("other:key", JSON.stringify(old));
    expect(writeDraft(storage, KEY, DRAFT)).toBe(true);
    expect([...storage.items.keys()].sort()).toEqual(
      [pageDraftKey("u2", "fresh"), "libreno:draft:u1:page:broken", "other:key", KEY].sort(),
    );
  });

  it("does not fail on storage that throws", () => {
    const storage = new BrokenStorage();
    expect(writeDraft(storage, KEY, DRAFT)).toBe(false);
    expect(readDraft(storage, KEY, NOW)).toBeNull();
    expect(() => removeDraft(storage, KEY)).not.toThrow();
  });

  it("reports a failed write, e.g. when the storage is full", () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    expect(writeDraft(storage, KEY, DRAFT)).toBe(false);
  });

  it("works without storage", () => {
    expect(writeDraft(null, KEY, DRAFT)).toBe(false);
    expect(readDraft(null, KEY, NOW)).toBeNull();
    expect(() => removeDraft(null, KEY)).not.toThrow();
  });

  it.each([
    ["broken JSON", "{"],
    ["null", "null"],
    ["a string", JSON.stringify("draft")],
    ["a missing title", JSON.stringify({ body: "", folderId: null, savedAt: NOW })],
    ["a body of another type", JSON.stringify({ title: "", body: 1, folderId: null, savedAt: NOW })],
    ["a missing folderId", JSON.stringify({ title: "", body: "", savedAt: NOW })],
    ["a folderId of another type", JSON.stringify({ title: "", body: "", folderId: 1, savedAt: NOW })],
    ["a missing savedAt", JSON.stringify({ title: "", body: "", folderId: null })],
    ["a savedAt of another type", JSON.stringify({ title: "", body: "", folderId: null, savedAt: "1" })],
    ["a baseVersion of 0", JSON.stringify({ title: "", body: "", folderId: null, baseVersion: 0, savedAt: NOW })],
    ["a fractional baseVersion", JSON.stringify({ title: "", body: "", folderId: null, baseVersion: 1.5, savedAt: NOW })],
  ])("ignores %s", (_name, value) => {
    const storage = new MemoryStorage();
    storage.setItem(KEY, value);
    expect(readDraft(storage, KEY, NOW)).toBeNull();
  });
});

describe("parseDraft", () => {
  it("drops unknown fields", () => {
    expect(parseDraft(JSON.stringify({ ...DRAFT, extra: true }))).toEqual(DRAFT);
  });
});

describe("removeExpiredDrafts", () => {
  it("leaves the drafts that have not expired", () => {
    const storage = new MemoryStorage();
    storage.setItem(KEY, JSON.stringify(DRAFT));
    removeExpiredDrafts(storage, NOW + DRAFT_TTL_MS);
    expect(storage.items.has(KEY)).toBe(true);
  });
});
