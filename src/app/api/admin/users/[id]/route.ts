import { NextRequest, NextResponse } from "next/server";
import { randomBytes, pbkdf2Sync } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/requireAdmin";

function hashPassword(password: string): string {
  const salt = randomBytes(32).toString("hex");
  const hash = pbkdf2Sync(password, salt, 100_000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await requireAdmin(req);
  if (!check.ok) return check.response;

  const { id } = await params;
  const body = await req.json();
  const updates: Record<string, string> = {};

  if (body.role) {
    if (body.role !== "admin" && body.role !== "viewer") {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    updates.role = body.role;
  }
  if (body.password) {
    updates.password_hash = hashPassword(body.password);
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("dashboard_users")
    .update(updates)
    .eq("id", id)
    .select("id, username, role, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const check = await requireAdmin(req);
  if (!check.ok) return check.response;

  const { id } = await params;

  // Prevent deleting the last admin
  const { data: admins } = await supabaseAdmin
    .from("dashboard_users")
    .select("id")
    .eq("role", "admin");

  const { data: target } = await supabaseAdmin
    .from("dashboard_users")
    .select("role")
    .eq("id", id)
    .single();

  if (target?.role === "admin" && admins && admins.length <= 1) {
    return NextResponse.json({ error: "Cannot delete the last admin" }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("dashboard_users").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
