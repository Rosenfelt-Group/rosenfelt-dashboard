import { NextRequest, NextResponse } from "next/server";
import { pbkdf2Sync } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { createSessionToken, COOKIE_NAME } from "@/lib/session";

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
    .select("password_hash")
    .eq("username", username.toLowerCase().trim())
    .single();

  if (error || !user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  const token = await createSessionToken(username.toLowerCase().trim());
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
