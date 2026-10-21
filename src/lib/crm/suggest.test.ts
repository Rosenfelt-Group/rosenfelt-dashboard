import { describe, it, expect } from "vitest";
import { suggestContact, emailDomain, FREE_MAIL_DOMAINS } from "./suggest";

const c = (id: string, first: string, last: string | null, email: string) => ({ id, first_name: first, last_name: last, email });

describe("suggestContact", () => {
  const contacts = [c("1", "Pat", "Lee", "pat@acme.org"), c("2", "Sam", "Roe", "sam@other.com"), c("3", "Kim", "Roe", "kim@other.com")];

  it("matches the single contact on the same non-free domain", () => {
    expect(suggestContact({ email: "new@acme.org" }, contacts)).toBe("1");
  });
  it("does not suggest when two contacts share the domain", () => {
    expect(suggestContact({ email: "new@other.com" }, contacts)).toBeNull();
  });
  it("ignores free-mail domains for the domain rule", () => {
    const free = [c("9", "Al", "B", "al@gmail.com")];
    for (const d of FREE_MAIL_DOMAINS) expect(suggestContact({ email: `x@${d}` }, [c("9", "Al", "B", `al@${d}`)])).toBeNull();
    expect(suggestContact({ email: "z@gmail.com" }, free)).toBeNull();
  });
  it("falls back to a case-insensitive exact full-name match", () => {
    expect(suggestContact({ email: "x@gmail.com", name: "  pat LEE " }, contacts)).toBe("1");
  });
  it("name rule needs an exact full name, and a single match", () => {
    expect(suggestContact({ email: "x@gmail.com", name: "Pat" }, contacts)).toBeNull();
    const dup = [c("1", "Pat", "Lee", "a@x.com"), c("2", "pat", "lee", "b@y.com")];
    expect(suggestContact({ email: "x@gmail.com", name: "Pat Lee" }, dup)).toBeNull();
  });
  it("domain rule wins over name rule", () => {
    expect(suggestContact({ email: "new@acme.org", name: "Sam Roe" }, contacts)).toBe("1");
  });
  it("returns null for nothing", () => {
    expect(suggestContact({ email: "bad" }, contacts)).toBeNull();
    expect(suggestContact({ email: "a@b.co" }, [])).toBeNull();
  });
  it("emailDomain lowercases", () => {
    expect(emailDomain(" A@Acme.ORG ")).toBe("acme.org");
    expect(emailDomain("nope")).toBeNull();
  });
});
