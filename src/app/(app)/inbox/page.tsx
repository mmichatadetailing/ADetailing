"use client";

import { FileText, Inbox, MessageSquareText, Send, Sparkles, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/avatar";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { useDemoStore } from "@/lib/demo/store";
import { formatDate } from "@/lib/utils";

type Thread = { id: string; type: "general" | "intervention"; title: string; detail: string; unread: number };

export default function InboxPage() {
  const data = useDemoStore();
  const { workspace, sendMessage, refresh } = useWorkspace();
  const [selectedId, setSelectedId] = useState("general");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const currentUserId = workspace?.userId ?? data.team[0]?.id ?? "";

  const threads = useMemo<Thread[]>(() => [
    {
      id: "general",
      type: "general",
      title: `Général ${workspace?.organizationName ?? "ADetailing"}`,
      detail: "Visible par toute l’équipe",
      unread: data.messages.filter((message) => message.channel === "general" && message.authorId !== currentUserId && !message.readBy.includes(currentUserId)).length,
    },
    ...data.interventions
      .filter((item) => data.messages.some((message) => message.entityId === item.id) || item.workers.some((worker) => worker.memberId === currentUserId))
      .slice(0, 8)
      .map((item) => ({
        id: item.id,
        type: "intervention" as const,
        title: item.title,
        detail: "Participants du dossier uniquement",
        unread: data.messages.filter((message) => message.entityId === item.id && message.authorId !== currentUserId && !message.readBy.includes(currentUserId)).length,
      })),
  ], [currentUserId, data.interventions, data.messages, workspace?.organizationName]);
  const selected = threads.find((thread) => thread.id === selectedId) ?? threads[0];
  const messages = data.messages.filter((message) => selected?.type === "general" ? message.channel === "general" : message.entityId === selected?.id);

  const selectThread = async (thread: Thread) => {
    setSelectedId(thread.id);
    if (thread.unread <= 0) return;
    const response = await fetch("/api/messages", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(thread.type === "intervention" ? { entityType: "intervention", entityId: thread.id } : {}) });
    if (response.ok) await refresh();
  };

  const send = async () => {
    if (!body.trim() || !selected || sending) return;
    setSending(true);
    try {
      await sendMessage(body, selected.type === "intervention" ? "intervention" : undefined, selected.type === "intervention" ? selected.id : undefined);
      setBody("");
      toast.success(selected.type === "general" ? "Message envoyé à l’équipe" : "Message envoyé aux participants");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Envoi impossible."); }
    finally { setSending(false); }
  };

  return (
    <div className="space-y-7">
      <PageHeader eyebrow="Demandes & collaboration" title="Boîte de réception" description="Le canal général est commun à l’équipe. Les conversations de dossier restent réservées à leurs participants." />
      <section className="grid gap-3 sm:grid-cols-3">{[
        { icon: UserPlus, label: "Demandes à qualifier", value: data.leads.filter((lead) => ["received", "qualify"].includes(lead.stage)).length, color: "text-orange-500" },
        { icon: FileText, label: "Imports à vérifier", value: data.quotes.filter((quote) => quote.status === "to_review").length + data.invoices.filter((invoice) => invoice.status === "to_review").length, color: "text-sky-500" },
        { icon: MessageSquareText, label: "Messages non lus", value: threads.reduce((sum, thread) => sum + thread.unread, 0), color: "text-violet-500" },
      ].map((item) => <Card key={item.label}><CardContent className="flex items-center gap-4 p-5"><span className={`grid size-10 place-items-center rounded-xl bg-zinc-50 ${item.color}`}><item.icon className="size-5" /></span><div><p className="text-xl font-bold">{item.value}</p><p className="mt-1 text-xs text-zinc-500">{item.label}</p></div></CardContent></Card>)}</section>

      <Card className="overflow-hidden"><div className="grid min-h-[610px] md:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="border-b border-zinc-200 md:border-r md:border-b-0"><div className="flex h-16 items-center gap-2 border-b border-zinc-200 px-4"><Inbox className="size-4 text-brand-500" /><h2 className="text-sm font-bold">Fils de discussion</h2></div><div className="grid max-h-64 gap-1 overflow-y-auto p-2 md:max-h-[540px]">{threads.map((thread) => <button key={thread.id} onClick={() => void selectThread(thread)} className={`focus-ring flex items-center gap-3 rounded-xl p-3 text-left transition ${selectedId === thread.id ? "bg-brand-50" : "hover:bg-zinc-50"}`}><span className={`grid size-9 shrink-0 place-items-center rounded-xl ${thread.type === "general" ? "bg-orange-100 text-brand-500" : "bg-violet-100 text-violet-600"}`}>{thread.type === "general" ? <MessageSquareText className="size-4" /> : <Sparkles className="size-4" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{thread.title}</span><span className="mt-1 block truncate text-[10px] text-zinc-500">{thread.detail}</span></span>{thread.unread > 0 && <Badge variant="orange">{thread.unread}</Badge>}</button>)}</div></aside>
        <section className="flex min-h-[540px] flex-col"><header className="flex h-16 items-center justify-between border-b border-zinc-200 px-5"><div><p className="text-sm font-bold">{selected?.title}</p><p className="mt-1 text-[10px] text-zinc-500">{selected?.detail}</p></div><Badge>{selected?.type === "general" ? "Équipe" : "Privé"}</Badge></header><div className="flex-1 space-y-4 overflow-y-auto p-5">{messages.length === 0 ? <div className="grid h-full place-items-center text-center"><div><MessageSquareText className="mx-auto size-8 text-zinc-300" /><p className="mt-3 text-sm font-semibold">Aucun commentaire</p><p className="mt-1 text-xs text-zinc-500">Commencez la discussion.</p></div></div> : messages.map((message) => { const member = data.team.find((item) => item.id === message.authorId); const mine = message.authorId === currentUserId; return <div key={message.id} className={`flex items-start gap-3 ${mine ? "flex-row-reverse" : ""}`}><Avatar label={member?.initials ?? "?"} color={member?.color} size="sm" /><div className={`max-w-2xl ${mine ? "text-right" : ""}`}><div className={`flex items-baseline gap-2 ${mine ? "justify-end" : ""}`}><p className="text-xs font-bold">{mine ? "Vous" : member?.firstName}</p><span className="text-[9px] text-zinc-400">{formatDate(message.sentAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div><p className={`mt-1.5 rounded-2xl px-4 py-3 text-left text-sm leading-6 ${mine ? "rounded-tr-md bg-brand-500 text-white" : "rounded-tl-md bg-zinc-100 text-zinc-700"}`}>{message.body}</p></div></div>; })}</div><footer className="border-t border-zinc-200 p-4"><form onSubmit={(event) => { event.preventDefault(); void send(); }} className="flex gap-2"><Input value={body} onChange={(event) => setBody(event.target.value)} placeholder="Écrire un message…" /><Button type="submit" size="icon" disabled={sending} aria-label="Envoyer"><Send className="size-4" /></Button></form></footer></section>
      </div></Card>
    </div>
  );
}
