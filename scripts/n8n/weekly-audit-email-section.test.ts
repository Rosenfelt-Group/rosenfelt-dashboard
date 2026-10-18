import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

type Problem = { record_type: string; recipient: string; subject: string | null; tag: string | null; description?: string; inactive: boolean | null; resolution: string | null };
const { formatEmailSection } = createRequire(import.meta.url)("./weekly-audit-email-section.js") as {
  formatEmailSection(stats: unknown, problems: Problem[] | null): string;
};

const bounce = (o: Partial<Problem> = {}): Problem => ({
  record_type: "Bounce", recipient: "a@example.com", subject: "Your invite", tag: "dashboard-room-invite",
  inactive: true, resolution: null, ...o,
});
const spam = (o: Partial<Problem> = {}): Problem => bounce({ record_type: "SpamComplaint", inactive: true, ...o });

describe("formatEmailSection", () => {
  it("renders a normal week with no problems and no warning", () => {
    const s = formatEmailSection({ Sent: 200, Bounced: 1, SpamComplaints: 0 }, []);
    expect(s).toBe("## Email delivery\nSent 200 · Delivered 99.5% · Bounce rate 0.5% · Spam complaints 0");
  });

  it("lists one line per problem with its source label", () => {
    const s = formatEmailSection({ Sent: 200, Bounced: 1, SpamComplaints: 0 }, [bounce({ tag: "n8n-stripe-buyer" })]);
    expect(s).toContain("Hard bounce — a@example.com — \"Your invite\" (n8n · stripe-buyer)");
  });

  it("warns at >= 2% bounce rate with >= 50 sends", () => {
    const s = formatEmailSection({ Sent: 100, Bounced: 2, SpamComplaints: 0 }, [bounce({ resolution: "dismissed" }), bounce({ resolution: "dismissed" })]);
    expect(s).toContain("⚠️ Email needs attention: bounce rate 2.0%.");
  });

  it("does not warn on a 2% rate below 50 sends for a soft bounce", () => {
    const s = formatEmailSection({ Sent: 40, Bounced: 1, SpamComplaints: 0 }, [bounce({ inactive: false, tag: null })]);
    expect(s).not.toContain("⚠️");
    expect(s).toContain("Bounce — a@example.com — \"Your invite\" (Other)");
  });

  it("warns on an unresolved hard bounce under 50 sends", () => {
    const s = formatEmailSection({ Sent: 10, Bounced: 1, SpamComplaints: 0 }, [bounce()]);
    expect(s).toContain("⚠️ Email needs attention: 1 hard bounce.");
  });

  it("warns on an unresolved hard bounce at >= 50 sends even below 2%", () => {
    const s = formatEmailSection({ Sent: 200, Bounced: 1, SpamComplaints: 0 }, [bounce()]);
    expect(s).toContain("⚠️ Email needs attention: 1 hard bounce.");
  });

  it("does not warn for a resolved hard bounce but still lists it", () => {
    const s = formatEmailSection({ Sent: 10, Bounced: 1, SpamComplaints: 0 }, [bounce({ resolution: "dismissed" })]);
    expect(s).not.toContain("⚠️");
    expect(s).toContain("Hard bounce — a@example.com");
  });

  it("does not warn for a resolved complaint but still lists it and keeps Postmark's total", () => {
    const s = formatEmailSection({ Sent: 500, Bounced: 0, SpamComplaints: 1 }, [spam({ resolution: "dismissed" })]);
    expect(s).not.toContain("⚠️");
    expect(s).toContain("Spam complaints 1");
    expect(s).toContain("Spam complaint — a@example.com — \"Your invite\" (Dashboard · room invite) — fixed: dismissed");
  });

  it("counts only unresolved rows in the warning when resolved and unresolved are mixed", () => {
    const s = formatEmailSection({ Sent: 10, Bounced: 2, SpamComplaints: 1 },
      [bounce({ resolution: "resent" }), bounce({ recipient: "b@example.com" }), spam({ resolution: "dismissed" })]);
    expect(s).toContain("⚠️ Email needs attention: 1 hard bounce.");
  });

  it("skips the problem-based warning when the details query failed", () => {
    const s = formatEmailSection({ Sent: 10, Bounced: 1, SpamComplaints: 1 }, null);
    expect(s).not.toContain("⚠️");
    expect(s).toContain("Couldn't read bounce details this week.");
  });

  it("warns on any spam complaint", () => {
    const s = formatEmailSection({ Sent: 500, Bounced: 0, SpamComplaints: 1 }, [spam()]);
    expect(s).toContain("Spam complaint — a@example.com");
    expect(s).toContain("⚠️ Email needs attention: 1 spam complaint.");
  });

  it("says Postmark was unreachable when stats failed", () => {
    expect(formatEmailSection({ ErrorCode: 10, Message: "Invalid token" }, [bounce()]))
      .toBe("## Email delivery\nEmail delivery: couldn't reach Postmark this week.");
    expect(formatEmailSection(null, null)).toContain("couldn't reach Postmark this week.");
  });

  it("shows the resolution for a resolved problem", () => {
    const s = formatEmailSection({ Sent: 200, Bounced: 1, SpamComplaints: 0 }, [bounce({ resolution: "resent" })]);
    expect(s).toContain("(Dashboard · room invite) — fixed: resent");
  });

  it("notes when the bounce details query failed", () => {
    expect(formatEmailSection({ Sent: 200, Bounced: 0, SpamComplaints: 0 }, null)).toContain("Couldn't read bounce details this week.");
  });

  it("handles zero sends", () => {
    expect(formatEmailSection({ Sent: 0, Bounced: 0, SpamComplaints: 0 }, [])).toContain("Sent 0 · Delivered — · Bounce rate — · Spam complaints 0");
  });
});
