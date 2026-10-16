import { describe, it, expect } from "vitest";
import { roomInviteEmail } from "./invite-email";

const base = {
  firstName: "Dana",
  orgName: "Harbor Food Bank",
  roomTitle: "Volunteer scheduling",
  link: "https://portal.example.com/r/abc123",
  expiresAt: "2026-12-14T15:00:00.000Z",
  timeZone: "UTC",
};

describe("roomInviteEmail", () => {
  it("includes the greeting, title, org, link and expiry date", () => {
    const { subject, body } = roomInviteEmail(base);
    expect(subject).toBe('"Volunteer scheduling" is ready for you to look at');
    expect(body.startsWith("Hi Dana,\n\n")).toBe(true);
    expect(body).toContain('the room for "Volunteer scheduling" (Harbor Food Bank)');
    expect(body).toContain("\n\nhttps://portal.example.com/r/abc123\n\n");
    expect(body).toContain("It expires on December 14, 2026.");
    expect(body).toContain("asked for your name and email");
    expect(body).toContain("personal to you");
    expect(body.endsWith("Thanks,\nBrian")).toBe(true);
    expect(body).not.toContain("old link");
  });

  it("uses replacement wording for a refreshed link", () => {
    const { subject, body } = roomInviteEmail({ ...base, refreshed: true });
    expect(subject).toBe('New link for "Volunteer scheduling"');
    expect(body).toContain("Here's a new link to the room");
    expect(body).toContain("The old link no longer works");
    expect(body).toContain("https://portal.example.com/r/abc123");
    expect(body).toContain("It expires on December 14, 2026.");
    expect(body).not.toContain("I've set up");
  });

  it("falls back to 'there' when no name is given", () => {
    expect(roomInviteEmail({ ...base, firstName: undefined }).body.startsWith("Hi there,")).toBe(true);
    expect(roomInviteEmail({ ...base, firstName: "  " }).body.startsWith("Hi there,")).toBe(true);
    expect(roomInviteEmail({ ...base, firstName: null }).body.startsWith("Hi there,")).toBe(true);
  });

  it("omits the org when missing", () => {
    const { body } = roomInviteEmail({ ...base, orgName: null });
    expect(body).toContain('the room for "Volunteer scheduling".');
    expect(body).not.toContain("()");
  });

  it("states 60 days when the expiry is missing or unusable", () => {
    expect(roomInviteEmail({ ...base, expiresAt: undefined }).body).toContain("It expires in 60 days.");
    expect(roomInviteEmail({ ...base, expiresAt: "not a date" }).body).toContain("It expires in 60 days.");
  });

  it("formats the expiry in the given time zone", () => {
    const { body } = roomInviteEmail({ ...base, expiresAt: "2026-12-14T03:00:00Z", timeZone: "America/Los_Angeles" });
    expect(body).toContain("It expires on December 13, 2026.");
  });
});
