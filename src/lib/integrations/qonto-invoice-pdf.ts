const pdfSignature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const maxPdfBytes = 20 * 1024 * 1024;

export class QontoInvoicePdfError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function unavailableInvoicePdf() {
  return new QontoInvoicePdfError(404, "Qonto ne fournit pas encore de PDF pour cette facture. Réessayez après sa génération dans Qonto.");
}

function trustedDownloadUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname;
  // Qonto can serve the signed document itself or from an S3 bucket.
  const s3 = /^(?:[a-z0-9][a-z0-9.-]*\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/;
  if (url.protocol !== "https:" || url.username || url.password || url.port
    || !(host.endsWith(".qonto.com") || s3.test(host))) throw new Error("Hôte du PDF Qonto inattendu.");
  return url;
}

export async function downloadQontoInvoicePdf(value: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(trustedDownloadUrl(value), {
    signal, cache: "no-store", redirect: "error", headers: { Accept: "application/pdf, application/octet-stream, binary/octet-stream" },
  });
  if (response.status === 404 || response.status === 410) {
    void response.body?.cancel().catch(() => {});
    throw unavailableInvoicePdf();
  }
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (!response.ok || !response.body || (mime && !["application/pdf", "application/octet-stream", "binary/octet-stream"].includes(mime))) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Réponse PDF Qonto inattendue.");
  }
  if (Number(response.headers.get("content-length")) > maxPdfBytes) {
    void response.body.cancel().catch(() => {});
    throw new QontoInvoicePdfError(413, "Ce PDF dépasse la taille maximale d’aperçu (20 Mo). Consultez-le dans Qonto.");
  }

  const reader = response.body.getReader();
  const prefix: number[] = [];
  const buffered: Uint8Array[] = [];
  let length = 0;
  try {
    while (prefix.length < pdfSignature.length) {
      const { value: chunk, done } = await reader.read();
      if (done) throw new Error("PDF Qonto incomplet.");
      buffered.push(chunk);
      length += chunk.length;
      if (length > maxPdfBytes) throw new QontoInvoicePdfError(413, "Ce PDF dépasse la taille maximale d’aperçu (20 Mo). Consultez-le dans Qonto.");
      prefix.push(...chunk.subarray(0, pdfSignature.length - prefix.length));
    }
    if (!pdfSignature.every((byte, index) => byte === prefix[index])) throw new Error("Fichier Qonto non PDF.");
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  }

  // Stream the PDF to avoid the serverless response size limit and unbounded buffering.
  return new ReadableStream({
    start(controller) { for (const chunk of buffered) controller.enqueue(chunk); buffered.length = 0; },
    async pull(controller) {
      try {
        const { value: chunk, done } = await reader.read();
        if (done) { controller.close(); return; }
        length += chunk.length;
        if (length > maxPdfBytes) throw new Error("PDF Qonto trop volumineux.");
        controller.enqueue(chunk);
      } catch (error) {
        controller.error(error);
        void reader.cancel().catch(() => {});
      }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}
