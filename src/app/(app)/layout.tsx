import { AppShell } from "@/components/app-shell";
import { WorkspaceProvider } from "@/components/workspace-provider";

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceProvider><AppShell>{children}</AppShell></WorkspaceProvider>;
}
