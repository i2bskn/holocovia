// Shared by the REST API and the MCP tools, so that both accept the same files and report the same messages.

// The upper limit of a file uploaded through the REST API (the Web UI).
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
// The upper limit through MCP. The transport of the MCP SDK accepts JSON-RPC requests of up to 4MB, and
// the file is sent as base64 in it: 2MB is about 2.8MB of base64.
export const MCP_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
// The base64 of MCP_ATTACHMENT_MAX_BYTES, with 64KB to spare for line breaks.
export const MCP_MAX_BASE64_LENGTH = 4 * Math.ceil(MCP_ATTACHMENT_MAX_BYTES / 3) + 65536;

const FILENAME_MAX_LENGTH = 250;
// Removed from file names: control characters (Cc) and format characters (Cf) such as U+202E, which can
// make a name look as if it had another extension.
const INVISIBLE_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;
const PATH_SEPARATORS = /[/\\]/g;
// Dots and whitespace at the end, which are removed before the extension is checked.
const TRAILING_DOTS = /[\s.]+$/u;
// See LONE_SURROGATE in pages/validation.ts.
const LONE_SURROGATE = /\p{Cs}/u;

export const ATTACHMENT_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
] as const;

export type AttachmentContentType = (typeof ATTACHMENT_CONTENT_TYPES)[number];

// The extensions accepted for each type, in lowercase. The first one is added to names without them.
const EXTENSIONS: Record<AttachmentContentType, readonly string[]> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "application/pdf": [".pdf"],
};

export const attachmentNotFoundMessage = "添付ファイルが見つかりません";
export const unsupportedTypeMessage = "添付できるのは PNG・JPEG・GIF・WebP の画像と PDF です";
export const emptyFileMessage = "空のファイルは添付できません";
export const fileTooLargeMessage = "添付できるファイルは 10MB までです";
export const mcpFileTooLargeMessage =
  "MCP から添付できるファイルは 2MB までです。大きなファイルは Web の編集画面から添付してください";
export const invalidFilenameMessage = "ファイル名は 1 文字以上 250 文字以下にしてください";
export const invalidBase64Message = "content_base64 が base64 として読めません";

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.byteLength < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

// Decides the type from the first bytes of the file only. The Content-Type and the extension sent by the
// client are not used. Returns null for any other type, including SVG and HTML, which can run scripts.
export function detectContentType(bytes: Uint8Array): AttachmentContentType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // GIF87a and GIF89a.
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) {
    return "image/gif";
  }
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  // %PDF-
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  return null;
}

export type AttachmentContentCheck =
  | { ok: true; contentType: AttachmentContentType }
  | { ok: false; error: "empty_file" | "file_too_large" | "unsupported_type" };

// Checks the size, then the type. maxBytes is ATTACHMENT_MAX_BYTES or MCP_ATTACHMENT_MAX_BYTES.
export function checkAttachmentContent(bytes: Uint8Array, maxBytes: number): AttachmentContentCheck {
  if (bytes.byteLength === 0) return { ok: false, error: "empty_file" };
  if (bytes.byteLength > maxBytes) return { ok: false, error: "file_too_large" };
  const contentType = detectContentType(bytes);
  if (contentType === null) return { ok: false, error: "unsupported_type" };
  return { ok: true, contentType };
}

// Returns the normalized file name without the extension check (see withAttachmentExtension), or null if
// invalid: control and format characters are removed, "/" and "\" become "_", and whitespace at both ends
// and dots at the end are removed. Length is counted in code points after that; no Unicode normalization.
export function normalizeAttachmentFilename(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (LONE_SURROGATE.test(value)) return null;
  const name = value.replace(INVISIBLE_CHARACTERS, "").replace(PATH_SEPARATORS, "_").trim().replace(TRAILING_DOTS, "");
  const length = [...name].length;
  if (length < 1 || length > FILENAME_MAX_LENGTH) return null;
  return name;
}

// Adds the extension of the type unless the name already ends with one of them (case-insensitive). The
// extension of the name is kept as part of it: "x.hta" becomes "x.hta.pdf". At most 5 characters are added,
// so a normalized name stays within 255 characters.
export function withAttachmentExtension(name: string, contentType: AttachmentContentType): string {
  const extensions = EXTENSIONS[contentType];
  const dot = name.lastIndexOf(".");
  if (dot !== -1 && extensions.includes(name.slice(dot).toLowerCase())) return name;
  return `${name}${extensions[0]}`;
}

// Escapes the characters that would change the meaning of the name in the text of a Markdown link or image.
export function escapeMarkdownText(text: string): string {
  return text.replace(/[\\`*_[\]<>]/g, "\\$&");
}

type Base64Decoder = (value: string) => Uint8Array;

// Uint8Array.fromBase64 (not in the ES2022 lib) where the runtime has it, which avoids building a string of
// the bytes as atob does.
function base64Decoder(): Base64Decoder {
  const fromBase64 = (Uint8Array as { fromBase64?: unknown }).fromBase64;
  if (typeof fromBase64 === "function") return (value) => fromBase64.call(Uint8Array, value) as Uint8Array;
  return (value) => {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };
}

// Decodes standard base64 (not base64url) after removing whitespace and line breaks. Returns null if it
// is not base64.
export function decodeBase64(value: string): Uint8Array | null {
  try {
    return base64Decoder()(value.replace(/\s+/g, ""));
  } catch {
    return null;
  }
}
