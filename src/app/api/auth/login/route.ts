import { NextRequest, NextResponse } from "next/server";
import { pbkdf2Sync } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { createSessionToken, COOKIE_NAME, Role } from "@/lib/session";
import { DEFAULT_PERMISSIONS } from "@/lib/permissions";

const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const derived = pbkdf2Sync(password, salt, 100_000, 64, "sha512").toString("hex");
  return derived === hash;
}

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  if (!username || !password) {
    return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
  }

  const { data: user, error } = await supabaseAdmin
    .from("dashboard_users")
    .select("password_hash, role")
    .eq("username", username.toLowerCase().trim())
    .single();

  if (error || !user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  const role = user.role as Role;

  // Fetch permissions for this role from dashboard_roles.
  // Fall back to defaults if the role row doesn't exist yet.
  let permissions: string[] = DEFAULT_PERMISSIONS[role] ?? [];
  const { data: roleRow } = await supabaseAdmin
    .from("dashboard_roles")
    .select("permissions")
    .eq("name", role)
    .single();
  if (roleRow?.permissions) {
    permissions = roleRow.permissions as string[];
  }

  const token = await createSessionToken(username.toLowerCase().trim(), role, permissions);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return res;
}
