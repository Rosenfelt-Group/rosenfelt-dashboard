"use client";
import { useState } from "react";
import clsx from "clsx";
import {
  WORK_TYPES,
  AGENT_FILTER_OPTIONS,
  PRIORITIES,
  SOURCES,
  ITEM_TYPE_FILTERS,
  type ItemTypeFilter,
} from "@/components/work/work-constants";
import { PHASE_NONE, type Filters } from "@/lib/work-filters";

// ─── Filter bar ───────────────────────────────────────────────────────────────

export function FilterBar({
  filters,
  setFilters,
  availableSprints,
}: {
  filters: Filters;
  setFilters: (next: Filters) => void;
  availableSprints: number[];
}) {
  function toggle<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  return (
    <div className="space-y-2">
      {/* Items toggle (Internal / Client / All) — server-side filter */}
      <ItemTypeToggle
        value={filters.itemType}
        onChange={(v) => setFilters({ ...filters, itemType: v })}
      />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <MultiSelect
          label="Agent"
          options={AGENT_FILTER_OPTIONS}
          selected={filters.agents}
          onToggle={(v) => setFilters({ ...filters, agents: toggle(filters.agents, v) })}
        />
        <MultiSelect
          label="Type"
          options={WORK_TYPES}
          selected={filters.workTypes}
          onToggle={(v) => setFilters({ ...filters, workTypes: toggle(filters.workTypes, v) })}
        />
        <MultiSelect
          label="Priority"
          options={PRIORITIES}
          selected={filters.priorities}
          onToggle={(v) =>
            setFilters({ ...filters, priorities: toggle(filters.priorities, v) })
          }
        />
        <MultiSelect
          label="Source"
          options={SOURCES}
          selected={filters.sources}
          onToggle={(v) => setFilters({ ...filters, sources: toggle(filters.sources, v) })}
        />
        <PhaseMultiSelect
          options={availableSprints}
          selected={filters.phases}
          onChange={(next) => setFilters({ ...filters, phases: next })}
        />
      </div>
    </div>
  );
}

export function ItemTypeToggle({
  value,
  onChange,
}: {
  value: ItemTypeFilter;
  onChange: (v: ItemTypeFilter) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded border border-brand-border bg-white p-0.5">
      {ITEM_TYPE_FILTERS.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={clsx(
              "text-xs px-3 py-1 rounded capitalize transition-colors",
              active
                ? "bg-brand-orange text-white"
                : "text-brand-muted hover:bg-brand-cream",
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export function PhaseMultiSelect({
  options,
  selected,
  onChange,
}: {
  options: number[];
  selected: Set<number | "none">;
  onChange: (next: Set<number | "none">) => void;
}) {
  const [open, setOpen] = useState(false);
  const isAll = selected.size === 0;
  const summary = isAll
    ? "All"
    : selected.size === 1
      ? selected.has(PHASE_NONE)
        ? "None"
        : `Phase ${Array.from(selected)[0]}`
      : `${selected.size} selected`;

  function toggle(v: number | "none") {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded border border-brand-border bg-white text-xs px-2 py-1 text-left hover:bg-brand-cream flex items-center justify-between"
      >
        <span>
          <span className="text-brand-muted">Phase:</span>{" "}
          <span className="text-brand-black">{summary}</span>
        </span>
        <span className="text-brand-muted">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full bg-white border border-brand-border rounded shadow-md max-h-60 overflow-y-auto">
            {/* "All phases" clears the restriction (empty set). */}
            <button
              onClick={() => onChange(new Set())}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-brand-offwhite text-left"
            >
              <span className={clsx("w-3", isAll ? "text-brand-orange" : "text-transparent")}>✓</span>
              <span className="text-brand-black">All phases</span>
            </button>
            {/* None is always present — items with no phase assigned. */}
            <label className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-brand-offwhite cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(PHASE_NONE)}
                onChange={() => toggle(PHASE_NONE)}
              />
              <span className="text-brand-black">None (no phase)</span>
            </label>
            {options.map((n) => (
              <label
                key={n}
                className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-brand-offwhite cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(n)}
                  onChange={() => toggle(n)}
                />
                <span className="text-brand-black">Phase {n}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function MultiSelect<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: readonly T[];
  selected: Set<T>;
  onToggle: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary =
    selected.size === 0
      ? "All"
      : selected.size === 1
        ? Array.from(selected)[0]
        : `${selected.size} selected`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded border border-brand-border bg-white text-xs px-2 py-1 text-left hover:bg-brand-cream flex items-center justify-between"
      >
        <span>
          <span className="text-brand-muted">{label}:</span>{" "}
          <span className="text-brand-black">{summary}</span>
        </span>
        <span className="text-brand-muted">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-full bg-white border border-brand-border rounded shadow-md max-h-60 overflow-y-auto">
            {options.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-brand-offwhite cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(opt)}
                  onChange={() => onToggle(opt)}
                />
                <span className="text-brand-black">{opt}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-cream text-xs px-2 py-0.5 text-brand-black">
      {label}
      <button
        onClick={onRemove}
        className="text-brand-muted hover:text-red-600"
        aria-label={`Remove ${label}`}
      >
        ×
      </button>
    </span>
  );
}
