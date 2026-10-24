"use client";

/** The "Use in scope" checkbox shown on each research item. */
export function UseInScope({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-brand-muted whitespace-nowrap cursor-pointer select-none">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)}
        className="accent-brand-orange" />
      Use in scope
    </label>
  );
}
