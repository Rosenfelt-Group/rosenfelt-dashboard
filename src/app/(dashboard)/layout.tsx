import { Sidebar } from "@/components/Sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 md:ml-52 min-h-screen pt-12 md:pt-0">
        {children}
      </main>
    </div>
  );
}
