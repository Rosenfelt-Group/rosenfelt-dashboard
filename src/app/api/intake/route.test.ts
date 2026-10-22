import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import type { NextRequest } from "next/server";

const state = {
  rpc: vi.fn(),
  schemas: [] as string[],
};
vi.mock("@/lib/supabase-admin", () => ({
  supabaseAdmin: {
    schema: (s: string) => {
      state.schemas.push(s);
      return { rpc: (...a: unknown[]) => state.rpc(...a) };
    },
  },
}));

import { POST } from "./route";

const RESULT = { contact_id: "c", business_id: "b", lead_id: "l", created_contact: true, created_lead: true };
const req = (body: unknown, auth?: string) =>
  ({
    headers: new Headers(auth ? { authorization: auth } : {}),
    json: async () => body,
  }) as unknown as NextRequest;

beforeEach(() => {
  state.rpc = vi.fn().mockResolvedValue({ data: RESULT, error: null });
  state.schemas = [];
  process.env.INTAKE_SECRET_WORDPRESS = "wp-secret";
  process.env.INTAKE_SECRET_N8N = "n8n-secret";
});

const quiz = { channel: "quiz", email: "a@b.org", name: "A B" };

describe("POST /api/intake", () => {
  it("rejects_missing_or_unknown_secret", async () => {
    expect((await POST(req(quiz))).status).toBe(401);
    expect((await POST(req(quiz, "Bearer nope"))).status).toBe(401);
    expect((await POST(req(quiz, "wp-secret"))).status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when a secret is unset", async () => {
    delete process.env.INTAKE_SECRET_WORDPRESS;
    expect((await POST(req(quiz, "Bearer wp-secret"))).status).toBe(401);
    expect((await POST(req(quiz, "Bearer "))).status).toBe(401);
    process.env.INTAKE_SECRET_WORDPRESS = "";
    expect((await POST(req(quiz, "Bearer "))).status).toBe(401);
  });

  it("rejects_channel_not_allowed_for_caller", async () => {
    const res = await POST(req(quiz, "Bearer n8n-secret"));
    expect(res.status).toBe(403);
    expect((await POST(req({ ...quiz, channel: "calendly" }, "Bearer wp-secret"))).status).toBe(403);
    expect((await POST(req({ ...quiz, channel: "manual" }, "Bearer wp-secret"))).status).toBe(403);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("rejects_invalid_email", async () => {
    expect((await POST(req({ ...quiz, email: "nope" }, "Bearer wp-secret"))).status).toBe(400);
    expect((await POST(req({ ...quiz, name: "x".repeat(2001) }, "Bearer wp-secret"))).status).toBe(400);
    expect((await POST(req({ ...quiz, payload: { a: "x".repeat(20_001) } }, "Bearer wp-secret"))).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("passes_validated_input_to_rpc", async () => {
    const body = { ...quiz, stage: "quiz_completed", payload: { score: 7 } };
    const res = await POST(req(body, "Bearer wp-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(RESULT);
    expect(state.schemas).toEqual(["crm"]);
    expect(state.rpc).toHaveBeenCalledWith("intake_lead", { p: body });
  });

  it("allows n8n its own channels", async () => {
    const res = await POST(req({ channel: "calendly", email: "a@b.org" }, "Bearer n8n-secret"));
    expect(res.status).toBe(200);
  });

  it("returns 500 when the rpc fails", async () => {
    state.rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await POST(req(quiz, "Bearer wp-secret"))).status).toBe(500);
  });

  it("compares_secrets_in_constant_time", () => {
    const src = readFileSync("src/lib/intake/auth.ts", "utf8");
    expect(src).toMatch(/timingSafeEqual/);
  });
});
