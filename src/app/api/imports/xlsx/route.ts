import { NextResponse } from "next/server";
import { previewHistoricalWorkbook } from "@/lib/import/xlsx-importer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Fichier XLSX requis." }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "Le fichier doit être au format .xlsx." }, { status: 415 });
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: "Le classeur dépasse 25 Mo." }, { status: 413 });
  try {
    return NextResponse.json(await previewHistoricalWorkbook(await file.arrayBuffer(), file.name));
  } catch (error) {
    console.error("XLSX preview failed", error);
    return NextResponse.json({ error: "Le classeur n’a pas pu être lu. Vérifiez qu’il n’est pas protégé ou corrompu." }, { status: 422 });
  }
}

