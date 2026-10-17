import TerminalPanel from "@/components/engineering/TerminalPanel";

/** Live SSH terminal (jordan@rosably-vps). */
export function TerminalAdminPanel() {
  return (
    <div className="max-w-5xl">
      <p className="text-sm text-brand-muted mb-4">Live SSH session — jordan@rosably-vps</p>
      <TerminalPanel />
    </div>
  );
}
