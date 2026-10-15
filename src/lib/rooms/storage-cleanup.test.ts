import { describe, it, expect, vi } from "vitest";
import { removeObjects, type StorageLike } from "./storage-cleanup";

function storage(fail: (bucket: string, names: string[]) => boolean | "throw" = () => false) {
  const calls: { bucket: string; names: string[] }[] = [];
  const s: StorageLike = {
    from: (bucket: string) => ({
      remove: vi.fn(async (names: string[]) => {
        calls.push({ bucket, names });
        const f = fail(bucket, names);
        if (f === "throw") throw new Error("network");
        return f ? { data: null, error: { message: "nope" } } : { data: names, error: null };
      }),
    }),
  };
  return { s, calls };
}

describe("removeObjects", () => {
  it("removes objects grouped by bucket", async () => {
    const { s, calls } = storage();
    const r = await removeObjects(s, [
      { bucket: "prototypes", object_name: "e/d/v1/index.html" },
      { bucket: "room-documents", object_name: "e/d/u/document.pdf" },
      { bucket: "prototypes", object_name: "e/d/v1/app.js" },
    ]);
    expect(r).toEqual({ removed: 3, failed: 0 });
    expect(calls).toEqual([
      { bucket: "prototypes", names: ["e/d/v1/index.html", "e/d/v1/app.js"] },
      { bucket: "room-documents", names: ["e/d/u/document.pdf"] },
    ]);
  });
  it("chunks at 1000 names per call", async () => {
    const { s, calls } = storage();
    const many = Array.from({ length: 2001 }, (_, i) => ({ bucket: "prototypes", object_name: `e/d/v1/f${i}` }));
    expect(await removeObjects(s, many)).toEqual({ removed: 2001, failed: 0 });
    expect(calls.map(c => c.names.length)).toEqual([1000, 1000, 1]);
  });
  it("counts errors and thrown calls as failed and never touches unknown buckets", async () => {
    const { s, calls } = storage((b) => (b === "room-documents" ? "throw" : true));
    const r = await removeObjects(s, [
      { bucket: "prototypes", object_name: "a" },
      { bucket: "room-documents", object_name: "b" },
      { bucket: "documents", object_name: "c" },
      { bucket: "prototypes", object_name: "" },
    ]);
    expect(r).toEqual({ removed: 0, failed: 4 });
    expect(calls.some(c => c.bucket === "documents")).toBe(false);
  });
});
