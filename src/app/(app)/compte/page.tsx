"use client";

import { Building2, KeyRound, LogOut, Save, UserRound, UsersRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { memberRoleDisplayLabel } from "@/lib/domain/member-roles";

export default function AccountPage() {
  const { mode, workspace, refresh, signOut } = useWorkspace();
  const [firstName, setFirstName] = useState(workspace?.firstName ?? "");
  const [lastName, setLastName] = useState(workspace?.lastName ?? "");
  const [email, setEmail] = useState(workspace?.email ?? "");
  const [organizationName, setOrganizationName] = useState(workspace?.organizationName ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (mode !== "supabase" || !workspace) return toast.info("Le compte est disponible une fois Supabase configuré.");
    if (firstName.trim().length < 2 || lastName.trim().length < 2) return toast.error("Le prénom et le nom sont requis.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast.error("L’adresse e-mail est invalide.");
    if (newPassword && newPassword.length < 8) return toast.error("Le nouveau mot de passe doit contenir au moins 8 caractères.");
    setSaving(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: profileError } = await supabase.from("profiles").update({ first_name: firstName.trim(), last_name: lastName.trim() }).eq("id", workspace.userId);
      if (profileError) throw profileError;
      if (workspace.canManageTeam && organizationName.trim() !== workspace.organizationName) {
        const { error: organizationError } = await supabase.from("organizations").update({ name: organizationName.trim() }).eq("id", workspace.organizationId);
        if (organizationError) throw organizationError;
      }
      if (newPassword || email.trim().toLowerCase() !== workspace.email.toLowerCase()) {
        const authPatch: { password?: string; email?: string } = {};
        if (newPassword) authPatch.password = newPassword;
        if (email.trim().toLowerCase() !== workspace.email.toLowerCase()) authPatch.email = email.trim().toLowerCase();
        const { error: authError } = await supabase.auth.updateUser(authPatch);
        if (authError) throw authError;
        setNewPassword("");
      }
      await refresh();
      toast.success(email.trim().toLowerCase() !== workspace.email.toLowerCase() ? "Compte mis à jour. Confirmez votre nouvelle adresse e-mail." : "Compte mis à jour");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Mise à jour impossible."); }
    finally { setSaving(false); }
  };

  return <div className="space-y-7"><PageHeader eyebrow="Sécurité & identité" title="Mon compte" description="Gérez vos informations personnelles, votre entreprise et votre accès à ADetailing." actions={<Button variant="ghost" onClick={() => void signOut()}><LogOut className="size-4" /> Se déconnecter</Button>} /><div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]"><Card><CardHeader><div><h2 className="flex items-center gap-2 font-bold"><UserRound className="size-4 text-brand-500" /> Informations personnelles</h2><p className="mt-1 text-xs text-zinc-500">Ces informations sont visibles par les membres de votre espace.</p></div>{workspace && <Badge variant="blue"><UsersRound className="size-3" /> {memberRoleDisplayLabel(workspace.role)}</Badge>}</CardHeader><CardContent className="grid gap-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="Prénom"><Input value={firstName} onChange={(event) => setFirstName(event.target.value)} /></Field><Field label="Nom"><Input value={lastName} onChange={(event) => setLastName(event.target.value)} /></Field></div><Field label="E-mail" hint="Un message de confirmation sera envoyé si vous changez d’adresse."><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field><Field label="Nouveau mot de passe" hint="Laissez vide pour conserver votre mot de passe actuel."><Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" /></Field><Button onClick={() => void save()} disabled={saving || mode !== "supabase"}><Save className="size-4" /> {saving ? "Enregistrement…" : "Enregistrer les modifications"}</Button></CardContent></Card><div className="space-y-5"><Card><CardHeader><div><h2 className="flex items-center gap-2 font-bold"><Building2 className="size-4 text-violet-500" /> Entreprise</h2><p className="mt-1 text-xs text-zinc-500">Les données métier sont communes aux membres de cet espace.</p></div></CardHeader><CardContent className="grid gap-4"><Field label="Nom de l’entreprise" hint={workspace?.canManageTeam ? undefined : "Seuls les administrateurs et associés peuvent modifier ce nom."}><Input value={organizationName} disabled={!workspace?.canManageTeam} onChange={(event) => setOrganizationName(event.target.value)} /></Field><div className="rounded-2xl bg-violet-50 p-4 text-xs leading-5 text-violet-700"><p className="font-bold">{workspace?.locationName ?? "Établissement principal"}</p><p>{workspace?.locationCity || "Ville à compléter"}</p></div></CardContent></Card><Card><CardContent className="flex items-start gap-3 p-5"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><KeyRound className="size-4" /></span><div><p className="text-sm font-bold">Session sécurisée</p><p className="mt-1 text-xs leading-5 text-zinc-500">Les sessions utilisent les cookies Supabase SSR et les données sont filtrées par organisation avec RLS.</p></div></CardContent></Card></div></div></div>;
}
