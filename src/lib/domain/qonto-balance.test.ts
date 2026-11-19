import { expect, it } from "vitest";
import { summarizeQontoBalances } from "./qonto-balance";

const account = { iban: "FR123", currency: "EUR", status: "active", balance_cents: 10023, authorized_balance_cents: 9023 };
const payload = (bank_accounts: object[]) => ({ organization: { id: "org", bank_accounts } });
it("additionne les soldes comptabilisés et distingue les fonds disponibles", () => {
  expect(summarizeQontoBalances(payload([account, { ...account, iban: "FR456", balance_cents: 2577, authorized_balance_cents: 1577 }]), "org"))
    .toEqual({ balanceCents: 12600, availableCents: 10600, accountCount: 2 });
});
it("conserve les soldes nuls ou négatifs au centime près", () => {
  expect(summarizeQontoBalances(payload([{ ...account, balance_cents: 0, authorized_balance_cents: -100 }]), "org"))
    .toEqual({ balanceCents: 0, availableCents: -100, accountCount: 1 });
  expect(summarizeQontoBalances(payload([{ ...account, balance_cents: -150 }]), "org")?.balanceCents).toBe(-150);
});
it("n’inclut pas les comptes clôturés ni les devises étrangères", () => {
  expect(summarizeQontoBalances(payload([account, { ...account, iban: "FR456", status: "closed", balance_cents: 900000 }, { ...account, iban: "GB123", currency: "GBP", balance_cents: 100000 }]), "org"))
    .toEqual({ balanceCents: 10023, availableCents: 9023, accountCount: 1 });
});
it("ne confond pas l’absence de compte avec un solde nul", () => {
  expect(summarizeQontoBalances(payload([]), "org")).toBeNull();
  expect(summarizeQontoBalances(payload([{ ...account, status: "closed" }]), "org")).toBeNull();
});
it.each([undefined, null, "100", 10.5, Number.MAX_SAFE_INTEGER + 1])("refuse un solde manquant ou invalide (%s) sans afficher un total partiel", (balance_cents) => {
  expect(() => summarizeQontoBalances(payload([account, { ...account, iban: "FR456", balance_cents }]), "org")).toThrow();
});
it("ne substitue pas le solde comptabilisé à un disponible non communiqué", () => {
  expect(summarizeQontoBalances(payload([account, { ...account, iban: "FR456", authorized_balance_cents: null }]), "org"))
    .toEqual({ balanceCents: 20046, availableCents: null, accountCount: 2 });
});
it("refuse un compte répété, un identifiant absent ou une autre organisation", () => {
  expect(() => summarizeQontoBalances(payload([account, { ...account, iban: "FR 123" }]), "org")).toThrow("comptes Qonto incohérente");
  expect(() => summarizeQontoBalances(payload([{ ...account, iban: "" }]), "org")).toThrow();
  expect(() => summarizeQontoBalances(payload([account]), "other")).toThrow("Organisation Qonto incohérente");
});
it("ne perd pas de précision si la somme dépasse la limite des entiers exacts", () => {
  expect(() => summarizeQontoBalances(payload([{ ...account, balance_cents: Number.MAX_SAFE_INTEGER }, { ...account, iban: "FR456", balance_cents: 1 }]), "org")).toThrow("hors limites");
});
