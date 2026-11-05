import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

const org = "10000000-0000-4000-8000-000000000001";
const user = "20000000-0000-4000-8000-000000000001";
const job = "30000000-0000-4000-8000-000000000001";
const expense = "40000000-0000-4000-8000-000000000001";
const tx = "50000000-0000-4000-8000-000000000001";
const secondTx = "50000000-0000-4000-8000-000000000002";
const period = "60000000-0000-4000-8000-000000000001";
const db = new PGlite();
beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('app.actor',true),'')::uuid$$;
    create function auth.role() returns text language sql as $$select current_setting('app.member_role',true)$$;
    create function public.has_permission(target uuid, permission text) returns boolean language sql as $$select target::text=current_setting('app.org',true) and current_setting('app.member_role',true) in ('partner','admin')$$;
    create function public.is_org_member(target uuid) returns boolean language sql as $$select target::text=current_setting('app.org',true)$$;
    create table organizations(id uuid primary key); create table locations(id uuid primary key); create table profiles(id uuid primary key);
    create table invoices(id uuid primary key,organization_id uuid,total_including_tax_cents bigint,status text,archived_at timestamptz);
    create table interventions(id uuid primary key,organization_id uuid,status text,invoice_id uuid,maintenance_contract_id uuid,archived_at timestamptz);
    create table intervention_items(id uuid primary key default gen_random_uuid(),organization_id uuid,intervention_id uuid,revenue_allocated_cents bigint);
    create table maintenance_billing_periods(id uuid primary key,organization_id uuid,contract_id uuid,amount_cents bigint,status text,paid_at timestamptz,payment_method text);
    create table expenses(id uuid primary key default gen_random_uuid(),organization_id uuid,location_id uuid,expense_date date,family text,category text,supplier text,description text,amount_including_tax_cents bigint,amount_excluding_tax_cents bigint,vat_amount_cents bigint,vat_recoverable boolean,recurrence text,allocated_month date,paid boolean,paid_at timestamptz,created_by uuid,archived_at timestamptz,ends_on date,series_id uuid);
    create table payments(id uuid primary key default gen_random_uuid(),organization_id uuid,location_id uuid,invoice_id uuid,intervention_id uuid,maintenance_contract_id uuid,maintenance_billing_period_id uuid,amount_cents bigint,paid_at timestamptz,method text,reference text,created_by uuid);
  `);
  await db.exec(await readFile("supabase/migrations/202611050025_qonto_banking.sql", "utf8"));
}, 30_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`reset role; set app.org='${org}'; set app.actor='${user}'; set app.member_role='partner';
    truncate organizations,profiles,interventions,intervention_items,invoices,payments,expenses,maintenance_billing_periods cascade;
    insert into organizations values('${org}'); insert into profiles values('${user}');
    insert into qonto_connections(organization_id,remote_organization_id,organization_name,credentials_encrypted,import_since,cursor_at) values('${org}','qonto','Entreprise','encrypted','2026-01-01','2026-01-01');
    insert into interventions values('${job}','${org}','completed',null,null,null);
    insert into intervention_items(organization_id,intervention_id,revenue_allocated_cents) values('${org}','${job}',11000);
    insert into expenses(id,organization_id,expense_date,description,amount_including_tax_cents,recurrence,paid) values('${expense}','${org}','2026-01-15','Assurance',11000,'monthly',true);
    insert into maintenance_billing_periods(id,organization_id,contract_id,amount_cents,status) values('${period}','${org}','${job}',66000,'due');
  `);
});
async function bank(id = tx, side = "credit", amount = 11_000) {
  await db.query(`insert into bank_transactions(id,organization_id,remote_id,remote_organization_id,account_id,account_name,amount_cents,currency,side,status,settled_at,emitted_at,remote_updated_at,operation_type)
    values($1::uuid,$2,$1::text,'qonto','account','Compte',$3,'EUR',$4,'completed','2026-09-16','2026-09-16','2026-09-16','transfer')`, [id, org, amount, side]);
}
async function reconcile(id: string, kind: string, target: string | null = null, month: string | null = null) {
  return db.query("select reconcile_bank_transaction($1,$2,$3,$4)", [id, kind, target, month]);
}
async function count(table: string) { return (await db.query<{ count: number }>(`select count(*)::integer count from ${table}`)).rows[0]!.count; }

describe("rapprochement Qonto exécuté dans PostgreSQL", () => {
  it("crée le paiement une seule fois même si la requête est répétée", async () => {
    await bank(); await reconcile(tx, "intervention", job); await reconcile(tx, "intervention", job);
    expect(await count("payments")).toBe(1);
    await bank(secondTx);
    await expect(reconcile(secondTx, "intervention", job)).rejects.toThrow("dépasse le solde");
  });
  it("rapproche un paiement existant sans augmenter les encaissements", async () => {
    const payment = (await db.query<{ id: string }>(`insert into payments(organization_id,intervention_id,amount_cents,paid_at) values($1,$2,11000,'2026-09-15') returning id`, [org, job])).rows[0]!.id;
    await bank(); await reconcile(tx, "payment", payment);
    expect(await count("payments")).toBe(1);
    await bank(secondTx);
    await expect(reconcile(secondTx, "payment", payment)).rejects.toThrow();
    await expect(db.query("delete from payments where id=$1", [payment])).rejects.toThrow("rapprochement Qonto");
    await reconcile(tx, "undo");
    expect(await count("payments")).toBe(1);
  });
  it("déduit aussi un ancien paiement de prestation lorsqu’une facture est ajoutée ensuite", async () => {
    await db.query("insert into payments(organization_id,intervention_id,amount_cents,paid_at) values($1,$2,11000,'2026-09-15')", [org, job]);
    await db.query("insert into invoices values($1,$2,11000,'issued',null)", [period, org]);
    await db.query("update interventions set invoice_id=$1 where id=$2", [period, job]);
    await bank();
    await expect(reconcile(tx, "invoice", period)).rejects.toThrow("dépasse le solde");
    await expect(db.query("insert into payments(organization_id,invoice_id,amount_cents,paid_at) values($1,$2,11000,'2026-09-16')", [org, period])).rejects.toThrow("dépasse le solde");
    expect(await count("payments")).toBe(1);
  });
  it("règle seulement l’échéance choisie d’une charge récurrente", async () => {
    await bank(tx, "debit"); await reconcile(tx, "expense", expense, "2026-09-01");
    expect(await count("expenses")).toBe(1);
    expect(await count("expense_settlements")).toBe(1);
    await bank(secondTx, "debit");
    await expect(reconcile(secondTx, "expense", expense, "2026-09-01")).rejects.toThrow();
    await expect(db.query("update expenses set amount_including_tax_cents=12000 where id=$1", [expense])).rejects.toThrow("règlement Qonto");
    await reconcile(tx, "undo");
    expect(await count("expense_settlements")).toBe(0);
  });
  it("crée une charge ponctuelle explicitement et garde sa prévision après annulation", async () => {
    await bank(tx, "debit", 3500);
    const input = [tx, JSON.stringify({ description: "Produits de nettoyage", category: "Consommables" })];
    await db.query("select reconcile_bank_transaction($1,'new_expense',null,null,$2)", input);
    await db.query("select reconcile_bank_transaction($1,'new_expense',null,null,$2)", input);
    expect(await count("expenses")).toBe(2);
    expect(await count("expense_settlements")).toBe(1);
    await reconcile(tx, "undo");
    expect(await count("expenses")).toBe(2);
    expect(await count("expense_settlements")).toBe(0);
    expect((await db.query<{ paid: boolean }>("select paid from expenses where description='Produits de nettoyage'")).rows[0]!.paid).toBe(false);
  });
  it("refuse un import après mise en pause de la connexion", async () => {
    await db.query("update qonto_connections set enabled=false where organization_id=$1", [org]);
    await expect(db.query("select ingest_qonto_transactions($1,'[]')", [org])).rejects.toThrow("désactivée");
  });
  it("ne mélange pas une autre entreprise Qonto et ne change pas la connexion pendant l’import", async () => {
    await expect(db.query("update qonto_connections set remote_organization_id='other' where organization_id=$1", [org])).rejects.toThrow("historiques");
    await db.query("update qonto_connections set lease_until=now()+interval '2 minutes' where organization_id=$1", [org]);
    await expect(db.query("update qonto_connections set credentials_encrypted='new' where organization_id=$1", [org])).rejects.toThrow("en cours");
    await db.query("update qonto_connections set credentials_encrypted='',enabled=false where organization_id=$1", [org]); // Déconnecter reste possible.
  });
  it("n’applique pas un tarif expiré ni un mois sans échéance annuelle", async () => {
    await bank(tx, "debit");
    await db.query("update expenses set ends_on='2026-08-31' where id=$1", [expense]);
    await expect(reconcile(tx, "expense", expense, "2026-09-01")).rejects.toThrow("tarif");
    await db.query("update expenses set ends_on=null,recurrence='annual' where id=$1", [expense]);
    await expect(reconcile(tx, "expense", expense, "2026-09-01")).rejects.toThrow("échéance");
  });
  it("refuse un second règlement du même mois sur un nouveau tarif", async () => {
    await db.query("update expenses set series_id=$1 where id=$2", [expense, expense]);
    await bank(tx, "debit"); await reconcile(tx, "expense", expense, "2026-09-01");
    await db.query("update expenses set ends_on='2026-09-21' where id=$1", [expense]);
    await db.query("insert into expenses(id,organization_id,series_id,expense_date,amount_including_tax_cents,recurrence,paid) values($1,$2,$3,'2026-09-22',12000,'monthly',true)", [period, org, expense]);
    await bank(secondTx, "debit", 12000);
    await expect(reconcile(secondTx, "expense", period, "2026-09-01")).rejects.toThrow("déjà réglée");
    expect(await count("expense_settlements")).toBe(1);
  });
  it("encaisse un forfait une fois puis peut annuler cet encaissement", async () => {
    await bank(tx, "credit", 66_000); await reconcile(tx, "maintenance", period);
    expect(await count("payments")).toBe(1);
    expect((await db.query<{ status: string }>("select status from maintenance_billing_periods where id=$1", [period])).rows[0]!.status).toBe("paid");
    await reconcile(tx, "undo");
    expect(await count("payments")).toBe(0);
    expect((await db.query<{ status: string }>("select status from maintenance_billing_periods where id=$1", [period])).rows[0]!.status).toBe("due");
  });
  it("refuse le rapprochement inter-entreprises, employé et non terminé", async () => {
    await bank();
    await db.exec("set app.org='10000000-0000-4000-8000-000000000099'");
    await expect(reconcile(tx, "intervention", job)).rejects.toThrow("réservé");
    await db.exec(`set app.org='${org}'; set app.member_role='employee'`);
    await expect(reconcile(tx, "intervention", job)).rejects.toThrow("réservé");
    await db.exec("set app.member_role='partner'");
    await db.query("update bank_transactions set status='pending' where id=$1", [tx]);
    await expect(reconcile(tx, "intervention", job)).rejects.toThrow("terminées");
  });
  it("ne révèle pas les identifiants chiffrés au rôle connecté", async () => {
    await db.exec("set role authenticated");
    await expect(db.query("select * from qonto_connections")).rejects.toThrow("permission denied");
  });
  it("masque les mouvements et règlements aux employés et interdit les écritures directes", async () => {
    await bank(tx, "debit"); await reconcile(tx, "expense", expense, "2026-09-01");
    await db.exec("set app.member_role='employee'; set role authenticated");
    expect((await db.query("select * from bank_transactions")).rows).toHaveLength(0);
    expect((await db.query("select * from expense_settlements")).rows).toHaveLength(0);
    await expect(db.query("select ingest_qonto_transactions($1,'[]')", [org])).rejects.toThrow("permission denied");
    await expect(db.query("update bank_transactions set reconciliation='matched'")).rejects.toThrow("permission denied");
  });
  it("réimporte sans doublon et signale une transaction annulée après rapprochement", async () => {
    await bank(); await reconcile(tx, "intervention", job);
    const entry = { remote_id: tx, remote_organization_id: "qonto", account_id: "account", account_name: "Compte", amount_cents: 11000, currency: "EUR", side: "credit", status: "reversed", settled_at: "2026-09-16", emitted_at: "2026-09-16", remote_updated_at: "2026-09-17", operation_type: "transfer", label: "Annulation", counterparty: "Client", reference: "" };
    await db.query("select ingest_qonto_transactions($1,$2)", [org, JSON.stringify([entry])]);
    await db.query("select ingest_qonto_transactions($1,$2)", [org, JSON.stringify([entry])]);
    expect(await count("bank_transactions")).toBe(1);
    expect((await db.query<{ reconciliation: string }>("select reconciliation from bank_transactions")).rows[0]!.reconciliation).toBe("review");
    expect(await count("payments")).toBe(1); // Pas de suppression silencieuse d’un historique financier.
  });
});
