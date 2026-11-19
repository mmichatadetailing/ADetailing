import { NextResponse } from "next/server";
import type { QontoBalanceFeed } from "@/lib/domain/qonto-balance";
import { QontoRequestError } from "@/lib/integrations/qonto-client";
import { getQontoReadAccess, QontoReadAccessError } from "@/lib/integrations/qonto-read-access";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";
const reply = (body: QontoBalanceFeed | { error: string }, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

export async function GET(request: Request) {
  try {
    const access = await getQontoReadAccess("la trésorerie Qonto");
    if (access.state !== "ready") return reply({ state: access.state });
    const balance = await access.client.balance(access.organizationId, request.signal);
    return reply(balance ? { state: "ready", balance, fetchedAt: new Date().toISOString() } : { state: "no_accounts" });
  } catch (error) {
    if (error instanceof QontoReadAccessError) return reply({ error: error.message }, error.status);
    if (error instanceof QontoRequestError && [401, 403].includes(error.status)) return reply({ error: "Qonto refuse l’accès au solde. Vérifiez la connexion dans Banque." }, 502);
    if (error instanceof QontoRequestError && error.status === 429) return reply({ error: "Qonto limite temporairement les actualisations. Réessayez dans quelques minutes." }, 503);
    return reply({ error: "Le solde Qonto n’a pas pu être actualisé. Réessayez dans un instant." }, 502);
  }
}
