/** One CRM settings tab: a description line with its actions, then the content. */
export function SettingsSection({
  description,
  actions,
  children,
}: {
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-start justify-between gap-4 mb-4">
        <p className="text-sm text-brand-muted min-w-0">{description}</p>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
