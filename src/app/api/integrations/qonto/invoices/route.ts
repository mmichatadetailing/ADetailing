import { NextResponse } from "next/server";
import { QontoRequestError } from "@/lib/integrations/qonto-client";
import { getQontoInvoiceAccess, QontoInvoiceAccessError } from "@/lib/integrations/qonto-invoice-access";
import type { QontoInvoiceFeed } from "@/lib/domain/qonto-invoices";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const reply = (body: QontoInvoiceFeed | { error: string }, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

export async function GET(request: Request) {
  try {
    const access = await getQontoInvoiceAccess();
    if (access.state !== "ready") return reply({ state: access.state });
    const invoices = await access.client.clientInvoices(access.organizationId, request.signal);
    return reply({ state: "ready", invoices, fetchedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof QontoInvoiceAccessError) return reply({ error: error.message }, error.status);
    if (error instanceof QontoRequestError && [401, 403].includes(error.status)) return reply({ error: "Qonto refuse l’accès aux factures clients. Vérifiez la connexion dans Banque et l’accès à la facturation sur votre compte Qonto." }, 502);
    if (error instanceof QontoRequestError && error.status === 429) return reply({ error: "Qonto limite temporairement les actualisations. Réessayez dans quelques minutes." }, 503);
    return reply({ error: "La liste des factures Qonto n’a pas pu être chargée entièrement. Réessayez dans un instant." }, 502);
  }
}
