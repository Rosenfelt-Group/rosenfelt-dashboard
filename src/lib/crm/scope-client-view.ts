import { z } from "zod";

export type ScopeSection = { key: string; title: string; body_md: string; visibility: "internal" | "client" };

const MAX_BYTES = 200 * 1024;

/** Same shape the DB enforces (crm.scope_sections_valid), plus size caps. */
export const ScopeSectionsSchema = z
  .array(
    z.object({
      key: z.string().trim().min(1, "Every section needs a non-empty key"),
      title: z.string(),
      body_md: z.string(),
      visibility: z.enum(["internal", "client"], { message: "visibility must be 'internal' or 'client'" }),
    }),
  )
  .max(50, "At most 50 sections")
  .refine((s) => new TextEncoder().encode(JSON.stringify(s)).length <= MAX_BYTES, "Sections are too large (200 KB maximum)");

/** What the client would see: client sections only, in order. */
export function clientView(sections: ScopeSection[]): ScopeSection[] {
  return sections.filter((s) => s.visibility === "client");
}
