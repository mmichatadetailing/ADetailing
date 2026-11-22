import { financialDateKey } from "./periods";

/** A date-only payment entered today must never be stored later than the current instant. */
export function paymentTimestamp(date: string, reference = new Date()) {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || financialDateKey(parsed.toISOString()) !== date) {
    throw new Error("Choisissez une date de paiement valide.");
  }
  const today = financialDateKey(reference.toISOString());
  if (date > today) throw new Error("La date du paiement ne peut pas être dans le futur.");
  return date === today ? reference.toISOString() : parsed.toISOString();
}
