import { NextRequest, NextResponse } from "next/server";
import { randomBytes, pbkdf2Sync } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/requireAdmin";

function hashPassword(password: string): string {
  const salt = randomBytes(32).toString("hex");
  const hash = pbkdf2Sync(password, salt, 100_000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

export async function GET(req: NextRequest) {
  const check = await requireAdmin(req);
  if (!check.ok) return check.response;

  const { data, error } = await supabaseAdmin
    .from("dashboard_users")
    .select("id, username, role, created_at")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const check = await requireAdmin(req);
  if (!check.ok) return check.response;

  const { username, password, role } = await req.json();

  if (!username || !password || !role) {
    return NextResponse.json({ error: "Missing username, password, or role" }, { status: 400 });
  }
  const { data: roleRow } = await supabaseAdmin
    .from("dashboard_roles")
    .select("name")
    .eq("name", role)
    .single();
  if (!roleRow) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const password_hash = hashPassword(password);

  const { data, error } = await supabaseAdmin
    .from("dashboard_users")
    .insert({ username: username.toLowerCase().trim(), password_hash, role })
    .select("id, username, role, created_at")
    .single();

  if (error) {
    const msg = error.code === "23505" ? "Username already exists" : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json(data, { status: 201 });
}
