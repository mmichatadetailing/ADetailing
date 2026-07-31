"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useDemoStore } from "@/lib/demo/store";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { Field, Input, Select } from "./ui/field";
import { Modal } from "./ui/modal";

type AddKind = "lead" | "client" | "expense";

const leadSchema = z.object({
  prospectName: z.string().min(2, "Nom requis"),
  phone: z.string().min(6, "Téléphone requis"),
  email: z.email("E-mail invalide").or(z.literal("")),
  vehicleLabel: z.string().min(2, "Véhicule requis"),
  serviceLabel: z.string().min(2, "Prestation requise"),
  estimatedAmountEuros: z.number().min(0),
  source: z.string().min(1),
  ownerId: z.string().min(1),
});

const clientSchema = z.object({
  kind: z.enum(["individual", "business"]),
  company: z.string().optional(),
  firstName: z.string().min(2, "Prénom requis"),
  lastName: z.string().min(2, "Nom requis"),
  email: z.email("E-mail invalide").or(z.literal("")),
  phone: z.string().min(6, "Téléphone requis"),
  city: z.string().min(2, "Ville requise"),
  source: z.string().min(1),
  vehicleMake: z.string().optional(),
  vehicleModel: z.string().optional(),
  registration: z.string().optional(),
  vehicleFormat: z.string().optional(),
});

const expenseSchema = z.object({
  date: z.string().min(1),
  family: z.enum(["fixed", "variable", "investment", "personal"]),
  category: z.string().min(2, "Catégorie requise"),
  supplier: z.string().min(2, "Fournisseur requis"),
  description: z.string().min(2, "Description requise"),
  amountEuros: z.number().positive("Montant requis"),
  vatRate: z.number().min(0).max(100),
  paid: z.boolean(),
});

function LeadForm({ close }: { close: () => void }) {
  const addLead = useDemoStore((state) => state.addLead);
  const { mode, createRecord } = useWorkspace();
  const sources = useDemoStore((state) => state.settings.leadSources);
  const team = useDemoStore((state) => state.team);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof leadSchema>>({
    resolver: zodResolver(leadSchema),
    defaultValues: { email: "", estimatedAmountEuros: 0, source: sources[0], ownerId: team[0]?.id },
  });
  return (
    <form className="grid gap-4" onSubmit={handleSubmit(async (values) => {
      try {
        const input = { ...values, estimatedAmount: Math.round(values.estimatedAmountEuros * 100) };
        if (mode === "supabase") await createRecord({ kind: "lead", ...input }); else addLead(input);
        toast.success("Demande ajoutée au pipeline");
        close();
      } catch (error) { toast.error(error instanceof Error ? error.message : "Enregistrement impossible"); }
    })}>
      <Field label="Nom du prospect" error={errors.prospectName?.message}><Input autoFocus {...register("prospectName")} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Téléphone" error={errors.phone?.message}><Input inputMode="tel" {...register("phone")} /></Field>
        <Field label="E-mail" error={errors.email?.message}><Input type="email" {...register("email")} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Véhicule" error={errors.vehicleLabel?.message}><Input placeholder="Audi A4 Break" {...register("vehicleLabel")} /></Field>
        <Field label="Prestation envisagée" error={errors.serviceLabel?.message}><Input placeholder="Formule 2" {...register("serviceLabel")} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Estimation (€)"><Input type="number" step="0.01" {...register("estimatedAmountEuros", { valueAsNumber: true })} /></Field>
        <Field label="Source"><Select {...register("source")}>{sources.map((source) => <option key={source}>{source}</option>)}</Select></Field>
        <Field label="Responsable"><Select {...register("ownerId")}>{team.map((member) => <option key={member.id} value={member.id}>{member.firstName}</option>)}</Select></Field>
      </div>
      <Button type="submit" className="mt-2" disabled={isSubmitting}>{isSubmitting ? "Enregistrement…" : "Créer la demande"}</Button>
    </form>
  );
}

function ClientForm({ close }: { close: () => void }) {
  const addClient = useDemoStore((state) => state.addClient);
  const { mode, createRecord } = useWorkspace();
  const settings = useDemoStore((state) => state.settings);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof clientSchema>>({
    resolver: zodResolver(clientSchema),
    defaultValues: { kind: "individual", source: settings.leadSources[0], vehicleFormat: settings.vehicleFormats[0], email: "" },
  });
  return (
    <form className="grid gap-4" onSubmit={handleSubmit(async (values) => {
      try {
        const vehicle = values.vehicleMake ? { make: values.vehicleMake, model: values.vehicleModel ?? "", registration: values.registration ?? "", format: values.vehicleFormat ?? "Autre" } : undefined;
        const input = { ...values, vehicle };
        if (mode === "supabase") await createRecord({ kind: "client", clientKind: values.kind, company: values.company, firstName: values.firstName, lastName: values.lastName, email: values.email, phone: values.phone, city: values.city, source: values.source, vehicle }); else addClient(input);
        toast.success("Client enregistré");
        close();
      } catch (error) { toast.error(error instanceof Error ? error.message : "Enregistrement impossible"); }
    })}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type"><Select {...register("kind")}><option value="individual">Particulier</option><option value="business">Professionnel</option></Select></Field>
        <Field label="Société"><Input {...register("company")} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Prénom" error={errors.firstName?.message}><Input autoFocus {...register("firstName")} /></Field>
        <Field label="Nom" error={errors.lastName?.message}><Input {...register("lastName")} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Téléphone" error={errors.phone?.message}><Input {...register("phone")} /></Field>
        <Field label="E-mail" error={errors.email?.message}><Input type="email" {...register("email")} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ville"><Input {...register("city")} /></Field>
        <Field label="Source"><Select {...register("source")}>{settings.leadSources.map((source) => <option key={source}>{source}</option>)}</Select></Field>
      </div>
      <div className="mt-2 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
        <p className="mb-4 text-sm font-semibold">Premier véhicule <span className="font-normal text-zinc-500">· optionnel</span></p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Marque"><Input {...register("vehicleMake")} /></Field>
          <Field label="Modèle"><Input {...register("vehicleModel")} /></Field>
          <Field label="Immatriculation"><Input {...register("registration")} /></Field>
          <Field label="Format"><Select {...register("vehicleFormat")}>{settings.vehicleFormats.map((format) => <option key={format}>{format}</option>)}</Select></Field>
        </div>
      </div>
      <Button type="submit" className="mt-2" disabled={isSubmitting}>{isSubmitting ? "Enregistrement…" : "Créer le client"}</Button>
    </form>
  );
}

function ExpenseForm({ close }: { close: () => void }) {
  const addExpense = useDemoStore((state) => state.addExpense);
  const { mode, createRecord } = useWorkspace();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof expenseSchema>>({
    resolver: zodResolver(expenseSchema),
    defaultValues: { date: new Date().toISOString().slice(0, 10), family: "variable", vatRate: 20, paid: true },
  });
  return (
    <form className="grid gap-4" onSubmit={handleSubmit(async (values) => {
      try {
        const input = { date: new Date(`${values.date}T12:00:00`).toISOString(), family: values.family, category: values.category, supplier: values.supplier, description: values.description, amountIncludingTax: Math.round(values.amountEuros * 100), vatRateBasisPoints: Math.round(values.vatRate * 100), paid: values.paid };
        if (mode === "supabase") await createRecord({ ...input, kind: "expense", date: values.date }); else addExpense(input);
        toast.success("Dépense enregistrée");
        close();
      } catch (error) { toast.error(error instanceof Error ? error.message : "Enregistrement impossible"); }
    })}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date"><Input type="date" {...register("date")} /></Field>
        <Field label="Famille"><Select {...register("family")}><option value="fixed">Fixe</option><option value="variable">Variable</option><option value="investment">Investissement</option><option value="personal">Personnel</option></Select></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Catégorie" error={errors.category?.message}><Input {...register("category")} /></Field>
        <Field label="Fournisseur" error={errors.supplier?.message}><Input {...register("supplier")} /></Field>
      </div>
      <Field label="Description" error={errors.description?.message}><Input {...register("description")} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Montant TTC (€)" error={errors.amountEuros?.message}><Input type="number" step="0.01" {...register("amountEuros", { valueAsNumber: true })} /></Field>
        <Field label="TVA (%)"><Input type="number" step="0.1" {...register("vatRate", { valueAsNumber: true })} /></Field>
      </div>
      <label className="flex items-center gap-3 rounded-xl border border-white/[0.07] p-3 text-sm text-zinc-300"><input type="checkbox" className="accent-brand-500" {...register("paid")} /> Dépense déjà payée</label>
      <Button type="submit" className="mt-2" disabled={isSubmitting}>{isSubmitting ? "Enregistrement…" : "Enregistrer la dépense"}</Button>
    </form>
  );
}

export function GlobalAdd() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AddKind>("lead");
  const close = () => setOpen(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} aria-label="Ajouter"><Plus className="size-4" /> <span className="hidden sm:inline">Ajouter</span></Button>
      <Modal open={open} onClose={close} title="Ajouter" description="Une saisie courte, le reste pourra être complété plus tard.">
        <div className="mb-5 grid grid-cols-3 gap-2 rounded-xl bg-white/[0.035] p-1">
          {([['lead', 'Demande'], ['client', 'Client'], ['expense', 'Dépense']] as const).map(([value, label]) => (
            <button key={value} data-active={kind === value} className={`focus-ring tab-interactive rounded-lg px-3 py-2 text-xs font-semibold ${kind === value ? 'bg-white/10 text-white' : 'text-zinc-500'}`} onClick={() => setKind(value)}>{label}</button>
          ))}
        </div>
        {kind === "lead" && <LeadForm close={close} />}
        {kind === "client" && <ClientForm close={close} />}
        {kind === "expense" && <ExpenseForm close={close} />}
      </Modal>
    </>
  );
}
