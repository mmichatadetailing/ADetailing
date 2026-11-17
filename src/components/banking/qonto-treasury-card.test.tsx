import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ workspace: vi.fn() }));
vi.mock("@/components/workspace-provider", () => ({ useWorkspace: mocks.workspace }));
import { QontoTreasuryCard, QontoTreasuryDisplay } from "./qonto-treasury-card";
import type { QontoBalanceFeed } from "@/lib/domain/qonto-balance";
import { formatMoney } from "@/lib/utils";

const ready: QontoBalanceFeed = { state: "ready", balance: { balanceCents: 125023, availableCents: 123023, accountCount: 2 }, fetchedAt: "2026-11-17T09:00:00Z" };
beforeEach(() => mocks.workspace.mockReset());
const render = (feed: QontoBalanceFeed | null, error = "", demo = false, loading = false) => renderToStaticMarkup(
  <QontoTreasuryDisplay feed={feed} loading={loading} error={error} demo={demo} onRefresh={() => {}} />,
);
it("affiche le vrai solde, le disponible et la date de consultation à Paris", () => {
  const html = render(ready);
  expect(html).toContain(formatMoney(125023));
  expect(html).toContain(formatMoney(123023));
  expect(html).toContain("2 comptes Qonto EUR");
  expect(html).toContain("10:00");
  expect(html).toContain("Indépendant de la période");
  expect(html).toContain("Actualiser la trésorerie Qonto");
});
it("affiche un vrai solde nul ou négatif, sans les confondre avec une absence de données", () => {
  const zero = render({ ...ready, balance: { balanceCents: 0, availableCents: 0, accountCount: 1 } });
  expect(zero).toContain(formatMoney(0));
  expect(zero).toContain("1 compte Qonto EUR");
  const negative = render({ ...ready, balance: { balanceCents: -10050, availableCents: null, accountCount: 1 } });
  expect(negative).toContain('data-tone="rose"');
  expect(negative).toContain(formatMoney(-10050));
  expect(negative).not.toContain("Disponible :");
});
it("conserve le dernier solde mais le signale clairement après un échec", () => {
  const html = render(ready, "Actualisation impossible.");
  expect(html).toContain(formatMoney(125023));
  expect(html).toContain("Dernier solde connu");
  expect(html).toContain("Le montant affiché peut avoir changé.");
  expect(html).toContain('role="alert"');
});
it("n’affiche aucun montant inventé en chargement, en démonstration ou sans connexion", () => {
  for (const html of [render(null, "", false, true), render(null, "", true), render({ state: "not_connected" }), render({ state: "paused" }), render({ state: "no_accounts" })]) {
    expect(html).not.toContain("€");
    expect(html).toContain("—");
  }
  expect(render(null, "", true)).not.toContain("Actualiser la trésorerie Qonto");
  expect(render({ state: "not_connected" })).toContain("Connecter Qonto");
  expect(render({ state: "paused" })).toContain("Réactiver Qonto");
});
it("masque entièrement la carte aux employés et pendant une identité inconnue", () => {
  for (const workspace of [null, { canManageBusiness: false, organizationId: "org" }]) {
    mocks.workspace.mockReturnValue({ mode: "supabase", workspace });
    expect(renderToStaticMarkup(<QontoTreasuryCard />)).toBe("");
  }
});
