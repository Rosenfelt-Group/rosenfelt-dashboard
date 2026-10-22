import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { withoutEmailSend } from "./approvalFilters";

describe("email_send is excluded from widget approve actions (R37)", () => {
  it("withoutEmailSend drops only email_send rows", () => {
    expect(withoutEmailSend([{ action_type: "email_send" }, { action_type: "sam_send_invoice" }])).toEqual([{ action_type: "sam_send_invoice" }]);
  });
  for (const f of ["src/app/(dashboard)/overview/page.tsx", "src/components/finance/OverviewPanel.tsx"]) {
    it(`${f} filters its approvals through withoutEmailSend`, () => {
      expect(readFileSync(f, "utf8")).toMatch(/withoutEmailSend\(/);
    });
  }
  it("overview handler surfaces a non-ok response", () => {
    const src = readFileSync("src/app/(dashboard)/overview/page.tsx", "utf8");
    expect(src).toMatch(/if \(!res\.ok\)[\s\S]{0,200}return;/);
  });
});
