import { type ChangeEvent, useEffect, useId, useRef, useState } from "react";
import type { Attachment } from "../../../src/api/types";
import { deleteAttachment, uploadAttachment } from "../actions";
import { formatFileSize } from "../format";
import { type ApiClient, type ListResult, loadAttachmentList } from "../load";

// The types the server accepts, so that the file picker offers them first. The server decides the type
// from the contents.
const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,application/pdf";

const PAGE_NOT_FOUND_MESSAGE = "ページが見つかりません。削除された可能性があります";
const ATTACHMENT_NOT_FOUND_MESSAGE = "添付ファイルが見つかりません。すでに削除された可能性があります";
const UNKNOWN_RESULT_MESSAGE = "サーバーに接続できませんでした。添付ファイルを読み込み直して確かめてください";
const REDIRECTING_MESSAGE = "ログイン画面へ移動しています…";

type ListState = { kind: "loading" } | ListResult<Attachment[]>;

// The attachments of a page on its edit screen: uploading a file inserts its Markdown into the body
// (onInsert), and the list offers inserting and deleting. Uploads and deletes take effect at once,
// apart from saving the page, and do not change its version.
export function AttachmentsPanel({
  client,
  pageId,
  disabled,
  onInsert,
}: {
  client: ApiClient;
  pageId: string;
  // The same condition as the body input: sending the page, or a draft is offered.
  disabled: boolean;
  onInsert: (markdown: string) => void;
}) {
  const [list, setList] = useState<ListState>({ kind: "loading" });
  // Incremented to load the list again.
  const [attempt, setAttempt] = useState(0);
  const [uploading, setUploading] = useState(false);
  // The attachment whose deletion is being confirmed.
  const [deleting, setDeleting] = useState<Attachment | null>(null);
  const [sendingDelete, setSendingDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Login is required and the move to the login page has started: everything stays disabled.
  const [redirecting, setRedirecting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const headingId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setList({ kind: "loading" });
    void loadAttachmentList(client, pageId).then((next) => {
      if (!cancelled) setList(next);
    });
    return () => {
      cancelled = true;
    };
    // client does not change while the screen is shown.
  }, [pageId, attempt]);

  function reload() {
    setAttempt((n) => n + 1);
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage(null);
    const result = await uploadAttachment(client, pageId, file);
    if (!mounted.current) return;
    // Cleared after success and failure alike, so that the same file can be chosen again.
    if (fileInput.current) fileInput.current.value = "";
    setUploading(false);
    switch (result.kind) {
      case "ok":
        setList((current) =>
          current.kind === "ok" ? { kind: "ok", value: [...current.value, result.attachment] } : current,
        );
        onInsert(result.attachment.markdown);
        return;
      case "notFound":
        setMessage(PAGE_NOT_FOUND_MESSAGE);
        return;
      case "error":
        setMessage(result.message);
        return;
      case "unknown":
        setMessage(UNKNOWN_RESULT_MESSAGE);
        return;
      case "redirecting":
        setRedirecting(true);
        return;
    }
  }

  async function onDelete(attachment: Attachment) {
    setSendingDelete(true);
    setMessage(null);
    const result = await deleteAttachment(client, attachment.id);
    if (!mounted.current) return;
    switch (result.kind) {
      case "ok":
        setSendingDelete(false);
        setDeleting(null);
        setList((current) =>
          current.kind === "ok" ? { kind: "ok", value: current.value.filter((a) => a.id !== attachment.id) } : current,
        );
        return;
      case "notFound":
        setSendingDelete(false);
        setDeleting(null);
        setMessage(ATTACHMENT_NOT_FOUND_MESSAGE);
        reload();
        return;
      case "error":
        setSendingDelete(false);
        setMessage(result.message);
        return;
      case "unknown":
        setSendingDelete(false);
        setMessage(UNKNOWN_RESULT_MESSAGE);
        return;
      case "redirecting":
        setRedirecting(true);
        return;
    }
  }

  const busy = disabled || uploading || sendingDelete || redirecting;

  return (
    <section className="attachments" aria-labelledby={headingId}>
      <h2 id={headingId}>添付ファイル</h2>
      <p className="attachments-note">
        画像（PNG・JPEG・GIF・WebP）と PDF を 10MB まで添付できます。追加すると本文に挿入されます。
      </p>
      <label className="attachments-upload">
        ファイルを追加
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          onChange={(event) => void onFileChange(event)}
          disabled={busy}
        />
      </label>
      {uploading && <p role="status">アップロード中…</p>}
      {redirecting && <p role="status">{REDIRECTING_MESSAGE}</p>}
      {message !== null && <p role="alert">{message}</p>}
      {list.kind === "loading" && <p className="status">読み込み中…</p>}
      {list.kind === "redirecting" && <p className="status">{REDIRECTING_MESSAGE}</p>}
      {list.kind === "error" && (
        <p>
          添付ファイルを読み込めませんでした{" "}
          <button type="button" onClick={reload}>
            読み込み直す
          </button>
        </p>
      )}
      {list.kind === "ok" && list.value.length > 0 && (
        <ul className="attachments-list">
          {list.value.map((attachment) => (
            <li key={attachment.id}>
              <span className="attachments-name">{attachment.filename}</span>
              <span className="attachments-size">{formatFileSize(attachment.size)}</span>
              <span className="attachments-buttons">
                <button type="button" onClick={() => onInsert(attachment.markdown)} disabled={busy}>
                  本文に挿入
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeleting(attachment);
                    setMessage(null);
                  }}
                  disabled={busy}
                >
                  削除
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {deleting !== null && (
        <form
          className="folder-form"
          aria-label="添付ファイルを削除"
          onSubmit={(event) => {
            event.preventDefault();
            void onDelete(deleting);
          }}
        >
          <p className="attachments-name">{deleting.filename}</p>
          <p>このファイルを削除します。本文から参照している箇所は表示されなくなります。元に戻せません。</p>
          <div className="folder-form-actions">
            <button type="submit" disabled={busy}>
              削除
            </button>
            <button type="button" onClick={() => setDeleting(null)} disabled={sendingDelete || redirecting}>
              やめる
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
