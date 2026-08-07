import { fileToChatImage } from "./images";
import type { ChatAttachmentMeta } from "./types";

export const MAX_CHAT_ATTACHMENTS = 6;
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024; // 4MB each
export const MAX_TEXT_CHARS = 120_000;

export type ChatAttachmentKind = ChatAttachmentMeta["kind"];

/** Client-side pending attachment ready for the chat API. */
export type ChatAttachment =
  | {
      id: string;
      kind: "image";
      name: string;
      mime: string;
      dataUrl: string;
    }
  | {
      id: string;
      kind: "text";
      name: string;
      mime: string;
      text: string;
    }
  | {
      id: string;
      kind: "file";
      name: string;
      mime: string;
      dataUrl: string;
    };

/** Wire format for agent-loop attachments (no client ids). */
export type ChatAttachmentPayload =
  | { kind: "image"; name: string; dataUrl: string; mime?: string }
  | { kind: "text"; name: string; text: string; mime?: string }
  | { kind: "file"; name: string; dataUrl: string; mime: string };

const TEXT_EXT =
  /\.(csv|tsv|txt|json|md|markdown|xml|html?|log|ya?ml|toml|ini|env|sql|js|jsx|ts|tsx|css|scss|less|py|r|rs|go|java|c|cpp|h|hpp|sh|bash|zsh|bat|ps1|php|rb|swift|kt|scala|lua|pl|conf|cfg|properties|gitignore|dockerignore)$/i;

const TEXT_MIME =
  /^(text\/|application\/(json|xml|javascript|typescript|x-yaml|yaml|csv|x-ndjson|sql|x-sh|x-www-form-urlencoded))/i;

const PDF_MIME = /^application\/pdf$/i;
const PDF_EXT = /\.pdf$/i;

function uid() {
  return crypto.randomUUID();
}

function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function looksLikeText(bytes: Uint8Array) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  let weird = 0;
  for (const b of sample) {
    if (b === 0) return false;
    // Allow common whitespace / printable / UTF-8 continuation
    if (b < 7 || (b > 14 && b < 32 && b !== 27)) weird += 1;
  }
  return weird / sample.length < 0.08;
}

function isTextFile(file: File) {
  if (TEXT_MIME.test(file.type)) return true;
  if (TEXT_EXT.test(file.name)) return true;
  // Empty mime + text-looking extension already covered; bare "application/octet-stream" with text ext handled above
  return false;
}

function isPdf(file: File) {
  return PDF_MIME.test(file.type) || PDF_EXT.test(file.name);
}

function mimeFor(file: File, fallback: string) {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const ext = extOf(file.name);
  if (ext === ".csv") return "text/csv";
  if (ext === ".tsv") return "text/tab-separated-values";
  if (ext === ".json") return "application/json";
  if (ext === ".md" || ext === ".markdown") return "text/markdown";
  if (ext === ".txt" || ext === ".log") return "text/plain";
  return fallback;
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read file"));
    };
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

async function fileToText(file: File): Promise<string> {
  const raw = await file.text();
  if (raw.length <= MAX_TEXT_CHARS) return raw;
  return `${raw.slice(0, MAX_TEXT_CHARS)}\n\n[…truncated ${raw.length - MAX_TEXT_CHARS} characters]`;
}

/**
 * Convert a browser File into a chat attachment the model can consume.
 * Images → vision; text/CSV/JSON → inline text; PDF → file part; other binary → rejected.
 */
export async function fileToChatAttachment(file: File): Promise<ChatAttachment> {
  if (file.size <= 0) {
    throw new Error(`“${file.name}” is empty`);
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `“${file.name}” is too large (max ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB)`,
    );
  }

  if (file.type.startsWith("image/")) {
    const dataUrl = await fileToChatImage(file);
    return {
      id: uid(),
      kind: "image",
      name: file.name || "image",
      mime: mimeFor(file, "image/jpeg"),
      dataUrl,
    };
  }

  if (isPdf(file)) {
    const dataUrl = await fileToDataUrl(file);
    return {
      id: uid(),
      kind: "file",
      name: file.name || "document.pdf",
      mime: "application/pdf",
      dataUrl,
    };
  }

  if (isTextFile(file)) {
    const text = await fileToText(file);
    return {
      id: uid(),
      kind: "text",
      name: file.name || "attachment.txt",
      mime: mimeFor(file, "text/plain"),
      text,
    };
  }

  // Unknown mime — try UTF-8 text if it looks textual (exports sometimes omit types)
  const buf = new Uint8Array(await file.arrayBuffer());
  if (looksLikeText(buf)) {
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let text = decoder.decode(buf);
    if (text.length > MAX_TEXT_CHARS) {
      text = `${text.slice(0, MAX_TEXT_CHARS)}\n\n[…truncated ${text.length - MAX_TEXT_CHARS} characters]`;
    }
    return {
      id: uid(),
      kind: "text",
      name: file.name || "attachment.txt",
      mime: mimeFor(file, "text/plain"),
      text,
    };
  }

  throw new Error(
    `“${file.name}” isn’t a readable text/PDF/image. Export as CSV, PDF, or image and try again.`,
  );
}

export function attachmentMeta(a: ChatAttachment): ChatAttachmentMeta {
  return { name: a.name, kind: a.kind, mime: a.mime };
}

export function toAttachmentPayload(a: ChatAttachment): ChatAttachmentPayload {
  if (a.kind === "image") {
    return { kind: "image", name: a.name, dataUrl: a.dataUrl, mime: a.mime };
  }
  if (a.kind === "text") {
    return { kind: "text", name: a.name, text: a.text, mime: a.mime };
  }
  return { kind: "file", name: a.name, dataUrl: a.dataUrl, mime: a.mime };
}

export function formatAttachedFilesPrompt(
  attachments: Array<{ name: string; text: string }>,
): string {
  if (!attachments.length) return "";
  return attachments
    .map(
      (a) =>
        `----- Attached file: ${a.name} -----\n${a.text}\n----- End of ${a.name} -----`,
    )
    .join("\n\n");
}

export type UserContentPart =
  | { type: "text"; text: string }
  | {
      type: "image";
      image: string;
      providerOptions?: { openai: { imageDetail: "low" | "high" } };
    }
  | { type: "file"; data: string; mediaType: string; filename?: string };

/**
 * Build multimodal user content from text + images + attachments.
 * No caps — callers pass the full conversation payload.
 */
export function buildUserContentParts(opts: {
  text: string;
  images?: string[];
  attachments?: ChatAttachmentPayload[];
  imageDetail?: "low" | "high";
}): UserContentPart[] {
  const attachments = opts.attachments ?? [];
  const imageFromAttachments = attachments
    .filter(
      (a): a is Extract<ChatAttachmentPayload, { kind: "image" }> =>
        a.kind === "image" && typeof a.dataUrl === "string",
    )
    .map((a) => a.dataUrl);
  const textAttachments = attachments.filter(
    (a): a is Extract<ChatAttachmentPayload, { kind: "text" }> =>
      a.kind === "text" && typeof a.text === "string" && a.text.length > 0,
  );
  const fileAttachments = attachments.filter(
    (a): a is Extract<ChatAttachmentPayload, { kind: "file" }> =>
      a.kind === "file" && typeof a.dataUrl === "string",
  );

  const images = [...(opts.images ?? []), ...imageFromAttachments];
  const textBlock = [
    opts.text,
    formatAttachedFilesPrompt(
      textAttachments.map((a) => ({ name: a.name, text: a.text })),
    ),
  ]
    .filter(Boolean)
    .join("\n\n");

  const parts: UserContentPart[] = [
    { type: "text", text: textBlock || opts.text || "(attachment)" },
  ];
  const detail = opts.imageDetail ?? "high";

  for (const url of images) {
    if (!url) continue;
    parts.push({
      type: "image",
      image: url,
      providerOptions: { openai: { imageDetail: detail } },
    });
  }

  for (const file of fileAttachments) {
    const parsed = parseDataUrl(file.dataUrl);
    if (!parsed) continue;
    parts.push({
      type: "file",
      data: parsed.base64,
      mediaType: file.mime || parsed.mime,
      filename: file.name,
    });
  }

  return parts;
}

export function parseDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const m = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,([\s\S]+)$/);
  if (!m) return null;
  return { mime: m[1] || "application/octet-stream", base64: m[2] };
}
