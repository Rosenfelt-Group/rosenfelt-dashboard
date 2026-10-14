"use client";
import { useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the text is selectable in the field */
    }
  }
  return (
    <button type="button" onClick={copy} className="btn-ghost text-xs px-3 py-1.5 whitespace-nowrap">
      {copied ? "Copied ✓" : label}
    </button>
  );
}
