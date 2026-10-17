import clsx from "clsx";

type PageHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned controls, e.g. a "New lead" button. */
  actions?: React.ReactNode;
  className?: string;
};

/** The page's h1, optional subtitle and actions, with standard spacing below. */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={clsx("flex items-start justify-between gap-4 mb-6", className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-brand-black">{title}</h1>
        {description && <p className="text-sm text-brand-muted mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
