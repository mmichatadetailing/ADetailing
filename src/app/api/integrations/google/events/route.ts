import { NextResponse } from "next/server";
import { z } from "zod";
import type { GooglePlanningEvent, GooglePlanningEventsResponse } from "@/lib/integrations/google-calendar-types";
import { loadVisibleSharedGoogleEvents, refreshOwnGoogleSharedEvents } from "@/lib/integrations/google-shared-events";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAuthenticatedWorkspace } from "@/lib/supabase/workspace";

const querySchema = z.object({
  timeMin: z.string().datetime(),
  timeMax: z.string().datetime(),
}).refine(({ timeMin, timeMax }) => {
  const duration = new Date(timeMax).getTime() - new Date(timeMin).getTime();
  return duration > 0 && duration <= 370 * 24 * 60 * 60 * 1_000;
}, "La période demandée est invalide.");

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = querySchema.parse({ timeMin: url.searchParams.get("timeMin"), timeMax: url.searchParams.get("timeMax") });
    const supabase = await createSupabaseServerClient();
    const workspace = await requireAuthenticatedWorkspace(supabase);
    const refreshed = await refreshOwnGoogleSharedEvents({
      supabase,
      organizationId: workspace.organizationId,
      profileId: workspace.user.id,
      timeMin: input.timeMin,
      timeMax: input.timeMax,
    });
    const events: GooglePlanningEvent[] = await loadVisibleSharedGoogleEvents({
      supabase,
      organizationId: workspace.organizationId,
      profileId: workspace.user.id,
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      ownEvents: refreshed.ownEvents,
    });

    const response: GooglePlanningEventsResponse = {
      connected: refreshed.connected,
      events,
      errors: refreshed.errors,
      syncedAt: new Date().toISOString(),
    };
    return NextResponse.json(response, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    if (cause instanceof z.ZodError) return NextResponse.json({ error: "Période Google Calendar invalide." }, { status: 400 });
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Lecture de Google Calendar impossible." }, { status: 500 });
  }
}
