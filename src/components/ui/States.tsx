import clsx from "clsx";

/** Placeholder card for a list or section with nothing in it. */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("card text-center py-8", className)}>
      <p className="text-sm text-brand-muted">{title}</p>
      {description && <p className="text-xs text-brand-muted mt-1">{description}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

/** Load or save failure shown in place of (or above) the content. */
export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message: React.ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={clsx("card flex items-center justify-between gap-3 text-sm text-red-600", className)}>
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="text-xs font-medium text-red-700 underline shrink-0">
          Retry
        </button>
      )}
    </div>
  );
}

/** Pulsing placeholder cards while content loads. */
export function LoadingState({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={clsx("space-y-2", className)} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card animate-pulse h-16" />
      ))}
    </div>
  );
}
