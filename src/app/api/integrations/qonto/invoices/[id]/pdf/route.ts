import { NextResponse } from "next/server";
import { z } from "zod";
import { QontoRequestError } from "@/lib/integrations/qonto-client";
import { getQontoInvoiceAccess, QontoInvoiceAccessError } from "@/lib/integrations/qonto-invoice-access";
import { QontoInvoicePdfError } from "@/lib/integrations/qonto-invoice-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const reply = (error: string, status: number) => NextResponse.json({ error }, { status, headers: privateHeaders });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await getQontoInvoiceAccess();
    if (access.state !== "ready") return reply("Activez la connexion Qonto dans Banque pour ouvrir les factures.", 409);
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return reply("Identifiant de facture invalide.", 400);
    const pdf = await access.client.clientInvoicePdf(id, access.organizationId, request.signal);
    return new Response(pdf, { headers: {
      ...privateHeaders,
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="facture-qonto.pdf"',
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Frame-Options": "SAMEORIGIN",
    } });
  } catch (error) {
    if (error instanceof QontoInvoiceAccessError || error instanceof QontoInvoicePdfError) return reply(error.message, error.status);
    if (error instanceof QontoRequestError && [401, 403].includes(error.status)) return reply("Qonto refuse l’accès au PDF. Vérifiez les autorisations de la connexion dans Banque.", 502);
    if (error instanceof QontoRequestError && error.status === 429) return reply("Qonto limite temporairement les aperçus. Réessayez dans quelques minutes.", 503);
    return reply("Le PDF Qonto n’a pas pu être chargé. Réessayez dans un instant.", 502);
  }
}
