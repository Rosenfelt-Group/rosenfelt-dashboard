"use client";

import { useState } from "react";
import { DiscoveryStatus } from "@/types";
import { Button } from "@/components/ui";

/** The confirm text, stronger once the prospect may have answered. */
export function deleteConfirmMessage(status: DiscoveryStatus, hasResponse: boolean): string {
  if (status === "draft") return "Delete this draft? This can't be undone.";
  const answered = hasResponse || status === "in_progress" || status === "submitted";
  return [
    "Delete this discovery questionnaire? This can't be undone.",
    answered ? "The prospect's answers will be permanently deleted, along with any brief." : "",
    "Their link will stop working.",
  ].filter(Boolean).join("\n\n");
}

export function DeleteDiscoveryButton({ inviteId, status, hasResponse, onDeleted, disabled }: {
  inviteId: string;
  status: DiscoveryStatus;
  hasResponse: boolean;
  onDeleted: () => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (!confirm(deleteConfirmMessage(status, hasResponse))) return;
    setBusy(true); setError("");
    const res = await fetch(`/api/crm/discovery/${inviteId}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) onDeleted(); else setError((await res.json().catch(() => ({}))).error ?? "Could not delete");
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={remove} disabled={disabled || busy} className="!text-red-600">
        {busy ? "Deleting…" : status === "draft" ? "Delete draft" : "Delete"}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </>
  );
}
