"use client";

import { AlertCircle, ChevronLeft, ChevronRight, Download, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import type { QontoInvoice } from "@/lib/domain/qonto-invoices";

type LoadedPdf = { document: PDFDocumentProxy; url: string; annotationMode: number };
type PreviewState = { state: "loading" } | { state: "ready"; pdf: LoadedPdf } | { state: "error"; message: string };

function PdfPage({ pdf, page, zoom }: { pdf: LoadedPdf; page: number; zoom: number }) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [rendered, setRendered] = useState<{ width: number; failed: boolean }>();
  useEffect(() => {
    const target = container.current;
    if (!target) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(Math.floor(entry.contentRect.width)); });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const target = canvas.current;
    if (!target || width < 1) return;
    let active = true;
    let task: RenderTask | undefined;
    void pdf.document.getPage(page).then(async (source) => {
      if (!active) return;
      const original = source.getViewport({ scale: 1 });
      const viewport = source.getViewport({ scale: Math.min(880, width) / original.width * zoom });
      // Bound the pixel count even for a high-DPI screen or an unusually tall page.
      const ratio = Math.min(window.devicePixelRatio || 1, 2, 4096 / Math.max(viewport.width, viewport.height));
      target.width = Math.max(1, Math.ceil(viewport.width * ratio));
      target.height = Math.max(1, Math.ceil(viewport.height * ratio));
      target.style.width = `${viewport.width}px`;
      target.style.height = `${viewport.height}px`;
      task = source.render({ canvas: target, viewport, transform: [ratio, 0, 0, ratio, 0, 0], annotationMode: pdf.annotationMode });
      await task.promise;
      if (active) setRendered({ width, failed: false });
    }).catch(() => { if (active) setRendered({ width, failed: true }); });
    return () => { active = false; task?.cancel(); };
  }, [pdf, page, zoom, width]);

  const pending = rendered?.width !== width;
  return <div ref={container} role="region" aria-label="Aperçu du document PDF" tabIndex={0} className="focus-ring h-[58dvh] min-h-44 overflow-auto rounded-xl border border-black/10 bg-slate-100 p-2 sm:p-4">
    {pending && <p role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Affichage de la page…</p>}
    {!pending && rendered.failed && <p role="alert" className="py-10 text-center text-sm text-red-800">Cette page ne peut pas être affichée. Vous pouvez télécharger le PDF.</p>}
    <canvas ref={canvas} role="img" aria-label={`Page ${page} de la facture`} className={`mx-auto max-w-none bg-white shadow-sm ${pending || rendered.failed ? "hidden" : "block"}`} />
  </div>;
}

function InvoicePdf({ invoice }: { invoice: QontoInvoice }) {
  const [preview, setPreview] = useState<PreviewState>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const controller = new AbortController();
    let loadingTask: PDFDocumentLoadingTask | undefined;
    let url: string | undefined;
    const load = async () => {
      const response = await fetch(`/api/integrations/qonto/invoices/${encodeURIComponent(invoice.id)}/pdf`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        setPreview({ state: "error", message: typeof payload?.error === "string" ? payload.error : "Le PDF est indisponible pour le moment." });
        return;
      }
      if (response.headers.get("content-type")?.split(";")[0] !== "application/pdf") throw new Error("PDF attendu.");
      const bytes = await response.arrayBuffer();
      const pdfjs = await import("pdfjs-dist");
      if (controller.signal.aborted) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;
      const file = new Blob([bytes], { type: "application/pdf" });
      const task = pdfjs.getDocument({ data: bytes, enableXfa: false, maxImageSize: 16_000_000 });
      loadingTask = task;
      const document = await task.promise;
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(file);
      setPreview({ state: "ready", pdf: { document, url, annotationMode: pdfjs.AnnotationMode.DISABLE } });
    };
    const start = window.setTimeout(() => {
      void load().catch(() => {
        if (!controller.signal.aborted) setPreview({ state: "error", message: "Impossible d’afficher le PDF de cette facture. Réessayez dans un instant." });
      });
    }, 0);
    return () => {
      window.clearTimeout(start);
      controller.abort();
      if (loadingTask) void loadingTask.destroy().catch(() => {});
      if (url) URL.revokeObjectURL(url);
    };
  }, [invoice.id, attempt]);

  if (preview.state === "loading") return <p role="status" className="flex min-h-44 items-center justify-center gap-2 text-sm text-zinc-500"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Chargement du PDF Qonto…</p>;
  if (preview.state === "error") return <div className="space-y-3">
    <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{preview.message}</p>
    <Button variant="secondary" size="sm" onClick={() => { setPreview({ state: "loading" }); setAttempt(attempt + 1); }}>Réessayer</Button>
  </div>;
  const { pdf } = preview;
  const pages = pdf.document.numPages;
  const filename = (invoice.number || "qonto").replace(/[^\p{L}\p{N}_.-]+/gu, "-").slice(0, 100);
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        {pages > 1 && <Button variant="secondary" size="sm" aria-label="Page précédente" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft aria-hidden="true" className="size-4" /></Button>}
        <span aria-live="polite" className="whitespace-nowrap text-xs font-semibold tabular-nums">Page {page} / {pages}</span>
        {pages > 1 && <Button variant="secondary" size="sm" aria-label="Page suivante" disabled={page >= pages} onClick={() => setPage((current) => Math.min(pages, current + 1))}><ChevronRight aria-hidden="true" className="size-4" /></Button>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Zoom du PDF" className="h-8 w-auto py-0 text-xs" value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>
          <option value={1}>Ajuster à la largeur</option><option value={1.5}>Zoom ×1,5</option><option value={2}>Zoom ×2</option>
        </Select>
        <a href={pdf.url} download={`facture-${filename}.pdf`} className={buttonVariants({ variant: "secondary", size: "sm" })}><Download aria-hidden="true" className="size-4" /> Télécharger le PDF</a>
      </div>
    </div>
    <PdfPage key={`${page}-${zoom}`} pdf={pdf} page={page} zoom={zoom} />
  </div>;
}

export function QontoInvoicePreview({ invoice, onClose }: { invoice: QontoInvoice; onClose: () => void }) {
  return <Modal open onClose={onClose} title={invoice.number ? `Facture ${invoice.number}` : "Aperçu de la facture"} description={invoice.clientName ? `${invoice.clientName} · PDF Qonto` : "PDF Qonto"} className="sm:max-w-5xl">
    <InvoicePdf key={invoice.id} invoice={invoice} />
  </Modal>;
}
