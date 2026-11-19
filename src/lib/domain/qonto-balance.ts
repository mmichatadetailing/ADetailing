import { z } from "zod";

export interface QontoBalance {
  balanceCents: number;
  availableCents: number | null;
  accountCount: number;
}
export type QontoBalanceFeed =
  | { state: "ready"; balance: QontoBalance; fetchedAt: string }
  | { state: "not_connected" | "paused" | "no_accounts" };

const cents = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const organizationSchema = z.object({ organization: z.object({
  id: z.string().min(1),
  bank_accounts: z.array(z.object({
    id: z.string().nullish(), iban: z.string().nullish(), slug: z.string().nullish(),
    currency: z.string(), status: z.string(),
    balance_cents: z.unknown(), authorized_balance_cents: z.unknown(),
  })),
}) });

function sumCents(values: number[]) {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(-Number.MAX_SAFE_INTEGER)) throw new Error("Solde Qonto hors limites.");
  return Number(total);
}

/** Use bank balances, never reconstruct cash from the imported/reconciled transactions. */
export function summarizeQontoBalances(payload: unknown, expectedOrganizationId: string): QontoBalance | null {
  const { organization } = organizationSchema.parse(payload);
  if (organization.id !== expectedOrganizationId) throw new Error("Organisation Qonto incohérente.");
  const accounts = organization.bank_accounts.filter((account) => account.status === "active" && account.currency === "EUR");
  if (!accounts.length) return null;
  const identities = new Set<string>();
  const balances: number[] = [];
  const available: number[] = [];
  for (const account of accounts) {
    const identity = account.iban?.replace(/\s/g, "").toUpperCase() || account.id || account.slug;
    if (!identity || identities.has(identity)) throw new Error("Liste des comptes Qonto incohérente.");
    identities.add(identity);
    // A missing/invalid balance must never be treated as zero or yield a partial total.
    balances.push(cents.parse(account.balance_cents));
    if (account.authorized_balance_cents != null) available.push(cents.parse(account.authorized_balance_cents));
  }
  return { balanceCents: sumCents(balances), availableCents: available.length === accounts.length ? sumCents(available) : null, accountCount: accounts.length };
}
