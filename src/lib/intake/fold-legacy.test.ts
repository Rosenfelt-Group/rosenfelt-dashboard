import { describe, it, expect } from "vitest";
import { classifyProspect, classifyAssessmentLead, emailFromNotes, isTestEmail } from "./fold-legacy";
import { IntakeSchema } from "./schema";

const p = (notes: string | null) => ({ id: "p1", org_name: "Acme", source: "google_appointment", notes, discovery_call_booked_at: "2026-05-22T14:30:00Z" });
const a = (email: string, source = "quiz") => ({ id: "a1", name: "Ann", email, org: "Org", source });

describe("fold-legacy classification", () => {
  it("skips prospects without email in notes", () => {
    const d = classifyProspect(p("Event Name\n30 Minute Meeting"));
    expect(d).toMatchObject({ action: "skip", reason: "no email" });
  });
  it("extracts email from notes into a calendly intake", () => {
    expect(emailFromNotes("Guest: Bob <bob@acme.io>")).toBe("bob@acme.io");
    const d = classifyProspect(p("Guest: bob@acme.io"));
    expect(d.action).toBe("intake");
    if (d.action === "intake") {
      expect(d.input).toMatchObject({ channel: "calendly", email: "bob@acme.io", stage: "call_demo_scheduled" });
      expect(IntakeSchema.safeParse(d.input).success).toBe(true);
    }
  });
  it("skips test domains", () => {
    for (const e of ["a@example.com", "b@test.com", "c@sfsfsfs.com", "D@EXAMPLE.COM"]) {
      expect(isTestEmail(e)).toBe(true);
      expect(classifyAssessmentLead(a(e))).toMatchObject({ action: "skip", reason: "test" });
    }
    expect(classifyProspect(p("x@example.com"))).toMatchObject({ action: "skip", reason: "test" });
  });
  it("skips blank assessment emails", () => {
    expect(classifyAssessmentLead(a("  "))).toMatchObject({ action: "skip", reason: "no email" });
  });
  it("maps quiz and ebook sources", () => {
    const q = classifyAssessmentLead(a("real@acme.io", "quiz"));
    const e = classifyAssessmentLead(a("real@acme.io", "ebook"));
    expect(q.action === "intake" && q.input.channel).toBe("quiz");
    expect(e.action === "intake" && e.input.channel).toBe("ebook");
    if (q.action === "intake") expect(IntakeSchema.safeParse(q.input).success).toBe(true);
  });
  it("matches domains only, not lookalikes", () => {
    expect(isTestEmail("a@latest.com")).toBe(false);
    expect(isTestEmail("x@contest.com")).toBe(false);
    expect(isTestEmail("x@mail.example.com")).toBe(true);
    expect(classifyAssessmentLead(a("a@latest.com")).action).toBe("intake");
  });
  it("ignores brian@ and crm@ rosably.com in notes", () => {
    expect(emailFromNotes("Organizer brian@rosably.com crm@rosably.com guest bob@acme.io")).toBe("bob@acme.io");
    expect(emailFromNotes("only brian@rosably.com")).toBeNull();
    expect(emailFromNotes("a@b.io then c@d.io")).toBe("a@b.io");
  });
});
