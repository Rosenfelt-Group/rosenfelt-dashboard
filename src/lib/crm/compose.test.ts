import { describe, it, expect } from "vitest";
import { replyDefaults, reSubject } from "./compose";

describe("replyDefaults", () => {
  it("replies to the sender of a received email", () => {
    expect(replyDefaults({ id: "m1", direction: "received", from_email: "a@b.co", to_emails: ["brian@rosably.com"], subject: "Hello" }))
      .toEqual({ reply_to_email_message_id: "m1", to: ["a@b.co"], subject: "Re: Hello" });
  });
  it("replies to the recipients of a sent email", () => {
    expect(replyDefaults({ id: "m1", direction: "sent", from_email: "brian@rosably.com", to_emails: ["a@b.co"], subject: "Re: Hello" }).to).toEqual(["a@b.co"]);
  });
  it("does not double the Re: prefix", () => {
    expect(reSubject("RE: x")).toBe("RE: x");
    expect(reSubject(null)).toBe("Re: ");
  });
});
