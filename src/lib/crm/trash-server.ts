// Server-only. Calls the Trash functions in crm (docs/migrations/2026-10-25_a_crm_soft_delete.sql).
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { trashError, type TrashKind } from "./trash";

type RpcResult<T> = { data: T | null; error: { code?: string; message: string; details?: string | null } | null };

/** Run a crm Trash function and turn its result or SQLSTATE into a response. */
export async function trashRpc<T>(fn: string, args: Record<string, unknown>, override?: Partial<Record<string, string>>, status = 200) {
  const { data, error } = (await supabaseAdmin.schema("crm").rpc(fn, args)) as RpcResult<T>;
  if (error) {
    const e = trashError(error, override);
    if (e.status === 500) console.error(`crm.${fn} failed`, error);
    return NextResponse.json(e.body, { status: e.status });
  }
  return NextResponse.json(data, { status });
}

/** crm.soft_delete: moves the record (and its group) to Trash. */
export function softDelete(kind: TrashKind, id: string, by: string | null) {
  return trashRpc("soft_delete", { p_kind: kind, p_id: id, p_by: by }, { TR003: "Already in Trash" });
}
