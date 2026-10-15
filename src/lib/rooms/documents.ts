import { DOC_TYPES, isSafeDocFilename, type DocExt } from "./grant";

export function docExt(name: string): DocExt | null {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(name);
  if (!m) return null;
  const e = m[1].toLowerCase();
  const norm = e === "jpeg" ? "jpg" : e;
  return norm in DOC_TYPES ? (norm as DocExt) : null;
}

// A display name safe for headers and the database: last path segment only, no control characters,
// quotes, backslashes or bidi overrides, no leading dots, at most 150 characters with the extension kept.
export function sanitizeDocFilename(name: string): string | null {
  const last = name.split(/[\\/]/).pop() ?? "";
  let s = last.normalize("NFC")
    .replace(/[\x00-\x1f\x7f"\\\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ").trim().replace(/^\.+/, "").trim();
  if (!docExt(s)) return null;
  if (s.length > 150) {
    const dot = s.lastIndexOf(".");
    s = s.slice(0, 150 - (s.length - dot)).trimEnd() + s.slice(dot);
  }
  return isSafeDocFilename(s) && s.lastIndexOf(".") > 0 ? s : null;
}

function indexOfSeq(h: Uint8Array, seq: number[], limit: number): number {
  const end = Math.min(h.length, limit) - seq.length;
  for (let i = 0; i <= end; i++) if (seq.every((b, j) => h[i + j] === b)) return i;
  return -1;
}
const startsWith = (h: Uint8Array, seq: number[]) => h.length >= seq.length && seq.every((b, i) => h[i] === b);

function isLikelyText(h: Uint8Array): boolean {
  if (h.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(h, { stream: true });
    return true;
  } catch {
    return false;
  }
}

// Magic-byte check on the first bytes of the uploaded object.
export function sniffDocument(ext: DocExt, head: Uint8Array): boolean {
  if (head.length === 0) return false;
  switch (ext) {
    case "pdf": return indexOfSeq(head, [0x25, 0x50, 0x44, 0x46, 0x2d], 1024) >= 0; // "%PDF-" within the first 1 KB
    case "png": return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpg": return startsWith(head, [0xff, 0xd8, 0xff]);
    case "docx": case "xlsx": case "pptx": return startsWith(head, [0x50, 0x4b, 0x03, 0x04]); // ZIP (OOXML)
    case "txt": case "csv": case "md": return isLikelyText(head);
  }
}

export async function readHead(stream: ReadableStream<Uint8Array>, max = 8192): Promise<Uint8Array> {
  const reader = stream.getReader();
  const out = new Uint8Array(max);
  let n = 0;
  try {
    while (n < max) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const take = Math.min(value.length, max - n);
      out.set(value.subarray(0, take), n);
      n += take;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return out.slice(0, n);
}
