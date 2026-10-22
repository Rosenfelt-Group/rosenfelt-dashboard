import { describe, expect, it } from "vitest";
import { clientView } from "./scope-client-view";

describe("clientView", () => {
  it("client_view_excludes_internal_sections", () => {
    const out = clientView([
      { key: "a", title: "A", body_md: "x", visibility: "client" },
      { key: "b", title: "B", body_md: "secret", visibility: "internal" },
      { key: "c", title: "C", body_md: "y", visibility: "client" },
    ]);
    expect(out.map((s) => s.key)).toEqual(["a", "c"]);
    expect(JSON.stringify(out)).not.toContain("secret");
  });
});
