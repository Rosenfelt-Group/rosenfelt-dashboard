import { describe, expect, it } from "vitest";
import { canResend, decodeHtmlEntities, formatUptime, problemLabel, runMeta, sourceLabel, vercelStateMeta } from "./helpers";
import type { EmailEvent } from "@/lib/email/events";

describe("formatUptime", () => {
  it("formats days+hours, hours+minutes and minutes", () => {
    expect(formatUptime(2 * 86400 + 3 * 3600 + 59)).toBe("2d 3h");
    expect(formatUptime(3600 + 5 * 60)).toBe("1h 5m");
    expect(formatUptime(42 * 60)).toBe("42m");
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes numeric, hex and named entities and leaves unknown ones", () => {
    expect(decodeHtmlEntities("It&#8217;s &amp; &#x2014; &hellip; &bogus;")).toBe("It’s & — … &bogus;");
  });
});

describe("status metas", () => {
  it("maps run and deployment states", () => {
    expect(runMeta("in_progress", null).label).toBe("Running");
    expect(runMeta("completed", "failure").label).toBe("Failed");
    expect(vercelStateMeta("CANCELED").label).toBe("Cancelled");
    expect(vercelStateMeta("WEIRD").label).toBe("WEIRD");
  });
});

describe("sourceLabel", () => {
  it("names each mail source in plain English", () => {
    expect(sourceLabel("dashboard-room-invite")).toBe("Dashboard · room invite");
    expect(sourceLabel("dashboard-discovery-invite")).toBe("Dashboard · discovery invite");
    expect(sourceLabel("n8n-stripe-buyer")).toBe("n8n · stripe-buyer");
    expect(sourceLabel("wordpress")).toBe("WordPress");
    expect(sourceLabel(null)).toBe("Other");
  });
});

describe("problemLabel", () => {
  const ev = (o: Partial<EmailEvent>) => o as EmailEvent;
  it("describes bounces, complaints and blocks", () => {
    expect(problemLabel(ev({ record_type: "Bounce", description: "Mailbox does not exist" }))).toBe("Hard bounce: Mailbox does not exist");
    expect(problemLabel(ev({ record_type: "SpamComplaint" }))).toBe("Spam complaint");
    expect(problemLabel(ev({ record_type: "SubscriptionChange" }))).toBe("Blocked");
  });
});

describe("canResend", () => {
  it("is true only for the tags the resend route supports", () => {
    for (const t of ["dashboard-room-invite", "dashboard-discovery-invite", "n8n-stripe-buyer", "n8n-typeform-intake"]) {
      expect(canResend(t)).toBe(true);
    }
    for (const t of ["n8n-avery-deliver-audit", "n8n-weekly-audit", "wordpress", "bogus", null]) {
      expect(canResend(t)).toBe(false);
    }
  });
});
