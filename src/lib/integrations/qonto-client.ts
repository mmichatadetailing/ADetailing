import { z } from "zod";
const remoteTransaction = z.object({
  transaction_id: z.string().min(1).optional(), id: z.string().min(1), amount_cents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.string(), side: z.enum(["credit", "debit"]), status: z.enum(["pending", "completed", "declined", "reversed"]),
  settled_at: z.string().nullable(), emitted_at: z.string(), updated_at: z.string(),
  label: z.string().nullable().optional(), clean_counterparty_name: z.string().nullable().optional(), reference: z.string().nullable().optional(), operation_type: z.string(),
  transfer: z.object({ counterparty_account_number: z.string().nullable().optional() }).nullable().optional(),
});
export type QontoRemoteTransaction = z.infer<typeof remoteTransaction>;
export interface QontoAccount { id: string; iban: string; name: string; currency: string }

export class QontoClient {
  constructor(private readonly login: string, private readonly secret: string) {}
  private async get(path: string, params?: URLSearchParams) {
    const response = await fetch(`https://thirdparty.qonto.com/v2/${path}${params ? `?${params}` : ""}`, {
      method: "GET", headers: { Authorization: `${this.login}:${this.secret}`, Accept: "application/json" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error("Qonto refuse l’accès. Vérifiez l’identifiant et la clé API.");
      if (response.status === 429) throw new Error("Limite Qonto atteinte. Réessayez dans quelques minutes.");
      throw new Error(`Qonto est momentanément indisponible (code ${response.status}).`);
    }
    return response.json();
  }
  async organization() {
    const result = z.object({ organization: z.object({ id: z.string(), legal_name: z.string(), bank_accounts: z.array(z.object({ id: z.string().optional(), iban: z.string(), name: z.string(), currency: z.string(), status: z.string().optional() })) }) }).parse(await this.get("organization"));
    return { id: result.organization.id, name: result.organization.legal_name, accounts: result.organization.bank_accounts.filter((account) => account.currency === "EUR").map((account) => ({ ...account, id: account.id ?? account.iban })) };
  }
  async transactions(account: QontoAccount, from: string, to: string, page: number) {
    const params = new URLSearchParams({ iban: account.iban, updated_at_from: from, updated_at_to: to, sort_by: "updated_at:asc", per_page: "100", page: String(page) });
    ["pending", "completed", "declined", "reversed"].forEach((status) => params.append("status[]", status));
    return z.object({ transactions: z.array(remoteTransaction), meta: z.object({ next_page: z.number().nullable(), total_pages: z.number() }) }).parse(await this.get("transactions", params));
  }
}
