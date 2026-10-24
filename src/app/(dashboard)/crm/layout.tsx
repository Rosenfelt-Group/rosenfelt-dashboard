import { CrmToolbar } from "@/components/crm/shell/CrmToolbar";

// Every CRM page gets the ⌘K search and the + New menu above its own header.
export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CrmToolbar />
      {children}
    </>
  );
}
