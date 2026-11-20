"use client";

import { QontoInvoiceView } from "@/components/banking/qonto-invoice-view";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { useWorkspace } from "@/components/workspace-provider";

export default function FacturesPage() {
  const { mode, workspace } = useWorkspace();
  const canViewInvoices = mode === "demo" || Boolean(workspace?.canManageBusiness);

  return <div className="space-y-7">
    <PageHeader eyebrow="Qonto · lecture seule" title="Factures" description="Consultez les factures Qonto et les retards de paiement. Une facture ne crée pas d’encaissement : seuls les paiements enregistrés alimentent le suivi financier." />
    {canViewInvoices ? <QontoInvoiceView key={workspace?.organizationId ?? mode} demo={mode === "demo"} />
      : <Card><CardContent className="p-5 text-sm text-zinc-500">La consultation des factures Qonto est réservée aux associés et administrateurs.</CardContent></Card>}
  </div>;
}
