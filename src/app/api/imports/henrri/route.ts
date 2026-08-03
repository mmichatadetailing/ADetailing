import { NextResponse } from "next/server";
import { parseHenrriText } from "@/lib/import/henrri-parser";
import { reconstructVisualRows, type PositionedPdfText } from "@/lib/import/pdf-text-layout";

export const runtime = "nodejs";

async function extractPdfText(buffer: ArrayBuffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const logicalText = content.items.map((item) => ("str" in item ? item.str : "")).join("\n");
    const positionedItems = content.items.flatMap((item): PositionedPdfText[] => {
      if (!("str" in item) || !("transform" in item) || !item.str.trim()) return [];
      return [{ str: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0 }];
    });
    const visualRows = reconstructVisualRows(positionedItems);
    pages.push(`${logicalText}\n\n${visualRows}`);
  }
  return pages.join("\n\n");
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Fichier PDF requis." }, { status: 400 });
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return NextResponse.json({ error: "Le fichier doit être un PDF." }, { status: 415 });
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "Le PDF dépasse la limite de 15 Mo." }, { status: 413 });
  try {
    const text = await extractPdfText(await file.arrayBuffer());
    const parsed = parseHenrriText(text);
    return NextResponse.json({ fileName: file.name, fileSize: file.size, parsed });
  } catch (error) {
    console.error("PDF import failed", error);
    return NextResponse.json({ error: "Le texte du PDF n’a pas pu être extrait. Vérifiez qu’il ne s’agit pas d’un scan image." }, { status: 422 });
  }
}
