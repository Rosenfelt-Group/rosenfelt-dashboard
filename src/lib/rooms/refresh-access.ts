import { supabaseAdmin } from "@/lib/supabase-admin";
import { generateToken, hashToken, roomLink } from "./token";

export type RefreshAccessResult =
  | { ok: true; accessId: string; link: string; expiresAt: string }
  | { ok: false; status: number; error: string };

/**
 * Revoke a room link and issue its replacement in one database transaction (rooms.refresh_access).
 * The new raw link is returned exactly once; only its hash reaches the database. Callers must never
 * log or store `link`. Errors are safe to show the user.
 */
export async function refreshAccess(engagementId: string, accessId: string, expiresDays = 60): Promise<RefreshAccessResult> {
  const raw = generateToken();
  const expiresAt = new Date(Date.now() + expiresDays * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin.schema("rooms").rpc("refresh_access", {
    p_eng: engagementId, p_access: accessId, p_token_hash: hashToken(raw), p_expires_at: expiresAt,
  });
  if (error) {
    if (error.code === "P0002") return { ok: false, status: 404, error: "Link not found." };
    if (error.code === "P0001") {
      return { ok: false, status: 409, error: "This link can't be refreshed: it was already revoked or the room is closed." };
    }
    return { ok: false, status: 500, error: "Could not refresh this link." };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { access_id: string; expires_at: string } | null;
  if (!row) return { ok: false, status: 500, error: "Could not refresh this link." };
  return { ok: true, accessId: row.access_id, link: roomLink(raw), expiresAt: row.expires_at };
}
