import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { financialDateKey } from "@/lib/domain/periods";
import { collectedInterventionRevenue, paidExpenseAmountForMonth } from "@/lib/domain/calculations";

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
    create type public.intervention_status as enum ('to_schedule','scheduled','confirmed','in_progress','completed','cancelled');
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('app.actor',true),'')::uuid$$;
    create function auth.role() returns text language sql as $$select current_setting('app.member_role',true)$$;
    create function public.has_permission(target uuid, permission text) returns boolean language sql as $$select target::text=current_setting('app.org',true) and current_setting('app.member_role',true) in ('partner','admin')$$;
    create function public.is_org_member(target uuid) returns boolean language sql as $$select target::text=current_setting('app.org',true)$$;
    create table organizations(id uuid primary key); create table locations(id uuid primary key); create table profiles(id uuid primary key);
    create table clients(id uuid primary key default gen_random_uuid(),organization_id uuid,archived_at timestamptz,location_id uuid,kind text,first_name text default '',last_name text default '',company text,notes text);
    create table organization_members(id uuid primary key,organization_id uuid,profile_id uuid,active boolean,role text);
    create table maintenance_contracts(id uuid primary key,organization_id uuid,client_id uuid,archived_at timestamptz);
    create table invoices(id uuid primary key,organization_id uuid,total_including_tax_cents bigint,status text,archived_at timestamptz,client_id uuid);
    create table interventions(id uuid primary key default gen_random_uuid(),organization_id uuid,status text,invoice_id uuid,maintenance_contract_id uuid,archived_at timestamptz,location_id uuid,client_id uuid,title text,start_at timestamptz,end_at timestamptz,planned_duration_minutes integer,actual_duration_minutes integer,notes text,created_by uuid);
    create table intervention_items(id uuid primary key default gen_random_uuid(),organization_id uuid,intervention_id uuid,revenue_allocated_cents bigint,label text,quantity numeric);
    create table intervention_workers(id uuid primary key default gen_random_uuid(),organization_id uuid,intervention_id uuid,profile_id uuid,pending_member_id uuid,planned_minutes integer,actual_minutes integer);
    create table maintenance_billing_periods(id uuid primary key,organization_id uuid,contract_id uuid,amount_cents bigint,status text,paid_at timestamptz,payment_method text);
    create table expenses(id uuid primary key default gen_random_uuid(),organization_id uuid,location_id uuid,expense_date date,family text,category text,supplier text,description text,amount_including_tax_cents bigint,amount_excluding_tax_cents bigint,vat_amount_cents bigint,vat_rate_basis_points integer,vat_recoverable boolean,recurrence text,allocated_month date,paid boolean,paid_at timestamptz,created_by uuid,archived_at timestamptz,ends_on date,series_id uuid);
    create table payments(id uuid primary key default gen_random_uuid(),organization_id uuid,location_id uuid,invoice_id uuid,intervention_id uuid,maintenance_contract_id uuid,maintenance_billing_period_id uuid,amount_cents bigint,paid_at timestamptz,method text,reference text,created_by uuid);
  `);
  await db.exec("alter table expenses add column payment_method text, add column updated_at timestamptz, add column replaces_expense_id uuid; create table assets(id uuid primary key,expense_id uuid references expenses(id))");
  await db.exec(await readFile("supabase/migrations/202610220017_exact_expense_revision_date.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/202611050025_qonto_banking.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/202611050026_qonto_historical_groups.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/202611050027_qonto_automatic_drafts.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/202611160028_qonto_direct_integration.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/202611190029_qonto_autonomous_finance.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/202611200030_qonto_monthly_split.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/202611210031_cash_expense_register.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/202611210032_qonto_credit_services.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/202611220033_qonto_monthly_subscriptions.sql", "utf8"));
}, 30_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`reset role; set app.org='${org}'; set app.actor='${user}'; set app.member_role='partner';
    truncate organizations,profiles,interventions,intervention_items,intervention_workers,clients,organization_members,maintenance_contracts,invoices,payments,expenses,maintenance_billing_periods cascade;
    insert into organizations values('${org}'); insert into profiles values('${user}');
    insert into qonto_connections(organization_id,remote_organization_id,organization_name,credentials_encrypted,import_since,cursor_at) values('${org}','qonto','Entreprise','encrypted','2026-01-01','2026-01-01');
    insert into clients(id,organization_id) values('${user}','${org}');
    insert into interventions(id,organization_id,status) values('${job}','${org}','completed');
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

describe("mensualités détectées : registre, prévision et rapprochement (033)", () => {
  const refresh = () => db.query("select refresh_qonto_subscriptions($1)", [org]);
  const postDebit = async (id: string, action: object = { action: "expense", category: "Logiciel" }) =>
    (await db.query<{result: {kind?: string; skipped?: boolean}}>("select post_qonto_transaction(id,amount_cents,settled_at,$2) result from bank_transactions where id=$1", [id, JSON.stringify(action)])).rows[0]!.result;
  const rules = () => db.query<{id:string; qonto_recurrence:string; ends_on:string | null; expense_date:string}>("select id,qonto_recurrence,ends_on::text,expense_date::text from expenses where qonto_recurrence is not null and archived_at is null");
  let first = "", second = "";
  beforeEach(async () => {
    await db.exec("delete from expenses; update qonto_connections set posting_from='2026-06-24'");
    const dates = (await db.query<{d1:string;d2:string}>(`with d as (select ((now() at time zone 'Europe/Paris')::date - 1) as yesterday)
      select (yesterday-interval '1 month')::date::text d1, yesterday::text d2 from d`)).rows[0]!;
    first=dates.d1; second=dates.d2;
  });
  async function debit(id: string, day: string, label = "Prélèvement", operation = "direct_debit", amount = 2900, account = "courant", party = "Logiciel Atlas") {
    await bank(id,"debit",amount);
    await db.query(`update bank_transactions set settled_at=$2::date + time '12:00', emitted_at=$2::date + time '12:00',
      account_id=$6,counterparty=$7,label=$3,operation_type=$4,amount_cents=$5 where id=$1`,[id,day,label,operation,amount,account,party]);
  }
  it("prévoit dès le premier prélèvement, conserve la preuve et rapproche le débit variable sans doubler ni le mois ni le montant", async () => {
    await debit(tx, first); expect((await postDebit(tx)).kind).toBe("expense");
    const proof = (await db.query("select id,expense_id,amount_cents,paid_at from expense_settlements")).rows[0];
    await refresh(); await refresh();
    expect((await db.query("select id,expense_id,amount_cents,paid_at from expense_settlements")).rows).toEqual([proof]);
    const learned = (await rules()).rows[0]!;
    expect(learned).toMatchObject({qonto_recurrence:"estimated",expense_date:first});
    expect(learned.ends_on?.slice(0,7)).toBe(second.slice(0,7));
    await debit(secondTx, second, "Prélèvement tarif révisé", "direct_debit", 3190);
    expect((await postDebit(secondTx)).kind).toBe("matched");
    expect((await postDebit(secondTx)).skipped).toBe(true);
    await refresh();
    expect((await rules()).rows).toEqual([{...learned,qonto_recurrence:"confirmed",ends_on:null}]);
    expect(await count("expenses")).toBe(1);
    expect((await db.query("select expense_id,sum(amount_cents)::int total,count(distinct period_month)::int months from expense_settlements group by expense_id")).rows)
      .toEqual([{expense_id:learned.id,total:6090,months:2}]);
  });
  it("reconnaît un libellé mensuel sur une seule carte et retire sa prévision si la banque annule le débit", async () => {
    await debit(tx,second,"Abonnement mensuel Atlas","card"); await postDebit(tx); await refresh();
    expect((await rules()).rows[0]).toMatchObject({qonto_recurrence:"confirmed",ends_on:null});
    await db.query("update bank_transactions set status='reversed',remote_updated_at=now() where id=$1",[tx]);
    await db.query("select repair_qonto_postings($1)",[org]); await refresh();
    expect((await rules()).rows).toHaveLength(0); expect(await count("expense_settlements")).toBe(0);
  });
  it("reconnaît deux débits carte au même rythme, même déjà comptabilisés, sans refaire leurs paiements", async () => {
    await debit(tx,first,"Atlas Pro","card"); await postDebit(tx); await refresh();
    expect((await rules()).rows).toHaveLength(0);
    await debit(secondTx,second,"Atlas Pro","card"); await postDebit(secondTx);
    const before = (await db.query("select id,expense_id,paid_at,amount_cents from expense_settlements order by id")).rows;
    await refresh(); await refresh();
    expect((await rules()).rows).toMatchObject([{qonto_recurrence:"confirmed",ends_on:null}]);
    expect((await db.query("select count(distinct series_id)::int n from expenses")).rows).toEqual([{n:1}]);
    expect((await db.query("select id,expense_id,paid_at,amount_cents from expense_settlements order by id")).rows).toEqual(before);
  });
  it("ne transforme pas deux paiements du même mois, ni un achat isolé, en abonnement", async () => {
    await debit(tx,second,"Abonnement","card"); await debit(secondTx,second,"Abonnement","card");
    await postDebit(tx); await postDebit(secondTx); await refresh();
    expect((await rules()).rows).toHaveLength(0); expect(await count("expense_settlements")).toBe(2);
  });
  it.each(["Abonnement annuel","Prélèvement trimestriel","Paiement unique","Remboursement mensuel","Forfait hebdomadaire"])("ne projette pas %s chaque mois", async label => {
    await debit(tx,second,label); await postDebit(tx); await refresh(); expect((await rules()).rows).toHaveLength(0);
  });
  it("ne crée pas une nouvelle prévision si un abonnement du fournisseur est déjà au registre", async () => {
    await debit(tx,second,"Abonnement mensuel","card"); await postDebit(tx);
    const proof=(await db.query("select id,paid_at,amount_cents from expense_settlements")).rows;
    await db.query("insert into expenses(id,organization_id,series_id,supplier,description,expense_date,recurrence,amount_including_tax_cents,paid) values($1,$2,$1,'Logiciel Atlas','Prévision manuelle',$3,'monthly',2900,false)",[expense,org,second]);
    await refresh(); await refresh(); expect((await rules()).rows).toHaveLength(0);
    expect((await db.query("select id,paid_at,amount_cents from expense_settlements where expense_id=$1",[expense])).rows).toEqual(proof);
    expect((await db.query("select id from expenses where archived_at is null")).rows).toEqual([{id:expense}]);
    expect((await db.query("select expense_id,created_entry from bank_transactions where id=$1",[tx])).rows).toEqual([{expense_id:expense,created_entry:false}]);
  });
  it("retrouve le même abonnement si le deuxième paiement arrive dans un import tardif après retrait de l’estimation", async () => {
    const old=(await db.query<{seed:string;due:string}>("select ($1::date-interval '2 months')::date::text as seed, ($1::date-interval '1 month')::date::text as due",[second])).rows[0]!;
    await debit(tx,old.seed);
    // A previously learned first payment, now long enough ago to have missed its next due date.
    await db.query(`insert into expenses(id,organization_id,series_id,supplier,description,expense_date,recurrence,amount_including_tax_cents,paid,
      qonto_recurrence,qonto_recurrence_key,ends_on) select $1,$2,$1,counterparty,label,$3,'monthly',amount_cents,false,'estimated',
      qonto_subscription_key(bank_transactions),(date_trunc('month',$3::date)+interval '2 months - 1 day')::date from bank_transactions where id=$4`,[expense,org,old.seed,tx]);
    await db.query("insert into expense_settlements(organization_id,expense_id,bank_transaction_id,paid_at,period_month,amount_cents) select $1,$2,id,settled_at,date_trunc('month',$3::date)::date,amount_cents from bank_transactions where id=$4",[org,expense,old.seed,tx]);
    await db.query("update bank_transactions set expense_id=$1,expense_month=date_trunc('month',$2::date)::date,reconciliation='matched',posting_kind='matched',automated_at=now() where id=$3",[expense,old.seed,tx]);
    await refresh(); await refresh();
    expect((await rules()).rows).toMatchObject([{id:expense,qonto_recurrence:"expired"}]);
    expect((await rules()).rows[0]!.ends_on?.slice(0,7)).toBe(old.seed.slice(0,7));
    await debit(secondTx,old.due); expect((await postDebit(secondTx)).kind).toBe("matched"); await refresh();
    expect((await rules()).rows).toMatchObject([{id:expense,qonto_recurrence:"confirmed",ends_on:null}]);
    expect(await count("expenses")).toBe(1); expect(await count("expense_settlements")).toBe(2);
  });
  it("ne crée pas une estimation à partir d’un montant commun sans fournisseur identifiable", async () => {
    await debit(tx,second,"Prélèvement SEPA","direct_debit",2900,"courant","");
    await postDebit(tx); await refresh(); expect((await rules()).rows).toHaveLength(0);
  });
  it("retire la prévision, pas l’argent réellement payé, si le libellé est corrigé en annuel", async () => {
    await debit(tx,second,"Forfait mensuel"); await postDebit(tx); await refresh();
    await db.query("update bank_transactions set label='Forfait annuel', remote_updated_at=now() where id=$1",[tx]);
    await refresh();
    expect((await rules()).rows).toMatchObject([{qonto_recurrence:"expired"}]);
    expect((await db.query("select amount_cents::int paid from expense_settlements")).rows).toEqual([{paid:2900}]);
  });
  it("ne rapproche pas par le seul montant sur un autre compte, ne réécrit pas l’historique protégé", async () => {
    await debit(tx,first,"Forfait mensuel Atlas","card"); await postDebit(tx); await refresh();
    const rule=(await rules()).rows[0]!;
    await debit(secondTx,second,"Forfait mensuel Atlas","card",2900,"autre-compte");
    expect((await postDebit(secondTx,{action:"match",kind:"expense",id:rule.id,month:second.slice(0,7)+"-01"})).kind).toBe("bank_only");
    expect(await count("expense_settlements")).toBe(1);
    await db.exec("set role authenticated");
    await expect(refresh()).rejects.toThrow("permission denied");
  });
});
async function group(ids = [tx, secondTx], kind = "expense", target = expense, month: string | null = "2026-09-01") {
  return db.query<{ reconcile_bank_group: string }>("select reconcile_bank_group($1,$2,$3,$4,'Saisie historique regroupée')", [ids, kind, target, month]);
}
async function draftFor(bankId = tx) {
  return (await db.query<{ id: string; updated_at: string; payload: Record<string, unknown> }>("select id,updated_at::text,payload from bank_transaction_drafts where bank_transaction_id=$1", [bankId])).rows[0]!;
}
async function prepareDraft(side = "credit", amount = 11000) {
  await db.query("update qonto_connections set auto_intake_from='2026-09-01' where organization_id=$1", [org]);
  await bank(tx, side, amount);
  await db.query("select prepare_qonto_drafts($1)", [org]);
  return draftFor();
}
async function manageDraft(action: string, details: Record<string, unknown> = {}) {
  const draft = await draftFor();
  return db.query<{ manage_bank_draft: { interventionId?: string } }>("select manage_bank_draft($1,$2,$3)", [draft.id, action, JSON.stringify({ expectedUpdatedAt: draft.updated_at, ...details })]);
}
function validation(payload: Record<string, unknown>) { return { targetKind: "new", expectedAmount: 11000, expectedSettledAt: "2026-09-16T00:00:00Z", payload }; }

describe("virement groupé et deux échéances mensuelles", () => {
  const insurance = "40000000-0000-4000-8000-000000000002";
  const thirdTx = "50000000-0000-4000-8000-000000000003";
  async function setup() {
    await db.query("update expenses set series_id=id,expense_date='2025-01-01',family='fixed',description='Mensualité fourgon',amount_including_tax_cents=36071 where id=$1",[expense]);
    await db.query("insert into expenses(id,series_id,organization_id,expense_date,family,description,recurrence,amount_including_tax_cents,paid) values($1,$1,$2,'2025-01-04','fixed','Assurance véhicule','monthly',12215,true)",[insurance,org]);
  }
  async function transfer(id: string, date: string, amount: number, ignored = false) {
    await bank(id,"debit",amount);
    await db.query("update bank_transactions set label='Destinataire témoin',reference='Mensualités groupées',settled_at=$2,reconciliation=$3 where id=$1",
      [id,date,ignored ? "ignored" : "unmatched"]);
  }
  const enable = async () => (await db.query<{rule:string}>("select enable_qonto_monthly_split($1,$2,$3,$4) rule",[org,tx,expense,insurance])).rows[0]!.rule;
  const sync = () => db.query("select repair_qonto_postings($1)",[org]);
  const amounts = async (id=tx) => (await db.query("select amount_cents::int as amount,cash_delta_cents::int as delta from expense_settlements where bank_transaction_id=$1 order by split_leg",[id])).rows;
  it("rejoue le témoin ignoré, rattrape l’historique certain et traite les tarifs futurs sans troisième charge", async () => {
    await setup(); await transfer(tx,"2025-11-03",48500,true); await transfer(secondTx,"2025-10-02",48286);
    await enable(); await enable(); await sync(); await sync();
    expect(await amounts()).toEqual([{amount:36071,delta:214},{amount:12215,delta:0}]);
    expect(await amounts(secondTx)).toEqual([{amount:36071,delta:0},{amount:12215,delta:0}]);
    await db.query("update expenses set ends_on='2025-11-30' where id=$1",[insurance]);
    await db.query("insert into expenses(organization_id,series_id,expense_date,family,description,recurrence,amount_including_tax_cents) values($1,$2,'2025-12-04','fixed','Nouveau tarif','monthly',13215)",[org,insurance]);
    await transfer(thirdTx,"2025-12-03",49500); await sync();
    expect(await amounts(thirdTx)).toEqual([{amount:36071,delta:214},{amount:13215,delta:0}]);
    expect(await count("expenses")).toBe(3); // only two initial schedules and the revised tariff
    expect(await count("expense_settlements")).toBe(6);
  });
  it("ne traite que les montants historiques expressément confirmés et conserve un écart signé une seule fois", async () => {
    await setup(); await transfer(tx,"2025-11-03",48500,true); await transfer(secondTx,"2025-09-03",36000,true);
    const rule=await enable(); await sync(); expect(await amounts(secondTx)).toEqual([]);
    const confirm=(amount:number) => db.query("select confirm_qonto_split_history($1,$2,$3,'2025-09-03',$4,36071,12215)",[org,rule,secondTx,amount]);
    await expect(confirm(36001)).rejects.toThrow("confirmés");
    await confirm(36000); await confirm(36000);
    await sync(); await sync();
    expect(await amounts(secondTx)).toEqual([{amount:36071,delta:-12286},{amount:12215,delta:0}]);
    await db.query("update bank_transactions set amount_cents=36001,remote_updated_at=now() where id=$1",[secondTx]);
    await sync(); expect(await amounts(secondTx)).toEqual([]);
    expect((await db.query("select reconciliation from bank_transactions where id=$1",[secondTx])).rows[0]).toEqual({reconciliation:"ignored"});
    expect(await amounts()).toHaveLength(2);
  });
  it("ne convertit ni un autre bénéficiaire ni deux virements concurrents ni une écriture existante", async () => {
    await setup(); await transfer(tx,"2025-11-03",48500,true); await enable();
    await transfer(secondTx,"2025-12-02",48500); await db.query("update bank_transactions set label='Autre bénéficiaire' where id=$1",[secondTx]);
    await sync(); expect(await amounts(secondTx)).toEqual([]);
    await db.query("update bank_transactions set label='Destinataire témoin' where id=$1",[secondTx]);
    await transfer(thirdTx,"2025-12-04",48500); await sync();
    expect(await amounts(secondTx)).toEqual([]); expect(await amounts(thirdTx)).toEqual([]);
    const call=()=>db.query<{v:{kind:string}}>("select post_qonto_transaction($1,48500,'2025-12-02',$2) v",[secondTx,JSON.stringify({action:"expense",category:"Autre"})]);
    expect((await call()).rows[0]?.v.kind).toBe("bank_only");
    await db.query("update bank_transactions set status='reversed' where id=$1",[thirdTx]);
    await db.query("insert into expenses(organization_id,expense_date,recurrence,amount_including_tax_cents,paid) values($1,'2025-12-02','one_off',48500,true)",[org]);
    await sync(); expect((await call()).rows[0]?.v.kind).toBe("bank_only"); expect(await count("expense_settlements")).toBe(2);
  });
  it("rouvre les deux échéances après annulation et refuse une troisième part ou un accès utilisateur direct", async () => {
    await setup(); await transfer(tx,"2025-11-03",48500,true); await enable();
    await expect(db.query("insert into expense_settlements(organization_id,expense_id,period_month,paid_at,amount_cents,bank_transaction_id) values($1,$2,'2025-12-01',now(),100,$3)",[org,expense,tx])).rejects.toThrow("incompatible");
    await db.query("update bank_transactions set status='reversed',remote_updated_at=now() where id=$1",[tx]); await sync(); await sync();
    expect(await amounts()).toEqual([]); expect(await count("expenses")).toBe(2);
    expect((await db.query("select has_function_privilege('authenticated','enable_qonto_monthly_split(uuid,uuid,uuid,uuid)','execute') as manage,has_function_privilege('authenticated','apply_qonto_split_history(uuid)','execute') as post,has_function_privilege('service_role','post_qonto_single_transaction(uuid,bigint,timestamptz,jsonb)','execute') as bypass")).rows[0]).toEqual({manage:false,post:false,bypass:false});
  });
});

describe("prestations depuis les crédits (migration 032)", () => {
  const register = async (decision: object, actor: string | null = null, organization = org, id = tx) =>
    (await db.query<{v:{kind?:string;skipped?:boolean;interventionId?:string}}>("select register_qonto_service_credit($1,$2,11000,'2026-09-16','2026-09-16',$3,$4) v",[organization,id,JSON.stringify(decision),actor])).rows[0]!.v;
  const document = {action:"service",clientName:"",unidentified:true};
  const partner = () => db.query("insert into organization_members(id,profile_id,organization_id,active,role) values($1,$1,$2,true,'partner')",[user,org]);
  it("importe une pièce ajoutée plus tard, distingue inconnu et zéro, ignore les versions anciennes", async () => {
    const entry = {remote_id:"receipt",remote_organization_id:"qonto",account_id:"account",account_name:"Compte",label:"Vente",counterparty:"",reference:"",amount_cents:11000,currency:"EUR",side:"credit",status:"completed",settled_at:"2026-09-16",emitted_at:"2026-09-16",remote_updated_at:"2026-09-16",operation_type:"income"};
    const ingest = (overrides: object) => db.query("select ingest_qonto_transactions($1,$2)",[org,JSON.stringify([{...entry,...overrides}])]);
    const stored = async () => (await db.query("select attachment_count from bank_transactions where remote_id='receipt'")).rows;
    await ingest({}); expect(await stored()).toEqual([{attachment_count:null}]);
    await ingest({attachment_count:0}); expect(await stored()).toEqual([{attachment_count:0}]);
    await ingest({remote_updated_at:"2026-09-19",attachment_count:2});
    await ingest({attachment_count:0}); await ingest({remote_updated_at:"2026-09-19"});
    expect(await stored()).toEqual([{attachment_count:2}]);
    await ingest({remote_updated_at:"2026-09-20",attachment_count:0}); expect(await stored()).toEqual([{attachment_count:0}]);
    expect(await count("bank_transactions")).toBe(1);
  });
  it("crée une seule prestation terminée et un seul règlement, même après un clic et une resynchronisation", async () => {
    await bank(); await db.exec("update qonto_connections set posting_from='2026-09-01'; update bank_transactions set attachment_count=2,operation_type='check'");
    await partner();
    const first = await register(document); expect(first.kind).toBe("service"); expect(first.interventionId).toBeTruthy();
    expect(await register(document,user)).toEqual({kind:"existing",interventionId:first.interventionId});
    expect(await register(document)).toEqual({kind:"existing",interventionId:first.interventionId});
    expect((await db.query("select status,planned_duration_minutes from interventions where id=$1",[first.interventionId])).rows).toEqual([{status:"completed",planned_duration_minutes:0}]);
    expect((await db.query("select amount_cents::int,paid_at='2026-09-16' as bank_date,method from payments")).rows).toEqual([{amount_cents:11000,bank_date:true,method:"Chèque Qonto"}]);
    await bank(secondTx); await db.exec("update bank_transactions set attachment_count=1");
    await register(document,null,org,secondTx);
    expect((await db.query("select count(*)::int n from clients where qonto_unidentified")).rows).toEqual([{n:1}]);
    expect(await count("payments")).toBe(2);
    await db.query("update bank_transactions set status='reversed',remote_updated_at=now() where id=$1",[tx]);
    await db.query("select repair_qonto_postings($1)",[org]); expect(await count("payments")).toBe(1);
  });
  it("autorise une déclaration explicite sans pièce dans l’historique, mais jamais la création automatique", async () => {
    await bank(); await partner();
    const sale={action:"service",clientId:user,title:"Entretien cuir"};
    expect(await register(sale)).toEqual({skipped:true});
    await db.exec("update bank_transactions set attachment_count=1");
    expect(await register(sale)).toEqual({skipped:true});
    await db.exec("update bank_transactions set attachment_count=0");
    const result=await register(sale,user);
    expect(result.kind).toBe("service");
    expect((await db.query("select title,client_id from interventions where id=$1",[result.interventionId])).rows).toEqual([{title:"Entretien cuir",client_id:user}]);
    expect((await db.query("select service_declared_by from bank_transactions")).rows).toEqual([{service_declared_by:user}]);
  });
  it("rattache le paiement existant et refuse les crédits exclus, périmés, inter-entreprises ou provenant d’un employé", async () => {
    await bank(); await partner();
    await db.query("insert into payments(id,organization_id,intervention_id,paid_at,amount_cents) values($1,$2,$3,'2026-09-16',11000)",[user,org,job]);
    await expect(register(document,user,"10000000-0000-4000-8000-000000000009")).rejects.toThrow();
    await db.exec("update organization_members set role='employee'"); await expect(register(document,user)).rejects.toThrow("associés");
    await db.exec("update organization_members set role='partner'; update bank_transactions set side='debit'");
    expect(await register(document,user)).toEqual({skipped:true});
    await db.exec("update bank_transactions set side='credit', label='Virement interne'");
    expect(await register(document,user)).toEqual({skipped:true});
    await db.exec("update bank_transactions set label='',status='pending'");
    expect(await register(document,user)).toEqual({skipped:true});
    await db.exec("update bank_transactions set status='completed',remote_updated_at='2026-09-17'");
    await expect(register(document,user)).rejects.toThrow("changé");
    await db.exec("update bank_transactions set remote_updated_at='2026-09-16'");
    expect(await register({action:"match",kind:"payment",id:user},user)).toEqual({kind:"matched",interventionId:job});
    expect(await count("payments")).toBe(1);
    expect((await db.query("select has_function_privilege('authenticated','register_qonto_service_credit(uuid,uuid,bigint,timestamptz,timestamptz,jsonb,uuid)','execute') allowed")).rows[0]).toEqual({allowed:false});
  });
});

describe("charges en espèces (migration 031)", () => {
  it("refuse le lien Qonto dans les deux sens, même à montant et fournisseur identiques", async () => {
    await bank(tx,"debit");
    await db.query("update expenses set recurrence='one_off',expense_date='2026-09-16',payment_method='Espèces' where id=$1",[expense]);
    await expect(reconcile(tx,"expense",expense,"2026-09-01")).rejects.toThrow("espèces");
    expect(await count("expense_settlements")).toBe(0);
    await db.query("update expenses set payment_method=null where id=$1",[expense]);
    await reconcile(tx,"expense",expense,"2026-09-01");
    await expect(db.query("update expenses set payment_method='liquide' where id=$1",[expense])).rejects.toThrow("déjà rattaché");
  });
  it("conserve le moyen déclaré et le jour réel si un tarif devient une charge ponctuelle", async () => {
    const revision = {recurrence:"one_off",family:"fixed",category:"Transport",supplier:"Garage",description:"Dernière échéance",amountIncludingTax:11000,vatRateBasisPoints:0,paid:true,paymentMethod:"Espèces",paidOn:"2026-10-02"};
    await db.query("select revise_recurring_expense($1,'2026-09-30',$2::jsonb)",[expense,JSON.stringify(revision)]);
    expect((await db.query("select payment_method,(paid_at at time zone 'Europe/Paris')::date::text as paid_on from expenses where replaces_expense_id=$1",[expense])).rows).toEqual([{payment_method:"Espèces",paid_on:"2026-10-02"}]);
    expect((await db.query("select has_function_privilege('authenticated','revise_recurring_expense_version(uuid,date,jsonb)','execute') as bypass")).rows[0]).toEqual({bypass:false});
  });
});

describe("journal financier autonome (migration 029)", () => {
  async function active() {
    await db.exec("set app.member_role='service_role'; update qonto_connections set posting_from='2026-09-01', auto_intake=false, auto_create=false, auto_reconcile=false");
  }
  const post = async (id: string, decision: Record<string, unknown>, amount = 11000) =>
    (await db.query<{ result: { kind?: string; skipped?: boolean } }>("select post_qonto_transaction($1,$2,'2026-09-16',$3) result", [id,amount,JSON.stringify(decision)])).rows[0]!.result;
  it("intègre deux achats identiques sans confondre un second débit avec le rejeu du premier", async () => {
    await active(); await bank(tx, "debit"); await bank(secondTx, "debit");
    await db.exec("update bank_transactions set counterparty='Qonto',label='Abonnement Qonto'");
    const decision = { action: "expense", category: "Frais bancaires" };
    expect(await post(tx,decision)).toEqual({kind:"expense"});
    expect(await post(tx,decision)).toEqual({skipped:true});
    expect(await post(secondTx,decision)).toEqual({kind:"expense"});
    expect(await count("expense_settlements")).toBe(2);
    expect((await db.query("select id from expenses where category='Frais bancaires' and not vat_recoverable")).rows).toHaveLength(2);
    expect(await count("bank_transaction_drafts")).toBe(0);
  });
  it("règle le montant variable d’un seul mois, sans modifier le tarif ni les autres mois", async () => {
    await active(); await bank(tx, "debit", 12500);
    await db.exec("update bank_transactions set counterparty='Assureur',operation_type='direct_debit'; update expenses set supplier='Assureur'");
    const decision = {action:"match",kind:"expense",id:expense,month:"2026-09-01",variableDebit:true};
    expect(await post(tx,decision,12500)).toEqual({kind:"matched"});
    expect((await db.query("select period_month::text as month,amount_cents::int as amount from expense_settlements")).rows).toEqual([{month:"2026-09-01",amount:12500}]);
    expect((await db.query("select amount_including_tax_cents::int as amount from expenses")).rows).toEqual([{amount:11000}]);
    await bank(secondTx,"debit",9500);
    await db.query("update bank_transactions set counterparty='Autre',operation_type='direct_debit' where id=$1",[secondTx]);
    await expect(post(secondTx,decision,9500)).rejects.toThrow("incompatible");
    expect(await count("expense_settlements")).toBe(1);
  });
  it("reprend un brouillon intact, puis corrige une annulation sans intervention ni double encaissement", async () => {
    await active();
    await db.exec("update qonto_connections set auto_intake=true");
    await prepareDraft();
    await db.exec("update qonto_connections set posting_from='2026-10-01'");
    await db.exec("update bank_transactions set counterparty='Camille Bernard'");
    const sale = {action:"service",clientName:"Camille Bernard"};
    expect(await post(tx,sale)).toEqual({kind:"service"});
    await db.exec("update qonto_connections set posting_from='2026-09-01'");
    await bank(secondTx);
    await db.query("update bank_transactions set counterparty='Camille Bernard' where id=$1",[secondTx]);
    expect(await post(secondTx,sale)).toEqual({kind:"service"});
    expect(await count("payments")).toBe(2);
    await db.query("update bank_transactions set status='reversed',remote_updated_at=now() where id=$1",[tx]);
    await db.query("select repair_qonto_postings($1)",[org]);
    await db.query("select repair_qonto_postings($1)",[org]);
    expect(await count("payments")).toBe(1);
    expect((await db.query("select id from interventions where status='cancelled'")).rows).toHaveLength(1);
    expect(await post(tx,sale)).toEqual({skipped:true});
    await db.query("update bank_transactions set status='completed',remote_updated_at=now() where id=$1",[tx]);
    expect(await post(tx,sale)).toEqual({kind:"service"});
    expect(await count("payments")).toBe(2);
  });
  it("ne recrée ni l’historique, ni un paiement préexistant après une correction bancaire", async () => {
    await active(); await bank();
    await db.exec("update qonto_connections set posting_from='2026-10-01'");
    expect(await post(tx,{action:"expense"})).toEqual({skipped:true});
    await db.query("insert into payments(id,organization_id,intervention_id,amount_cents,paid_at) values($1,$2,$3,11000,'2026-09-16')",[period,org,job]);
    expect(await post(tx,{action:"match",kind:"payment",id:period})).toEqual({kind:"matched"});
    await db.exec("update bank_transactions set amount_cents=12000,remote_updated_at=now()");
    await db.query("select repair_qonto_postings($1)",[org]);
    expect((await db.query("select amount_cents::int as amount from payments")).rows).toEqual([{amount:11000}]);
  });
  it("réserve les mutations automatiques au serveur et respecte une pause", async () => {
    await active(); await bank(); await db.exec("update qonto_connections set enabled=false");
    expect(await post(tx,{action:"defer",reason:"Identité absente"})).toEqual({skipped:true});
    await db.exec("set role authenticated");
    await expect(post(tx,{action:"expense"})).rejects.toThrow("permission denied");
    await expect(db.query("select repair_qonto_postings($1)",[org])).rejects.toThrow("permission denied");
  });
});

async function automate(decision: Record<string, unknown>, bankId = tx) {
  await db.exec("set app.member_role='service_role'");
  return db.query<{ result: { kind?: string; skipped?: boolean; review?: boolean; interventionId?: string } }>(
    "select automate_qonto_transaction($1,11000,'2026-09-16', $2) result", [bankId, JSON.stringify(decision)]);
}
async function automaticReady(side = "credit") {
  await prepareDraft(side);
  await db.query("update qonto_connections set auto_create_from='2026-09-01' where organization_id=$1", [org]);
  await db.query("update bank_transactions set counterparty='Camille Bernard',label='Nettoyage voiture' where id=$1", [tx]);
}

describe("création Qonto sans validation humaine dans PostgreSQL", () => {
  it("crée le client, une prestation terminée à la date bancaire et son paiement une seule fois", async () => {
    await automaticReady();
    const decision = { action: "service", clientName: "Camille Bernard" };
    expect((await automate(decision)).rows[0]!.result.kind).toBe("service");
    expect((await automate(decision)).rows[0]!.result.skipped).toBe(true);
    expect(await count("clients")).toBe(2);
    expect(await count("interventions")).toBe(2);
    expect(await count("payments")).toBe(1);
    expect((await db.query("select status,(start_at at time zone 'Europe/Paris')::date::text date,planned_duration_minutes,actual_duration_minutes from interventions where client_id is not null")).rows[0]).toMatchObject({ status: "completed", date: "2026-09-16", planned_duration_minutes: 0, actual_duration_minutes: null });
    expect((await db.query("select amount_cents::integer amount,paid_at::date::text date from payments")).rows[0]).toEqual({ amount: 11000, date: "2026-09-16" });
    const jobs = (await db.query<{ id: string }>("select id from interventions")).rows;
    const payments = (await db.query<{ interventionId: string; amount: number }>('select intervention_id as "interventionId",amount_cents::integer amount from payments')).rows;
    expect(collectedInterventionRevenue(jobs, payments)).toBe(11000);
    expect((await draftFor()).payload.title).toBeTruthy();
    expect((await db.query("select status from bank_transaction_drafts")).rows[0]).toEqual({ status: "processed" });
    expect((await db.query<{ automated_at: string }>("select automated_at from bank_transactions")).rows[0]!.automated_at).toBeTruthy();
  });
  it("réutilise le client malgré accents et ordre nom/prénom", async () => {
    await automaticReady();
    await db.query("update clients set first_name='Camille',last_name='Bérnard' where id=$1", [user]);
    await db.query("update bank_transactions set counterparty='BERNARD CAMILLE' where id=$1", [tx]);
    expect((await automate({ action: "service", clientName: "BERNARD CAMILLE" })).rows[0]!.result.kind).toBe("service");
    expect(await count("clients")).toBe(1);
  });
  it("crée une charge réglée sans inventer de TVA et sans doublon au rejeu", async () => {
    await automaticReady("debit");
    expect((await automate({ action: "expense" })).rows[0]!.result.kind).toBe("expense");
    await automate({ action: "expense" });
    expect(await count("expenses")).toBe(2);
    expect(await count("expense_settlements")).toBe(1);
    expect((await db.query("select amount_including_tax_cents::integer amount,vat_amount_cents::integer vat,vat_recoverable,recurrence from expenses where description='Nettoyage voiture'")).rows[0]).toMatchObject({ amount: 11000, vat: 0, vat_recoverable: false, recurrence: "one_off" });
  });
  it("rapproche un entretien payé d’avance sans créer une visite facturée en plus", async () => {
    await automaticReady();
    await db.query("update maintenance_billing_periods set amount_cents=11000 where id=$1", [period]);
    await automate({ action: "match", kind: "maintenance", id: period });
    expect(await count("interventions")).toBe(1);
    expect(await count("payments")).toBe(1);
    expect((await db.query("select status from maintenance_billing_periods")).rows[0]).toEqual({ status: "paid" });
  });
  it("rapproche une mensualité sans recréer sa règle de charge", async () => {
    await automaticReady("debit");
    await automate({ action: "match", kind: "expense", id: expense, month: "2026-09-01" });
    expect(await count("expenses")).toBe(1);
    expect(await count("expense_settlements")).toBe(1);
  });
  it("laisse en exception un abonnement au montant différent ou un dossier client déjà ouvert", async () => {
    await automaticReady("debit");
    await db.query("update expenses set supplier='Camille Bernard',amount_including_tax_cents=10000 where id=$1", [expense]);
    expect((await automate({ action: "expense" })).rows[0]!.result.review).toBe(true);
    expect(await count("expenses")).toBe(1);
    await db.query("update bank_transactions set side='credit' where id=$1", [tx]);
    await db.query("update interventions set client_id=$1,status='scheduled' where id=$2", [user, job]);
    expect((await automate({ action: "service", clientId: user, clientName: "Camille Bernard" })).rows[0]!.result.review).toBe(true);
    expect(await count("payments")).toBe(0);
  });
  it("ne reprend ni l’historique ni un brouillon modifié ou supprimé", async () => {
    await automaticReady();
    const decision = { action: "service", clientName: "Camille Bernard" };
    await db.query("update qonto_connections set auto_create_from='2026-10-01' where organization_id=$1", [org]);
    expect((await automate(decision)).rows[0]!.result.skipped).toBe(true);
    await db.query("update qonto_connections set auto_create_from='2026-09-01' where organization_id=$1", [org]);
    await db.query("update bank_transaction_drafts set updated_at=created_at+interval '1 second'");
    expect((await automate(decision)).rows[0]!.result.skipped).toBe(true);
    await db.query("update bank_transaction_drafts set updated_at=created_at,status='dismissed'");
    expect((await automate(decision)).rows[0]!.result.skipped).toBe(true);
    expect(await count("payments")).toBe(0);
  });
  it("respecte les pauses et refuse les montants devenus obsolètes", async () => {
    await automaticReady();
    const decision = { action: "service", clientName: "Camille Bernard" };
    for (const field of ["enabled", "auto_intake", "auto_create"]) {
      await db.exec(`update qonto_connections set ${field}=false`);
      expect((await automate(decision)).rows[0]!.result.skipped).toBe(true);
      await db.exec(`update qonto_connections set ${field}=true`);
    }
    await db.query("update bank_transactions set amount_cents=12000 where id=$1", [tx]);
    await expect(automate(decision)).rejects.toThrow("bancaire a changé");
    expect(await count("payments")).toBe(0);
  });
  it("une annulation manuelle n’est pas réintégrée automatiquement", async () => {
    await automaticReady();
    await automate({ action: "service", clientName: "Camille Bernard" });
    await reconcile(tx, "undo");
    expect((await automate({ action: "service", clientName: "Camille Bernard" })).rows[0]!.result.skipped).toBe(true);
    expect(await count("payments")).toBe(0);
    expect(await count("interventions")).toBe(2);
  });
  it("exclut les virements internes et respecte leur annulation, même sans brouillon", async () => {
    await automaticReady();
    await db.exec("delete from bank_transaction_drafts; update bank_transactions set operation_type='internal_transfer'");
    expect((await automate({ action: "ignore" })).rows[0]!.result.kind).toBe("ignored");
    await reconcile(tx, "undo");
    expect((await automate({ action: "ignore" })).rows[0]!.result.skipped).toBe(true);
    expect(await count("payments")).toBe(0);
  });
  it("interdit l’appel direct depuis le navigateur et les cibles d’une autre entreprise", async () => {
    await automaticReady();
    await db.exec("set role authenticated");
    await expect(automate({ action: "service", clientName: "Camille Bernard" })).rejects.toThrow("permission denied");
    await db.exec("reset role");
    await expect(automate({ action: "service", clientId: tx, clientName: "Camille Bernard" })).rejects.toThrow("Client indisponible");
    expect(await count("clients")).toBe(1);
  });
});

describe("rapprochement Qonto exécuté dans PostgreSQL", () => {
  it("prépare uniquement les nouvelles opérations sans modifier les données comptables", async () => {
    await db.query("update qonto_connections set auto_intake_from='2026-09-16T12:00:00Z' where organization_id=$1", [org]);
    await bank(tx); await bank(secondTx);
    await db.query("update bank_transactions set settled_at='2026-09-17' where id=$1", [secondTx]);
    await db.query("select prepare_qonto_drafts($1)", [org]);
    await db.query("select prepare_qonto_drafts($1)", [org]);
    expect(await count("bank_transaction_drafts")).toBe(1);
    expect((await draftFor(secondTx)).payload.revenue).toBe(11000);
    expect(await count("payments")).toBe(0);
    expect(await count("interventions")).toBe(1);
  });
  it("ne recrée pas une proposition supprimée et permet de la restaurer", async () => {
    await prepareDraft();
    await manageDraft("dismiss");
    await db.query("select prepare_qonto_drafts($1)", [org]);
    expect((await db.query<{ status: string }>("select status from bank_transaction_drafts")).rows[0]!.status).toBe("dismissed");
    expect(await count("bank_transaction_drafts")).toBe(1);
    await manageDraft("restore");
    expect((await db.query<{ status: string }>("select status from bank_transaction_drafts")).rows[0]!.status).toBe("pending");
    expect(await count("payments")).toBe(0);
  });
  it("enregistre les modifications du brouillon et détecte une modification concurrente", async () => {
    const draft = await prepareDraft();
    const changed = { ...draft.payload, title: "Formule personnalisée" };
    await manageDraft("save", { payload: changed });
    expect((await draftFor()).payload.title).toBe("Formule personnalisée");
    await expect(manageDraft("save", { expectedUpdatedAt: "2020-01-01", payload: draft.payload })).rejects.toThrow("modifiée entre-temps");
    expect(await count("payments")).toBe(0);
  });
  it("valide une prestation et son règlement une seule fois et autorise un acompte", async () => {
    const draft = await prepareDraft();
    const details = { ...validation({ ...draft.payload, title: "Nettoyage validé", clientId: user, revenue: 15000, completed: false, performedOn: "", durationMinutes: 0 }), expectedUpdatedAt: draft.updated_at };
    const first = await manageDraft("validate", details);
    await manageDraft("validate", details);
    expect(await count("interventions")).toBe(2);
    expect(await count("payments")).toBe(1);
    const id = first.rows[0]!.manage_bank_draft.interventionId!;
    expect((await db.query<{ status: string }>("select status from interventions where id=$1", [id])).rows[0]!.status).toBe("to_schedule");
    expect((await db.query<{ paid: number }>("select amount_cents::integer paid from payments")).rows[0]!.paid).toBe(11000);
    await expect(db.query("update interventions set archived_at=now() where id=$1", [id])).rejects.toThrow("rapprochement Qonto");
    expect((await db.query("select id from interventions where id=$1 and archived_at is null", [id])).rows).toHaveLength(1);
  });
  it("rattache une proposition à un paiement existant au lieu de créer une autre prestation", async () => {
    const payment = (await db.query<{ id: string }>("insert into payments(organization_id,intervention_id,amount_cents,paid_at) values($1,$2,11000,'2026-09-16') returning id", [org, job])).rows[0]!.id;
    const draft = await prepareDraft();
    await manageDraft("validate", { ...validation(draft.payload), targetKind: "payment", targetId: payment });
    expect(await count("interventions")).toBe(1);
    expect(await count("payments")).toBe(1);
    expect((await db.query<{ status: string }>("select status from bank_transaction_drafts")).rows[0]!.status).toBe("processed");
  });
  it("valide un débit en charge ponctuelle et refuse une opération bancaire modifiée", async () => {
    const draft = await prepareDraft("debit");
    await expect(manageDraft("validate", { ...validation(draft.payload), expectedAmount: 12000 })).rejects.toThrow("bancaire a changé");
    expect(await count("expenses")).toBe(1);
    await manageDraft("validate", validation({ ...draft.payload, title: "Produits de nettoyage", category: "Consommables", vatRateBasisPoints: 2000, vatRecoverable: false }));
    expect(await count("expenses")).toBe(2);
    expect(await count("expense_settlements")).toBe(1);
    expect((await db.query<{ vat: number; recoverable: boolean }>("select vat_amount_cents::integer vat,vat_recoverable recoverable from expenses where description='Produits de nettoyage'")).rows[0]).toMatchObject({ vat: 1833, recoverable: false });
  });
  it("valide une proposition sur l’échéance existante d’une charge récurrente sans la recréer", async () => {
    const draft = await prepareDraft("debit");
    await manageDraft("validate", { ...validation(draft.payload), targetKind: "expense", targetId: expense, month: "2026-09-01" });
    expect(await count("expenses")).toBe(1);
    expect(await count("expense_settlements")).toBe(1);
    expect((await db.query<{ period_key: string }>("select period_month::text as period_key from expense_settlements")).rows[0]!.period_key).toBe("2026-09-01");
  });
  it("respecte la désactivation et exclut les virements internes et opérations en attente", async () => {
    await prepareDraft();
    await db.query("delete from bank_transaction_drafts");
    await db.query("update qonto_connections set auto_intake=false where organization_id=$1", [org]);
    await db.query("select prepare_qonto_drafts($1)", [org]);
    expect(await count("bank_transaction_drafts")).toBe(0);
    await db.query("update qonto_connections set auto_intake=true where organization_id=$1", [org]);
    for (const patch of ["status='pending'", "status='completed',operation_type='internal_transfer'", "operation_type='transfer',currency='USD'"]) {
      await db.exec(`update bank_transactions set ${patch}`);
      await db.query("select prepare_qonto_drafts($1)", [org]);
      expect(await count("bank_transaction_drafts")).toBe(0);
    }
  });
  it("ferme la proposition si le mouvement est traité ailleurs et protège les droits d’accès", async () => {
    const draft = await prepareDraft();
    await db.exec("set app.member_role='employee'; set role authenticated");
    expect((await db.query("select * from bank_transaction_drafts")).rows).toHaveLength(0);
    await expect(db.query("select manage_bank_draft($1,'dismiss',$2)", [draft.id, JSON.stringify({ expectedUpdatedAt: draft.updated_at })])).rejects.toThrow("permission denied");
    await expect(db.query("select prepare_qonto_drafts($1)", [org])).rejects.toThrow("permission denied");
    await db.exec("reset role; set app.member_role='partner'");
    await reconcile(tx, "intervention", job);
    expect((await db.query<{ status: string }>("select status from bank_transaction_drafts")).rows[0]!.status).toBe("processed");
    await reconcile(tx, "undo");
    await db.query("select prepare_qonto_drafts($1)", [org]);
    expect(await count("bank_transaction_drafts")).toBe(1);
  });
  it("rapproche deux achats compactés sans changer la charge ni les mois décaissés", async () => {
    await db.query("update expenses set recurrence='one_off',expense_date='2026-09-30',paid_at='2026-09-30T12:00:00Z' where id=$1", [expense]);
    await bank(tx, "debit", 4000); await bank(secondTx, "debit", 7000);
    await db.query("update bank_transactions set settled_at='2026-09-30T12:00:00Z' where id=$1", [tx]);
    await db.query("update bank_transactions set settled_at='2026-10-01T12:00:00Z' where id=$1", [secondTx]);
    const first = await group();
    const retry = await group([secondTx, tx]);
    expect(retry.rows[0]!.reconcile_bank_group).toBe(first.rows[0]!.reconcile_bank_group);
    expect(await count("expenses")).toBe(1);
    expect(await count("bank_reconciliation_groups")).toBe(1);
    expect(await count("expense_settlements")).toBe(1);
    const row = (await db.query<{ paid_at: string; amount_cents: number }>("select paid_at::text,amount_cents::integer from expense_settlements")).rows[0]!;
    const historic = { date: "2026-09-30", paid: true, paidAt: "2026-09-30", recurrence: "one_off" as const, amountIncludingTax: 11000 };
    const reconciled = { ...historic, settlements: [{ id: "s", month: "2026-09", amount: row.amount_cents, paidAt: financialDateKey(row.paid_at), bankTransactionId: tx }] };
    for (const month of ["2026-09", "2026-10"]) expect(paidExpenseAmountForMonth([reconciled], month, new Date("2026-11-05T12:00:00Z"))).toBe(paidExpenseAmountForMonth([historic], month, new Date("2026-11-05T12:00:00Z")));
    await expect(db.query("update expenses set paid=false where id=$1", [expense])).rejects.toThrow("regroupement Qonto");
    await reconcile(secondTx, "undo");
    expect(await count("bank_reconciliation_groups")).toBe(0);
    expect(await count("expense_settlements")).toBe(0);
    expect((await db.query<{ paid: boolean; amount: number }>("select paid,amount_including_tax_cents::integer amount from expenses")).rows[0]).toMatchObject({ paid: true, amount: 11000 });
    expect((await db.query("select id from bank_transactions where reconciliation='unmatched' and reconciliation_group_id is null")).rows).toHaveLength(2);
  });
  it("relie plusieurs crédits au paiement unique déjà enregistré, sans le recréer", async () => {
    const payment = (await db.query<{ id: string }>("insert into payments(organization_id,intervention_id,amount_cents,paid_at) values($1,$2,11000,'2026-09-01') returning id", [org, job])).rows[0]!.id;
    await bank(tx, "credit", 4000); await bank(secondTx, "credit", 7000);
    await group([tx, secondTx], "payment", payment, null);
    expect(await count("payments")).toBe(1);
    const extra = "50000000-0000-4000-8000-000000000003";
    await bank(extra);
    await expect(reconcile(extra, "payment", payment)).rejects.toThrow("regroupement");
    await expect(db.query("delete from payments where id=$1", [payment])).rejects.toThrow("regroupement Qonto");
    await reconcile(tx, "undo");
    expect(await count("payments")).toBe(1);
    expect((await db.query<{ date: string }>("select paid_at::date::text date from payments")).rows[0]!.date).toBe("2026-09-01");
  });
  it("refuse les totaux inexacts, doublons de sélection, sens mélangés et charges non payées", async () => {
    await bank(tx, "debit", 4000); await bank(secondTx, "debit", 6000);
    await expect(group()).rejects.toThrow("exactement");
    await expect(group([tx, tx])).rejects.toThrow("distinctes");
    await db.query("update bank_transactions set amount_cents=7000,side='credit' where id=$1", [secondTx]);
    await expect(group()).rejects.toThrow("même sens");
    await db.query("update bank_transactions set side='debit' where id=$1", [secondTx]);
    await db.query("update expenses set paid=false where id=$1", [expense]);
    await expect(group()).rejects.toThrow("déjà marquée payée");
    expect(await count("bank_reconciliation_groups")).toBe(0);
    expect(await count("expense_settlements")).toBe(0);
  });
  it("réserve les écritures au serveur, y compris pour un associé", async () => {
    await bank(tx, "debit", 4000); await bank(secondTx, "debit", 7000);
    await db.exec("set app.member_role='employee'");
    await expect(group()).rejects.toThrow("réservé");
    await db.exec("set app.member_role='partner'; set role authenticated");
    await expect(db.query("select reconcile_single_bank_transaction($1,'undo')", [tx])).rejects.toThrow("permission denied");
    await expect(group()).rejects.toThrow("permission denied");
    await db.exec("reset role");
    await group(); // historique existant avant migration
    await db.exec("set role authenticated");
    expect((await db.query("select * from bank_reconciliation_groups")).rows).toHaveLength(1);
    await db.exec("set app.member_role='employee'");
    expect((await db.query("select * from bank_reconciliation_groups")).rows).toHaveLength(0);
  });
  it("met le groupe entier à vérifier si Qonto annule l’un de ses mouvements", async () => {
    await bank(tx, "debit", 4000); await bank(secondTx, "debit", 7000); await group();
    const entry = { remote_id: tx, remote_organization_id: "qonto", account_id: "account", account_name: "Compte", amount_cents: 4000, currency: "EUR", side: "debit", status: "reversed", settled_at: "2026-09-16", emitted_at: "2026-09-16", remote_updated_at: "2026-09-17", operation_type: "transfer", label: "Annulation", counterparty: "Fournisseur", reference: "" };
    await db.query("select ingest_qonto_transactions($1,$2)", [org, JSON.stringify([entry])]);
    expect((await db.query("select id from bank_transactions where reconciliation='review'")).rows).toHaveLength(2);
    expect(await count("expenses")).toBe(1);
    expect(await count("expense_settlements")).toBe(1);
  });
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
    await db.query("insert into invoices(id,organization_id,total_including_tax_cents,status) values($1,$2,11000,'issued')", [period, org]);
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
