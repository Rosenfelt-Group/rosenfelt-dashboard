import { describe, it, expect } from "vitest";
import { docExt, sanitizeDocFilename, sniffDocument, readHead } from "./documents";

const bytes = (...b: number[]) => new Uint8Array(b);
const text = (s: string) => new TextEncoder().encode(s);

describe("docExt", () => {
  it("allows only the listed extensions, case-insensitively, mapping jpeg to jpg", () => {
    expect(docExt("a.PDF")).toBe("pdf");
    expect(docExt("photo.jpeg")).toBe("jpg");
    expect(docExt("deck.pptx")).toBe("pptx");
    for (const bad of ["a.exe", "a.html", "a.svg", "a.pdf.exe", "noext", "a.", "a.docm"]) expect(docExt(bad)).toBeNull();
  });
});

describe("sanitizeDocFilename", () => {
  it("keeps a normal name and strips path, controls, quotes and bidi overrides", () => {
    expect(sanitizeDocFilename("Proposal 2026.pdf")).toBe("Proposal 2026.pdf");
    expect(sanitizeDocFilename("C:\\Users\\b\\Q3 \"final\".pdf")).toBe("Q3 final.pdf");
    expect(sanitizeDocFilename("evil\u202Efdp.pdf")).toBe("evilfdp.pdf");
    expect(sanitizeDocFilename("a\r\nb.pdf")).toBe("ab.pdf");
    expect(sanitizeDocFilename("...hidden.pdf")).toBe("hidden.pdf");
  });
  it("strips C1 controls and U+2028/U+2029 (the SQL rejects [[:cntrl:]])", () => {
    expect(sanitizeDocFilename("a\u0085b\u009fc.pdf")).toBe("abc.pdf");
    expect(sanitizeDocFilename("a\u2028b\u2029c.pdf")).toBe("abc.pdf");
  });
  it("truncates long names but keeps the extension", () => {
    const s = sanitizeDocFilename("x".repeat(300) + ".docx")!;
    expect(s.length).toBe(150);
    expect(s.endsWith(".docx")).toBe(true);
  });
  it("returns null for a disallowed or missing extension or an empty name", () => {
    expect(sanitizeDocFilename("a.exe")).toBeNull();
    expect(sanitizeDocFilename("\u0001\u0002")).toBeNull();
    expect(sanitizeDocFilename(".pdf")).toBeNull();
  });
});

describe("sniffDocument", () => {
  it("accepts real signatures", () => {
    expect(sniffDocument("pdf", text("%PDF-1.7\n"))).toBe(true);
    expect(sniffDocument("png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(true);
    expect(sniffDocument("jpg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    for (const e of ["docx", "xlsx", "pptx"] as const) expect(sniffDocument(e, bytes(0x50, 0x4b, 0x03, 0x04, 0x14))).toBe(true);
    expect(sniffDocument("csv", text("a,b\n1,2\n"))).toBe(true);
    expect(sniffDocument("md", text("# Título\n"))).toBe(true);
  });
  it("refuses renamed or disguised files", () => {
    expect(sniffDocument("pdf", text("<html><script>alert(1)</script>"))).toBe(false);
    expect(sniffDocument("png", text("<svg onload=alert(1)>"))).toBe(false);
    expect(sniffDocument("jpg", bytes(0x89, 0x50, 0x4e, 0x47))).toBe(false);
    expect(sniffDocument("docx", text("%PDF-1.7"))).toBe(false);
    expect(sniffDocument("txt", bytes(0x4d, 0x5a, 0x90, 0x00))).toBe(false);
    expect(sniffDocument("txt", bytes(0xff, 0xfe, 0xfd))).toBe(false);
    expect(sniffDocument("pdf", new Uint8Array())).toBe(false);
  });
  it("does not fail text that is cut in the middle of a multi-byte character", () => {
    const t = text("ok é");
    expect(sniffDocument("txt", t.subarray(0, t.length - 1))).toBe(true);
  });
});

describe("readHead", () => {
  it("reads at most max bytes across chunks and cancels the stream", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) { c.enqueue(new Uint8Array(5000).fill(65)); },
      cancel() { cancelled = true; },
    });
    const head = await readHead(stream, 8192);
    expect(head.length).toBe(8192);
    expect(cancelled).toBe(true);
  });
  it("returns everything for a short stream", async () => {
    expect((await readHead(new Response("abc").body!)).length).toBe(3);
  });
});

describe("hostile input", () => {
  it("handles traversal, RTL, non-ASCII and extension tricks", () => {
    expect(sanitizeDocFilename("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(sanitizeDocFilename("a/b/c.pdf")).toBe("c.pdf");
    expect(sanitizeDocFilename("report\u202Egnp.exe")).toBeNull();
    expect(sanitizeDocFilename("résumé 日本語.docx")).toBe("résumé 日本語.docx");
    expect(sanitizeDocFilename("x.pdf.exe")).toBeNull();
    expect(sanitizeDocFilename("evil.svg")).toBeNull();
    const s = sanitizeDocFilename("é".repeat(400) + ".png")!;
    expect(s.length).toBeLessThanOrEqual(150);
    expect(s.endsWith(".png")).toBe(true);
  });
  it("never lets a result contain separators or controls", () => {
    for (const n of ["a\u0000.pdf", "a\tb\n.pdf", "\"\"\".pdf.pdf", "..\\..\\x.csv"]) {
      const s = sanitizeDocFilename(n);
      if (s) expect(/[\x00-\x1f/\\"]/.test(s)).toBe(false);
    }
  });
  it("refuses HTML/SVG disguised as images or text, and binaries as text", () => {
    expect(sniffDocument("png", text("<!doctype html><html>"))).toBe(false);
    expect(sniffDocument("pdf", text("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBe(false);
    expect(sniffDocument("csv", bytes(0x7f, 0x45, 0x4c, 0x46, 0, 0))).toBe(false);
    expect(sniffDocument("xlsx", bytes(0x50, 0x4b))).toBe(false);
  });
});

describe("tightened checks", () => {
  it("requires the PDF marker at offset 0", () => {
    expect(sniffDocument("pdf", text("<html><!-- %PDF-1.4 --><script>"))).toBe(false);
    expect(sniffDocument("pdf", new Uint8Array([...new Uint8Array(100), ...text("%PDF-1.4")]))).toBe(false);
    expect(sniffDocument("pdf", bytes(0xef, 0xbb, 0xbf, ...text("%PDF-1.4")))).toBe(false);
    expect(sniffDocument("pdf", text("%PDF-1.4\n"))).toBe(true);
  });
  it("truncates by code points, never splitting an emoji", () => {
    const s = sanitizeDocFilename("x".repeat(145) + "😀😀" + ".pdf")!;
    expect(s.length).toBeLessThanOrEqual(150);
    expect(s.endsWith(".pdf")).toBe(true);
    expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s)).toBe(false);
  });
});
