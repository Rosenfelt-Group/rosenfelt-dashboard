"use client";
import { useState } from "react";
import { Button } from "@/components/ui";

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
    <Button variant="ghost" size="sm" onClick={copy} className="whitespace-nowrap">
      {copied ? "Copied ✓" : label}
    </Button>
  );
}
