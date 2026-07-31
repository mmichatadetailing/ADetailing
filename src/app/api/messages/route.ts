import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAuthenticatedWorkspace } from "@/lib/supabase/workspace";

const messageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  entityType: z.enum(["client", "intervention", "quote", "invoice", "expense", "asset"]).optional(),
  entityId: z.uuid().optional(),
}).refine((value) => Boolean(value.entityType) === Boolean(value.entityId));

const readSchema = z.object({
  entityType: z.literal("intervention").optional(),
  entityId: z.uuid().optional(),
}).refine((value) => Boolean(value.entityType) === Boolean(value.entityId));

export async function POST(request: Request) {
  try {
    const input = messageSchema.parse(await request.json());
    const supabase = await createSupabaseServerClient();
    const workspace = await requireAuthenticatedWorkspace(supabase);
    const kind = input.entityType ? "entity" : "general";

    let conversationQuery = supabase
      .from("conversations")
      .select("id,created_by")
      .eq("organization_id", workspace.organizationId)
      .eq("kind", kind)
      .is("archived_at", null);
    if (input.entityType && input.entityId) conversationQuery = conversationQuery.eq("entity_type", input.entityType).eq("entity_id", input.entityId);
    const { data: existingConversation, error: conversationReadError } = await conversationQuery.limit(1).maybeSingle();
    if (conversationReadError) throw conversationReadError;

    let conversationId = existingConversation?.id;
    let created = false;
    if (!conversationId) {
      let title = kind === "general" ? "Général" : "Discussion du dossier";
      if (input.entityType === "intervention" && input.entityId) {
        const { data: intervention } = await supabase.from("interventions").select("title").eq("organization_id", workspace.organizationId).eq("id", input.entityId).single();
        if (intervention?.title) title = intervention.title;
      }
      const { data: conversation, error } = await supabase.from("conversations").insert({
        organization_id: workspace.organizationId,
        kind,
        entity_type: input.entityType ?? null,
        entity_id: input.entityId ?? null,
        title,
        created_by: workspace.user.id,
      }).select("id").single();
      if (error) throw error;
      conversationId = conversation.id;
      created = true;
    }

    const participantIds = new Set<string>([workspace.user.id]);
    if (created && input.entityType === "intervention" && input.entityId) {
      const { data: workers, error } = await supabase.from("intervention_workers").select("profile_id").eq("organization_id", workspace.organizationId).eq("intervention_id", input.entityId);
      if (error) throw error;
      workers?.forEach((worker) => participantIds.add(worker.profile_id));
    }
    const { error: participantError } = await supabase.from("conversation_members").upsert(
      [...participantIds].map((profileId) => ({ organization_id: workspace.organizationId, conversation_id: conversationId, profile_id: profileId })),
      { onConflict: "conversation_id,profile_id", ignoreDuplicates: true },
    );
    if (participantError) throw participantError;

    const { data, error } = await supabase.from("messages").insert({
      organization_id: workspace.organizationId,
      conversation_id: conversationId,
      author_id: workspace.user.id,
      body: input.body,
    }).select("id").single();
    if (error) throw error;
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Message invalide." }, { status: 400 });
    console.error("Message creation failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Envoi impossible." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const input = readSchema.parse(await request.json());
    const supabase = await createSupabaseServerClient();
    const workspace = await requireAuthenticatedWorkspace(supabase);
    let query = supabase.from("conversations").select("id").eq("organization_id", workspace.organizationId).eq("kind", input.entityId ? "entity" : "general").is("archived_at", null);
    if (input.entityId) query = query.eq("entity_type", "intervention").eq("entity_id", input.entityId);
    const { data: conversation, error: conversationError } = await query.limit(1).maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation) return NextResponse.json({ ok: true });
    const { error } = await supabase.from("conversation_members").upsert({ organization_id: workspace.organizationId, conversation_id: conversation.id, profile_id: workspace.user.id, last_read_at: new Date().toISOString() }, { onConflict: "conversation_id,profile_id" });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Conversation invalide." }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Mise à jour impossible." }, { status: 500 });
  }
}
