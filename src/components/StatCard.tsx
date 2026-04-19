import clsx from "clsx";

interface StatCardProps {
  label: string;
  value: number | string;
  sub?: string;
  alert?: boolean;
  warn?: boolean;
}

export function StatCard({ label, value, sub, alert, warn }: StatCardProps) {
  return (
    <div className="card">
      <p className="text-xs text-brand-muted mb-2">{label}</p>
      <p className={clsx(
        "text-2xl font-semibold",
        alert ? "text-red-600" : warn ? "text-amber-600" : "text-brand-black"
      )}>
        {value}
      </p>
      {sub && <p className="text-xs text-brand-muted mt-1">{sub}</p>}
    </div>
  );
}
