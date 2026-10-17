import TerminalPanel from "@/components/engineering/TerminalPanel";
import { PageHeader } from "@/components/ui";

export default function EngineeringPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Terminal" description="Live SSH session — jordan@rosably-vps" />
      <TerminalPanel />
    </div>
  );
}
