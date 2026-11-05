import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadSupabaseAppData } from "@/lib/supabase/data";
import { canManageBusiness, requireAuthenticatedWorkspace } from "@/lib/supabase/workspace";
import { exportWorkspaceExcel } from "@/lib/export/workbook";
import { qontoContext } from "@/lib/integrations/qonto-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const workspace = await requireAuthenticatedWorkspace(supabase);
    if (!canManageBusiness(workspace.role)) return NextResponse.json({ error: "L’export est réservé aux associés et administrateurs." }, { status: 403 });
    const payload = await loadSupabaseAppData(supabase, workspace.user, { allRows: true });
    const banking = await qontoContext(supabase, workspace.organizationId);
    const bytes = await exportWorkspaceExcel(payload.data, { invitations: payload.invitations, bankTransactions: banking.transactions });
    return new NextResponse(new Uint8Array(bytes), { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="ADetailing-export.xlsx"',
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    if (error instanceof Error && error.message === "Authentification requise.") {
      return NextResponse.json({ error: "Reconnectez-vous pour exporter les données." }, { status: 401 });
    }
    console.error("Workspace Excel export failed", error);
    return NextResponse.json({ error: "Impossible de préparer l’export. Vérifiez votre connexion puis réessayez." }, { status: 500 });
  }
}
