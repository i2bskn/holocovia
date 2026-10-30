import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { type PageDraft, browserStorage, readDraft, removeDraft, writeDraft } from "../drafts";
import type { PageFields } from "../edit";
import { formatDateTime } from "../format";
import { Markdown } from "../Markdown";
import { setNavigationGuard } from "../router";
import { isLeaving } from "../unload";

// The value of the folder select for the top level of the space. Folder IDs are never empty.
const TOP_LEVEL_VALUE = "";

export const TOP_LEVEL_LABEL = "（スペースの直下）";

export const EMPTY_TITLE_MESSAGE = "タイトルを入力してください";

const LEAVE_MESSAGE = "保存していない変更があります。このページを離れますか？（入力中の内容は下書きとしてこのブラウザに残ります）";

const DRAFT_DEBOUNCE_MS = 1000;

export function redirectingMessage(draftSaved: boolean): string {
  return draftSaved
    ? "ログイン画面へ移動しています。入力中の内容はこのブラウザに下書きとして保存しました"
    : "ログイン画面へ移動しています。下書きを保存できなかったため、入力中の内容は失われる可能性があります";
}

export function folderIdToValue(folderId: string | null): string {
  return folderId ?? TOP_LEVEL_VALUE;
}

export function valueToFolderId(value: string): string | null {
  return value === TOP_LEVEL_VALUE ? null : value;
}

// A draft that differs from what the screen loaded, with the inputs it would set.
export type DraftPrompt = { draft: PageDraft; fields: PageFields };

type DraftCheck = { kind: "none" } | { kind: "same" } | ({ kind: "prompt" } & DraftPrompt);

export type PageFormOptions = {
  draftKey: string;
  // The inputs the screen starts with: the page as loaded, or the empty form.
  initial: PageFields;
  // Whether the inputs differ from initial, i.e. there is something to lose.
  isChanged: (fields: PageFields) => boolean;
  // The inputs a draft sets, after fitting it to what was loaded (e.g. a folder that is gone).
  draftFields: (draft: PageDraft) => PageFields;
  // The version of the page as loaded, written into the drafts of existing pages.
  baseVersion?: number;
};

// The inputs of the page form with the protection of unsaved changes:
// - A draft is written to localStorage 1 second after the last input, and right away before sending,
//   on beforeunload, on pagehide, when leaving through the navigation guard and when unmounted with a
//   pending write. It is removed once the inputs are back to what was loaded.
// - While a draft from earlier is offered (prompt), drafts are neither written nor removed.
// - While there are changes, navigate() asks before leaving and the browser asks before unloading.
export function usePageForm({ draftKey, initial, isChanged, draftFields, baseVersion }: PageFormOptions) {
  const [fields, setFieldsState] = useState(initial);
  // Read once: a draft that equals what was loaded is removed without asking.
  const [check] = useState<DraftCheck>(() => {
    const draft = readDraft(browserStorage(), draftKey, Date.now());
    if (!draft) return { kind: "none" };
    const draftInputs = draftFields(draft);
    return isChanged(draftInputs) ? { kind: "prompt", draft, fields: draftInputs } : { kind: "same" };
  });
  const [prompt, setPrompt] = useState<DraftPrompt | null>(
    check.kind === "prompt" ? { draft: check.draft, fields: check.fields } : null,
  );
  // Whether the user has changed the inputs since the screen was opened.
  const [edited, setEdited] = useState(false);
  const [draftFailed, setDraftFailed] = useState(false);
  const changed = isChanged(fields);

  // Read by the handlers registered in effects, which outlive the render that registered them.
  const latest = useRef({ fields, prompt, edited, isChanged, draftKey, baseVersion });
  latest.current = { fields, prompt, edited, isChanged, draftKey, baseVersion };
  // A draft write is pending.
  const dirty = useRef(false);
  // Saved: drafts are no longer written.
  const finished = useRef(false);
  const mounted = useRef(false);
  const releaseGuard = useRef<(() => void) | null>(null);

  // Writes the inputs as a draft now, or removes the draft if the inputs are back to what was loaded.
  // Returns false only when a draft had to be written and could not be.
  const syncDraft = useCallback((): boolean => {
    dirty.current = false;
    const current = latest.current;
    if (finished.current || current.prompt !== null || !current.edited) return true;
    const storage = browserStorage();
    if (!current.isChanged(current.fields)) {
      removeDraft(storage, current.draftKey);
      setDraftFailed(false);
      return true;
    }
    const draft: PageDraft = { ...current.fields, savedAt: Date.now() };
    if (current.baseVersion !== undefined) draft.baseVersion = current.baseVersion;
    const ok = writeDraft(storage, current.draftKey, draft);
    setDraftFailed(!ok);
    return ok;
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (check.kind === "same") removeDraft(browserStorage(), draftKey);
    return () => {
      mounted.current = false;
      // The back button and other moves that are not asked about.
      if (dirty.current) syncDraft();
    };
    // Runs once per mount; check and draftKey do not change.
  }, []);

  useEffect(() => {
    if (!edited || prompt !== null) return;
    dirty.current = true;
    const timer = setTimeout(syncDraft, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [fields, edited, prompt, syncDraft]);

  useEffect(() => {
    function onPageHide() {
      if (dirty.current) syncDraft();
    }
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [syncDraft]);

  useEffect(() => {
    if (!changed) return;
    const release = setNavigationGuard(() => {
      const leave = window.confirm(LEAVE_MESSAGE);
      if (leave) syncDraft();
      return leave;
    });
    releaseGuard.current = release;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      syncDraft();
      // The move to the login page must not be asked about: cancelling it would leave a broken screen.
      if (isLeaving() || finished.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      release();
      releaseGuard.current = null;
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [changed, syncDraft]);

  return {
    fields,
    changed,
    prompt,
    draftFailed,
    setFields(next: PageFields) {
      setFieldsState(next);
      setEdited(true);
    },
    // Sets the inputs to the offered draft; drafts are written again from here on.
    applyDraft() {
      if (!prompt) return;
      setFieldsState(prompt.fields);
      setEdited(true);
      setPrompt(null);
    },
    discardDraft() {
      removeDraft(browserStorage(), draftKey);
      setPrompt(null);
    },
    syncDraft,
    // Called once saved, before moving away: removes the draft and the protection.
    finish() {
      finished.current = true;
      dirty.current = false;
      removeDraft(browserStorage(), draftKey);
      releaseGuard.current?.();
      releaseGuard.current = null;
    },
    // Whether the screen is still shown; results of requests that end after it is gone are dropped.
    isMounted() {
      return mounted.current;
    },
  };
}

// The offer of a draft from earlier. note is added to the message.
export function DraftNotice({
  prompt,
  note,
  onApply,
  onDiscard,
}: {
  prompt: DraftPrompt;
  note?: string;
  onApply: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="editor-notice" role="status">
      <p>
        保存していない下書きがあります（{formatDateTime(prompt.draft.savedAt)}）{note !== undefined && `。${note}`}
      </p>
      <div className="editor-actions">
        <button type="button" onClick={onApply}>
          下書きを使う
        </button>
        <button type="button" onClick={onDiscard}>
          破棄
        </button>
      </div>
    </div>
  );
}

export type FolderChoice = { value: string; label: string };

type Tab = "edit" | "preview";

// The form shared by the page creation and edit screens. The screens own the inputs and the sending.
export function PageEditor({
  fields,
  onChange,
  folderChoices,
  folderLocked,
  submitLabel,
  sending,
  locked,
  notice,
  alert,
  draftFailed,
  origin,
  onSubmit,
  onCancel,
}: {
  fields: PageFields;
  onChange: (fields: PageFields) => void;
  folderChoices: FolderChoice[];
  // The folder cannot be changed (the folders could not be loaded).
  folderLocked: boolean;
  submitLabel: string;
  // Sending, or moving to the login page: everything but the tabs is disabled.
  sending: boolean;
  // A draft is offered: the inputs and the submit button are disabled until it is answered.
  locked: boolean;
  // Shown above the inputs: the offer of a draft and other notes.
  notice: ReactNode;
  // The one error or result of sending, shown above the inputs.
  alert: ReactNode | null;
  draftFailed: boolean;
  origin: string;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const [tab, setTab] = useState<Tab>("edit");
  const id = useId();
  const inputsDisabled = sending || locked;

  return (
    <div className="page-editor">
      {notice}
      {alert !== null && (
        <div className="editor-alert" role="alert">
          {alert}
        </div>
      )}
      <div className="editor-fields">
        <label className="editor-title">
          タイトル
          <input
            type="text"
            value={fields.title}
            onChange={(event) => onChange({ ...fields, title: event.target.value })}
            disabled={inputsDisabled}
          />
        </label>
        <label className="editor-folder">
          フォルダ
          <select
            value={folderIdToValue(fields.folderId)}
            onChange={(event) => onChange({ ...fields, folderId: valueToFolderId(event.target.value) })}
            disabled={inputsDisabled || folderLocked}
          >
            {folderChoices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="editor-tabs" role="tablist" aria-label="本文">
        <button
          type="button"
          role="tab"
          id={`${id}-edit-tab`}
          aria-selected={tab === "edit"}
          aria-controls={`${id}-edit`}
          onClick={() => setTab("edit")}
        >
          編集
        </button>
        <button
          type="button"
          role="tab"
          id={`${id}-preview-tab`}
          aria-selected={tab === "preview"}
          aria-controls={`${id}-preview`}
          onClick={() => setTab("preview")}
        >
          プレビュー
        </button>
      </div>
      {/* Hidden rather than unmounted, so that the textarea keeps its undo history and scroll position. */}
      <div role="tabpanel" id={`${id}-edit`} aria-labelledby={`${id}-edit-tab`} hidden={tab !== "edit"}>
        <textarea
          className="editor-body"
          aria-label="本文"
          value={fields.body}
          onChange={(event) => onChange({ ...fields, body: event.target.value })}
          disabled={inputsDisabled}
          spellCheck={false}
        />
      </div>
      <div
        role="tabpanel"
        id={`${id}-preview`}
        aria-labelledby={`${id}-preview-tab`}
        className="editor-preview"
        hidden={tab !== "preview"}
      >
        {tab === "preview" &&
          (fields.body === "" ? <p>プレビューする本文がありません</p> : <Markdown body={fields.body} origin={origin} />)}
      </div>
      {/* Not a form: Enter in the title must not save a page that is still being written. */}
      <div className="editor-actions">
        <button type="button" onClick={onSubmit} disabled={inputsDisabled}>
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={sending}>
          やめる
        </button>
      </div>
      {draftFailed && <p className="editor-draft-failed">下書きをこのブラウザに保存できませんでした</p>}
    </div>
  );
}
