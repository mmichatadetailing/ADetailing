import { financialDateKey } from "./periods";

// The historical register is authoritative through 23 June, in the
// business's timezone. This is a payment-date boundary, not an import date.
export function isInternalLedgerHistory(paidAt: string) {
  const day = financialDateKey(paidAt);
  return Boolean(day) && day < "2026-06-24";
}
