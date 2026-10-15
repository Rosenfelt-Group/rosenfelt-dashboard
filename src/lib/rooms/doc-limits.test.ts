import { describe, it, expect } from "vitest";
import { targetAfterPrep, canPreviewDoc } from "./doc-limits";

describe("targetAfterPrep", () => {
  it("adopts the deliverable created by a new-document prep so a retry reuses it", () => {
    expect(targetAfterPrep("", "new-id")).toBe("new-id");
  });
  it("keeps an explicitly chosen target", () => {
    expect(targetAfterPrep("chosen", "chosen")).toBe("chosen");
  });
});

describe("canPreviewDoc", () => {
  it("allows pdf, png, jpg, txt, csv, md (any case) and refuses office formats and junk", () => {
    for (const e of ["pdf", "PNG", "jpg", "txt", "csv", "md"]) expect(canPreviewDoc(e)).toBe(true);
    for (const e of ["docx", "xlsx", "pptx", "html", "", undefined, null, 5]) expect(canPreviewDoc(e)).toBe(false);
  });
});
