import TerminalPanel from "@/components/engineering/TerminalPanel";

export default function EngineeringPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-brand-black">Terminal</h1>
        <p className="text-sm text-brand-muted mt-0.5">
          Live SSH session — jordan@rosably-vps
        </p>
      </div>
      <TerminalPanel />
    </div>
  );
}
