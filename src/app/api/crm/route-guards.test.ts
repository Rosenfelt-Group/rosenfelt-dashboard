import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every CRM / Rooms API handler must check permissions itself. The middleware
// only checks that someone is logged in, and a viewer account exists.
const ROOTS = ["src/app/api/crm", "src/app/api/engagements", "src/app/api/deliverables", "src/app/api/versions"];
const HANDLER = /export async function (GET|POST|PUT|PATCH|DELETE)\([^)]*\)[^{]*\{([\s\S]{0,400})/g;
const MONEY = /client-services\/\[id\]\/(invoice|activate|cancel)/;

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return routes(p);
    return name === "route.ts" ? [p] : [];
  });
}

describe("CRM and Rooms API routes", () => {
  const files = ROOTS.flatMap(routes);

  it("finds the routes", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  for (const file of files) {
    it(`${file} guards every handler`, () => {
      const src = readFileSync(file, "utf8");
      const handlers = [...src.matchAll(HANDLER)];
      expect(handlers.length).toBeGreaterThan(0);
      for (const [, method, head] of handlers) {
        if (MONEY.test(file)) {
          expect(head, `${method} must be admin-only`).toMatch(/requireAdmin\(/);
        } else if (method === "GET") {
          expect(head, `${method} needs a permission check`).toMatch(/require(Admin\(|Permission\([^)]*"(view|manage)_crm")/);
        } else {
          expect(head, `${method} must require manage_crm or admin`).toMatch(/require(Admin\(|Permission\([^)]*"manage_crm")/);
        }
      }
    });
  }
});
