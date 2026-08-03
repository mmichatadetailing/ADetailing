"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarPlus2, CheckCircle2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useDemoStore } from "@/lib/demo/store";
import { formatMoney } from "@/lib/utils";
import { useWorkspace } from "./workspace-provider";
import { Button } from "./ui/button";
import { Field, Input, Select } from "./ui/field";
import { Modal } from "./ui/modal";

type AddKind = "appointment" | "lead" | "client" | "expense";

const optionalPhoneSchema = z.string().trim().refine(
  (value) => value === "" || value.replace(/\D/g, "").length >= 6,
  "Téléphone invalide",
);

const leadSchema = z.object({
  prospectName: z.string().min(2, "Nom requis"),
  phone: optionalPhoneSchema,
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
  phone: optionalPhoneSchema,
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

const appointmentVehicleFormats = ["Citadine", "Berline", "SUV", "Monospace", "4x4", "Fourgon", "Autre"] as const;

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
        <Field label="Téléphone (facultatif)" error={errors.phone?.message}><Input inputMode="tel" {...register("phone")} /></Field>
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
        <Field label="Téléphone (facultatif)" error={errors.phone?.message}><Input inputMode="tel" {...register("phone")} /></Field>
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

function AppointmentForm({ close }: { close: () => void }) {
  const data = useDemoStore();
  const addAppointment = useDemoStore((state) => state.addAppointment);
  const { mode, createRecord } = useWorkspace();
  const router = useRouter();
  const activeTeam = data.team.filter((member) => member.active);
  const activeServices = data.services.filter((service) => service.active && !service.archivedAt);
  const initialClient = data.clients[0];
  const [clientId, setClientId] = useState(initialClient?.id ?? "");
  const [vehicleFormat, setVehicleFormat] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [serviceLabel, setServiceLabel] = useState("");
  const [date, setDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  });
  const [time, setTime] = useState("09:00");
  const [completed, setCompleted] = useState(false);
  const [durationHours, setDurationHours] = useState(2);
  const [priceEuros, setPriceEuros] = useState(0);
  const [address, setAddress] = useState(initialClient ? [initialClient.address, initialClient.postalCode, initialClient.city].filter(Boolean).join(" ") : "");
  const [workerId, setWorkerId] = useState(activeTeam[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const rangeFor = (nextServiceId: string, nextVehicleFormat: string) => {
    const service = activeServices.find((item) => item.id === nextServiceId);
    return service?.prices.find((item) => item.vehicleFormat === nextVehicleFormat)
      ?? service?.prices.find((item) => item.vehicleFormat === "Tous formats")
      ?? service?.prices[0];
  };

  const chooseClient = (nextClientId: string) => {
    const client = data.clients.find((item) => item.id === nextClientId);
    setClientId(nextClientId);
    setAddress(client ? [client.address, client.postalCode, client.city].filter(Boolean).join(" ") : "");
  };

  const chooseVehicleFormat = (nextVehicleFormat: string) => {
    setVehicleFormat(nextVehicleFormat);
    const range = rangeFor(serviceId, nextVehicleFormat);
    if (range) setPriceEuros(range.amount / 100);
  };

  const chooseServiceLabel = (nextLabel: string) => {
    setServiceLabel(nextLabel);
    const normalizedLabel = nextLabel.trim().toLocaleLowerCase("fr-FR");
    const service = activeServices.find((item) => item.name.trim().toLocaleLowerCase("fr-FR") === normalizedLabel);
    setServiceId(service?.id ?? "");
    if (service) {
      setDurationHours(service.targetDurationMinutes / 60);
      const range = rangeFor(service.id, vehicleFormat);
      if (range) setPriceEuros(range.amount / 100);
    }
  };

  const selectedRange = rangeFor(serviceId, vehicleFormat);

  const submit = async () => {
    const title = serviceLabel.trim();
    if (!clientId) return toast.error("Sélectionnez un client");
    if (title.length < 2) return toast.error("Indiquez la formule ou la prestation réalisée");
    if (!workerId) return toast.error("Affectez un collaborateur");
    if (!date || !time || !Number.isFinite(durationHours) || durationHours <= 0) return toast.error("Le créneau est incomplet");
    const startAt = new Date(`${date}T${time}`).toISOString();
    const input = { clientId, vehicleFormat: vehicleFormat || undefined, serviceId: serviceId || undefined, title, startAt, plannedDurationMinutes: Math.round(durationHours * 60), workerIds: [workerId], address, revenueAllocated: Math.round(priceEuros * 100), completed };
    setSubmitting(true);
    try {
      const id = mode === "supabase" ? await createRecord({ kind: "appointment", ...input }) : addAppointment(input);
      toast.success("Prestation créée — complétez les informations puis validez");
      close();
      router.push(`/prestations?intervention=${id}&edit=1`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Création du rendez-vous impossible");
    } finally {
      setSubmitting(false);
    }
  };

  if (data.clients.length === 0) return <div className="rounded-2xl border border-dashed border-zinc-200 p-8 text-center"><p className="text-sm font-bold">Créez d’abord un client</p><p className="mt-2 text-xs text-zinc-500">Un rendez-vous doit être rattaché à un client et à son véhicule.</p></div>;

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-zinc-100 p-1">
        <button type="button" aria-pressed={!completed} onClick={() => { setCompleted(false); const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); setDate(tomorrow.toISOString().slice(0, 10)); }} className={`focus-ring rounded-xl px-3 py-2.5 text-xs font-bold transition ${!completed ? "bg-white text-brand-700 shadow-sm" : "text-zinc-500"}`}><CalendarPlus2 className="mr-1.5 inline size-3.5" /> Rendez-vous à venir</button>
        <button type="button" aria-pressed={completed} onClick={() => { setCompleted(true); setDate(new Date().toISOString().slice(0, 10)); }} className={`focus-ring rounded-xl px-3 py-2.5 text-xs font-bold transition ${completed ? "bg-white text-emerald-700 shadow-sm" : "text-zinc-500"}`}><CheckCircle2 className="mr-1.5 inline size-3.5" /> Déjà effectuée</button>
      </div>
      <div className={`rounded-2xl border p-4 ${completed ? "border-emerald-200 bg-emerald-50/70" : "border-brand-200 bg-brand-50/70"}`}><p className={`flex items-center gap-2 text-sm font-bold ${completed ? "text-emerald-800" : "text-brand-700"}`}>{completed ? <CheckCircle2 className="size-4" /> : <CalendarPlus2 className="size-4" />} {completed ? "Ajouter une prestation terminée" : "Nouveau rendez-vous"}</p><p className={`mt-1 text-xs ${completed ? "text-emerald-700" : "text-brand-600"}`}>{completed ? "Le dossier commencera directement à l’étape Facture, avec les temps prévus repris comme temps réalisés." : "Les informations pourront être modifiées ensuite depuis la fiche prestation."}</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Client"><Select autoFocus value={clientId} onChange={(event) => chooseClient(event.target.value)}>{data.clients.map((client) => <option key={client.id} value={client.id}>{client.company || `${client.firstName} ${client.lastName}`}</option>)}</Select></Field>
        <Field label="Catégorie du véhicule" hint="Facultatif"><Select value={vehicleFormat} onChange={(event) => chooseVehicleFormat(event.target.value)}><option value="">Non renseignée</option>{appointmentVehicleFormats.map((format) => <option key={format} value={format}>{format}</option>)}</Select></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1.35fr_.65fr]">
        <Field label="Formule ou prestation" hint={serviceId ? "Prestation du catalogue reconnue : durée et fourchette retrouvées." : "Saisie libre : écrivez n’importe quel intitulé."}>
          <div className="grid gap-2">
            <Input list="adetailing-service-options" value={serviceLabel} onChange={(event) => chooseServiceLabel(event.target.value)} placeholder="Ex. Formule Premium ou nettoyage ponctuel" autoComplete="off" />
            <datalist id="adetailing-service-options">{activeServices.map((service) => <option key={service.id} value={service.name} />)}</datalist>
            {activeServices.length > 0 && <div className="flex flex-wrap gap-1.5" aria-label="Prestations enregistrées">{activeServices.slice(0, 5).map((service) => <button key={service.id} type="button" onClick={() => chooseServiceLabel(service.name)} className={`focus-ring rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${serviceId === service.id ? "border-brand-300 bg-brand-50 text-brand-700" : "border-zinc-200 bg-white text-zinc-500 hover:border-brand-200 hover:text-brand-700"}`}>{service.name}</button>)}</div>}
          </div>
        </Field>
        <Field label="Prix final prévu (€)" hint="Libre et modifiable pour cette prestation."><Input min="0" step="0.01" type="number" value={priceEuros} onChange={(event) => setPriceEuros(Number(event.target.value))} /></Field>
      </div>
      {selectedRange && <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-xs text-violet-800"><strong>Repère catalogue{vehicleFormat ? ` · ${vehicleFormat}` : ""} :</strong> {formatMoney(selectedRange.amount)} à {formatMoney(selectedRange.maximumAmount ?? selectedRange.amount)}. Vous restez libre de fixer le prix final.</div>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={completed ? "Date de réalisation" : "Date"}><Input min={completed ? undefined : new Date().toISOString().slice(0, 10)} type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Field label="Heure"><Input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></Field>
        <Field label="Durée prévue (h)"><Input min="0.25" step="0.25" type="number" value={durationHours} onChange={(event) => setDurationHours(Number(event.target.value))} /></Field>
      </div>
      <Field label="Adresse de la prestation"><Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Adresse, code postal, ville" /></Field>
      <Field label="Collaborateur" hint="Vous pourrez ajouter d’autres personnes dans l’étape suivante.">
        <Select value={workerId} onChange={(event) => setWorkerId(event.target.value)}>
          <option value="">Sélectionner un collaborateur…</option>
          {activeTeam.map((member) => <option key={member.id} value={member.id}>{member.firstName} {member.lastName}{!member.profileId ? " · compte à activer" : ""}</option>)}
        </Select>
      </Field>
      <Button onClick={() => void submit()} disabled={submitting}>{completed ? <CheckCircle2 className="size-4" /> : <CalendarPlus2 className="size-4" />} {submitting ? "Création…" : completed ? "Enregistrer la prestation effectuée" : "Créer et ouvrir la prestation"}</Button>
    </div>
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
  const [kind, setKind] = useState<AddKind>("appointment");
  const close = () => setOpen(false);
  useEffect(() => {
    const openGlobalAdd = (event: Event) => {
      const requestedKind = (event as CustomEvent<AddKind>).detail;
      if (requestedKind) setKind(requestedKind);
      setOpen(true);
    };
    window.addEventListener("adetailing:open-add", openGlobalAdd);
    return () => window.removeEventListener("adetailing:open-add", openGlobalAdd);
  }, []);
  return (
    <>
      <Button onClick={() => setOpen(true)} aria-label="Ajouter"><Plus className="size-4" /> <span className="hidden sm:inline">Ajouter</span></Button>
      <Modal open={open} onClose={close} title="Ajouter" description="Une saisie courte, le reste pourra être complété plus tard.">
        <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl bg-white/[0.035] p-1 sm:grid-cols-4">
          {([['appointment', 'Prestation'], ['lead', 'Demande'], ['client', 'Client'], ['expense', 'Dépense']] as const).map(([value, label]) => (
            <button key={value} data-active={kind === value} className={`focus-ring tab-interactive rounded-lg px-3 py-2 text-xs font-semibold ${kind === value ? 'bg-white/10 text-white' : 'text-zinc-500'}`} onClick={() => setKind(value)}>{label}</button>
          ))}
        </div>
        {kind === "appointment" && <AppointmentForm close={close} />}
        {kind === "lead" && <LeadForm close={close} />}
        {kind === "client" && <ClientForm close={close} />}
        {kind === "expense" && <ExpenseForm close={close} />}
      </Modal>
    </>
  );
}
