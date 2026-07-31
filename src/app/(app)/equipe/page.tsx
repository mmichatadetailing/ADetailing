"use client";

import { CalendarClock, Clock3, Copy, Link2, Plus, Save, ShieldCheck, Trash2, UserRoundPlus, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/avatar";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Progress } from "@/components/ui/progress";
import type { MemberRole } from "@/lib/domain/types";
import { useDemoStore } from "@/lib/demo/store";
import { formatDate } from "@/lib/utils";

const roleLabels: Record<MemberRole, string> = { admin: "Administrateur", partner: "Associé", employee: "Collaborateur" };

function formatHours(minutes: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(minutes / 60);
}

export default function TeamPage() {
  const data = useDemoStore();
  const { mode, workspace, invitations, refresh } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastInvitationUrl, setLastInvitationUrl] = useState("");
  const [capacityDrafts, setCapacityDrafts] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", role: "employee" as "employee" | "partner", weeklyHours: 35 });
  const canManage = mode === "demo" || Boolean(workspace?.canManageTeam);
  const pendingInvitations = useMemo(
    () => invitations.filter((invitation) => !invitation.acceptedAt && !invitation.revokedAt && new Date(invitation.expiresAt) > new Date()),
    [invitations],
  );

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    toast.success("Lien d’invitation copié");
  };

  const invite = async () => {
    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    const email = form.email.trim().toLowerCase();
    if (firstName.length < 2 || lastName.length < 2) return toast.error("Le prénom et le nom sont requis");
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast.error("Adresse e-mail invalide");
    if (!Number.isFinite(form.weeklyHours) || form.weeklyHours < 1 || form.weeklyHours > 80) return toast.error("La capacité doit être comprise entre 1 et 80 heures");

    if (mode === "demo") {
      data.addTeamMember({ firstName, lastName, email, role: form.role, weeklyCapacityMinutes: Math.round(form.weeklyHours * 60) });
      toast.success("Membre ajouté à la démonstration");
      setOpen(false);
      return;
    }

    setBusy("invite");
    try {
      const response = await fetch("/api/team/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, role: form.role, weeklyCapacityMinutes: Math.round(form.weeklyHours * 60) }),
      });
      const payload = await response.json() as { invitationUrl?: string; error?: string };
      if (!response.ok || !payload.invitationUrl) throw new Error(payload.error || "Invitation impossible.");
      setLastInvitationUrl(payload.invitationUrl);
      await refresh();
      await copy(payload.invitationUrl);
      toast.success(`Invitation créée pour ${firstName} ${lastName}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invitation impossible.");
    } finally {
      setBusy(null);
    }
  };

  const updateMember = async (memberId: string, patch: { active?: boolean; role?: MemberRole; weeklyCapacityMinutes?: number }) => {
    if (mode === "demo") {
      data.updateTeamMember(memberId, patch);
      toast.success("Collaborateur mis à jour");
      return;
    }
    setBusy(memberId);
    try {
      const response = await fetch(`/api/team/members/${memberId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Modification impossible.");
      await refresh();
      toast.success("Collaborateur mis à jour");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Modification impossible.");
    } finally {
      setBusy(null);
    }
  };

  const saveCapacity = (memberId: string, currentMinutes: number) => {
    const hours = Number(capacityDrafts[memberId] ?? currentMinutes / 60);
    if (!Number.isFinite(hours) || hours < 1 || hours > 80) return toast.error("La capacité doit être comprise entre 1 et 80 heures");
    void updateMember(memberId, { weeklyCapacityMinutes: Math.round(hours * 60) });
  };

  const revokeInvitation = async (id: string) => {
    setBusy(id);
    try {
      const response = await fetch(`/api/team/invitations/${id}`, { method: "DELETE" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Révocation impossible.");
      await refresh();
      toast.success("Invitation révoquée");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Révocation impossible.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Accès & collaboration"
        title="Équipe"
        description="Invitez chaque collaborateur avec son identité et sa capacité disponible. Ces informations alimentent ensuite le planning commun."
        actions={canManage ? <Button onClick={() => { setLastInvitationUrl(""); setOpen(true); }}><Plus className="size-4" /> Inviter un membre</Button> : undefined}
      />

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: UsersRound, label: "Membres actifs", value: String(data.team.filter((member) => member.active).length) },
          { icon: Clock3, label: "Capacité hebdo.", value: `${formatHours(data.team.filter((member) => member.active).reduce((sum, member) => sum + member.weeklyCapacityMinutes, 0))} h` },
          { icon: ShieldCheck, label: "Invitations en attente", value: String(pendingInvitations.length) },
        ].map((metric) => (
          <Card key={metric.label}>
            <CardContent className="flex items-center gap-4 p-5">
              <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-500"><metric.icon className="size-5" /></span>
              <div><p className="text-xl font-bold">{metric.value}</p><p className="mt-1 text-xs text-zinc-500">{metric.label}</p></div>
            </CardContent>
          </Card>
        ))}
      </section>

      {pendingInvitations.length > 0 && (
        <Card>
          <CardHeader>
            <div><h2 className="flex items-center gap-2 font-bold"><Link2 className="size-4 text-violet-500" /> Invitations en attente</h2><p className="mt-1 text-xs text-zinc-500">Chaque lien est personnel, lié à l’adresse e-mail et valable sept jours.</p></div>
          </CardHeader>
          <CardContent className="grid gap-2">
            {pendingInvitations.map((invitation) => (
              <div key={invitation.id} className="flex flex-col gap-3 rounded-2xl border border-zinc-200 p-4 sm:flex-row sm:items-center">
                <Avatar label={`${invitation.firstName[0] ?? ""}${invitation.lastName[0] ?? ""}`.toUpperCase() || "?"} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{`${invitation.firstName} ${invitation.lastName}`.trim() || "Invitation en attente"}</p>
                  <p className="mt-1 truncate text-xs text-zinc-600">{invitation.email}</p>
                  <p className="mt-1 text-[10px] text-zinc-500">{roleLabels[invitation.role]} · {formatHours(invitation.weeklyCapacityMinutes)} h/semaine · expire le {formatDate(invitation.expiresAt)}</p>
                </div>
                <Button size="sm" variant="ghost" disabled={busy === invitation.id} onClick={() => void revokeInvitation(invitation.id)}><Trash2 className="size-3.5" /> Révoquer</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        {data.team.map((member) => {
          const planned = data.interventions
            .filter((item) => item.workers.some((worker) => worker.memberId === member.id) && ["scheduled", "confirmed", "in_progress"].includes(item.status))
            .reduce((sum, item) => sum + (item.workers.find((worker) => worker.memberId === member.id)?.plannedMinutes ?? 0), 0);
          const rate = member.weeklyCapacityMinutes ? planned / member.weeklyCapacityMinutes * 100 : 0;
          return (
            <Card key={member.id}>
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <Avatar label={member.initials} color={member.color} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold">{member.firstName} {member.lastName}</p>
                      <Badge variant={member.role === "admin" ? "orange" : member.role === "partner" ? "blue" : "neutral"}>{roleLabels[member.role]}</Badge>
                      {member.id === workspace?.userId && <Badge variant="green">Vous</Badge>}
                      {!member.active && <Badge variant="red">Inactif</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-zinc-600">{member.email}</p>
                  </div>
                  {canManage && member.id !== workspace?.userId && <button disabled={busy === member.id} onClick={() => void updateMember(member.id, { active: !member.active })} className="text-[10px] font-semibold text-zinc-500 hover:text-brand-600 disabled:opacity-50">{member.active ? "Désactiver" : "Réactiver"}</button>}
                </div>

                {canManage && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {member.id !== workspace?.userId ? (
                      <Field label="Rôle">
                        <Select aria-label="Rôle du membre" value={member.role} disabled={busy === member.id} onChange={(event) => void updateMember(member.id, { role: event.target.value as MemberRole })}>
                          <option value="employee">Collaborateur</option>
                          <option value="partner">Associé</option>
                          {workspace?.role === "admin" && <option value="admin">Administrateur</option>}
                        </Select>
                      </Field>
                    ) : <div />}
                    <Field label="Disponibilité hebdo. (h)" hint="Utilisée pour calculer la charge.">
                      <div className="flex gap-2">
                        <Input
                          aria-label={`Heures disponibles de ${member.firstName} ${member.lastName}`}
                          min="1"
                          max="80"
                          step="0.5"
                          type="number"
                          value={capacityDrafts[member.id] ?? member.weeklyCapacityMinutes / 60}
                          onChange={(event) => setCapacityDrafts((state) => ({ ...state, [member.id]: event.target.value }))}
                          onKeyDown={(event) => { if (event.key === "Enter") saveCapacity(member.id, member.weeklyCapacityMinutes); }}
                        />
                        <Button aria-label={`Enregistrer les heures de ${member.firstName}`} size="sm" variant="secondary" disabled={busy === member.id} onClick={() => saveCapacity(member.id, member.weeklyCapacityMinutes)}><Save className="size-3.5" /></Button>
                      </div>
                    </Field>
                  </div>
                )}

                <div className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                  <div className="flex items-center justify-between"><p className="flex items-center gap-2 text-xs font-semibold"><CalendarClock className="size-3.5 text-sky-500" /> Charge planifiée</p><p className="text-xs font-bold">{Math.round(rate)} %</p></div>
                  <Progress value={rate} className="mt-3" />
                  <p className="mt-2 text-[10px] text-zinc-600">{formatHours(planned)} h planifiées sur {formatHours(member.weeklyCapacityMinutes)} h disponibles</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <Modal open={open} onClose={() => setOpen(false)} title={mode === "supabase" ? "Inviter un collaborateur" : "Ajouter un membre"} description={mode === "supabase" ? "Son identité et sa disponibilité seront enregistrées dès qu’il rejoindra l’entreprise." : "Le membre est ajouté uniquement à la démonstration locale."}>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Prénom"><Input autoFocus autoComplete="given-name" value={form.firstName} onChange={(event) => setForm((state) => ({ ...state, firstName: event.target.value }))} /></Field>
            <Field label="Nom"><Input autoComplete="family-name" value={form.lastName} onChange={(event) => setForm((state) => ({ ...state, lastName: event.target.value }))} /></Field>
          </div>
          <Field label="E-mail"><Input type="email" value={form.email} onChange={(event) => setForm((state) => ({ ...state, email: event.target.value }))} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Rôle"><Select value={form.role} onChange={(event) => setForm((state) => ({ ...state, role: event.target.value as "employee" | "partner" }))}><option value="employee">Collaborateur</option><option value="partner">Associé</option></Select></Field>
            <Field label="Capacité hebdo. (h)"><Input min="1" max="80" step="0.5" type="number" value={form.weeklyHours} onChange={(event) => setForm((state) => ({ ...state, weeklyHours: Number(event.target.value) }))} /></Field>
          </div>
          {lastInvitationUrl && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs font-bold text-emerald-800">Invitation prête</p><p className="mt-2 break-all text-[11px] leading-5 text-emerald-700">{lastInvitationUrl}</p><Button className="mt-3" size="sm" variant="secondary" onClick={() => void copy(lastInvitationUrl)}><Copy className="size-3.5" /> Copier le lien</Button></div>}
          <Button onClick={() => void invite()} disabled={busy === "invite"}><UserRoundPlus className="size-4" /> {busy === "invite" ? "Création…" : mode === "supabase" ? "Créer l’invitation" : "Ajouter à l’équipe"}</Button>
        </div>
      </Modal>
    </div>
  );
}
