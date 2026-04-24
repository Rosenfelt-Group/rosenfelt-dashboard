import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requirePermission } from "@/lib/requirePermission";
import { ALL_PERMISSIONS } from "@/lib/permissions";

const VALID_PERMISSIONS = new Set(ALL_PERMISSIONS as readonly string[]);

export async function GET(req: NextRequest) {
  const check = await requirePermission(req, "manage_rbac");
  if (!check.ok) return check.response;

  const { data, error } = await supabaseAdmin
    .from("dashboard_roles")
    .select("*")
    .order("is_system", { ascending: false })
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const check = await requirePermission(req, "manage_rbac");
  if (!check.ok) return check.response;

  const { name, description, permissions } = await req.json();

  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!/^[a-z0-9_-]+$/.test(name.trim())) {
    return NextResponse.json({ error: "name must be lowercase letters, numbers, _ or -" }, { status: 400 });
  }
  if (!Array.isArray(permissions)) {
    return NextResponse.json({ error: "permissions must be an array" }, { status: 400 });
  }
  const invalid = permissions.filter((p: string) => !VALID_PERMISSIONS.has(p));
  if (invalid.length > 0) {
    return NextResponse.json({ error: `Unknown permissions: ${invalid.join(", ")}` }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("dashboard_roles")
    .insert({
      name: name.trim(),
      description: description?.trim() ?? "",
      permissions,
      is_system: false,
    })
    .select("*")
    .single();

  if (error) {
    const msg = error.code === "23505" ? "A role with that name already exists" : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const check = await requirePermission(req, "manage_rbac");
  if (!check.ok) return check.response;

  const { name, description, permissions } = await req.json();

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (description !== undefined) {
    update.description = description?.trim() ?? "";
  }
  if (permissions !== undefined) {
    if (!Array.isArray(permissions)) {
      return NextResponse.json({ error: "permissions must be an array" }, { status: 400 });
    }
    const invalid = permissions.filter((p: string) => !VALID_PERMISSIONS.has(p));
    if (invalid.length > 0) {
      return NextResponse.json({ error: `Unknown permissions: ${invalid.join(", ")}` }, { status: 400 });
    }
    update.permissions = permissions;
  }

  const { data, error } = await supabaseAdmin
    .from("dashboard_roles")
    .update(update)
    .eq("name", name)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const check = await requirePermission(req, "manage_rbac");
  if (!check.ok) return check.response;

  const { name } = await req.json();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // Prevent deletion of system roles.
  const { data: role } = await supabaseAdmin
    .from("dashboard_roles")
    .select("is_system")
    .eq("name", name)
    .single();

  if (role?.is_system) {
    return NextResponse.json({ error: "System roles cannot be deleted" }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("dashboard_roles").delete().eq("name", name);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
