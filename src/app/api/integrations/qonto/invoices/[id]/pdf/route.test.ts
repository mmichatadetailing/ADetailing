import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), admin: vi.fn(), decrypt: vi.fn(), read: vi.fn(), eq: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/workspace", () => ({ requireAuthenticatedWorkspace: mocks.workspace, canManageBusiness: (role: string) => ["admin", "partner"].includes(role) }));
vi.mock("@/lib/integrations/token-crypto", () => ({ decryptToken: mocks.decrypt }));
import { GET } from "./route";

const invoiceId = "4d5418bb-bd0d-4df4-865c-c07afab8bb48";
const attachmentId = "71c32755-d0c3-4d82-9a78-774caa9d8556";
const signedUrl = "https://qonto-uploads.s3.eu-central-1.amazonaws.com/invoice.pdf?signature=private-value";
const request = (id = invoiceId) => GET(new Request("https://app.test/api/integrations/qonto/invoices/id/pdf"), { params: Promise.resolve({ id }) });
const invoice = (values = {}) => Response.json({ client_invoice: {
  id: invoiceId, organization_id: "remote-org", attachment_id: attachmentId, ...values,
} });
const attachment = (url: string | null = signedUrl) => Response.json({ attachment: { id: attachmentId, url } });
const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  mocks.workspace.mockResolvedValue({ role: "partner", organizationId: "local-org" });
  mocks.eq.mockReturnValue({ maybeSingle: mocks.read });
  mocks.admin.mockReturnValue({ from: () => ({ select: () => ({ eq: mocks.eq }) }) });
  mocks.read.mockResolvedValue({ data: { credentials_encrypted: "encrypted", enabled: true, remote_organization_id: "remote-org" }, error: null });
  mocks.decrypt.mockReturnValue(JSON.stringify({ login: "private-login", secret: "private-secret" }));
});
afterEach(() => vi.unstubAllGlobals());

it("ne contacte pas Qonto sans session autorisée, avec une connexion en pause ou un identifiant invalide", async () => {
  mocks.workspace.mockRejectedValueOnce(new Error("Authentification requise.")).mockResolvedValueOnce({ role: "employee" });
  expect((await request()).status).toBe(401);
  expect((await request()).status).toBe(403);
  expect(mocks.admin).not.toHaveBeenCalled();
  mocks.read.mockResolvedValueOnce({ data: { credentials_encrypted: "encrypted", enabled: false }, error: null });
  expect((await request()).status).toBe(409);
  expect((await request("../transactions")).status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("refuse le document d’une autre organisation avant de demander sa pièce jointe", async () => {
  fetchMock.mockResolvedValueOnce(invoice({ organization_id: "other-org" }));
  expect((await request()).status).toBe(404);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("signale un PDF non disponible sans exposer la réponse Qonto", async () => {
  fetchMock.mockResolvedValueOnce(invoice({ attachment_id: null }))
    .mockResolvedValueOnce(invoice()).mockResolvedValueOnce(attachment(null))
    .mockResolvedValueOnce(new Response("internal Qonto information", { status: 404 }));
  expect((await request()).status).toBe(404);
  expect((await request()).status).toBe(404);
  const response = await request();
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain("internal Qonto information");
});

it("renvoie le PDF en lecture seule, sans transmettre les identifiants au stockage", async () => {
  const encoder = new TextEncoder();
  const pdf = new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode("%PD"));
    controller.enqueue(encoder.encode("F-1.7\n%%EOF"));
    controller.close();
  } });
  fetchMock.mockResolvedValueOnce(invoice()).mockResolvedValueOnce(attachment())
    .mockResolvedValueOnce(new Response(pdf, { headers: { "Content-Type": "application/octet-stream" } }));
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("application/pdf");
  expect(response.headers.get("Content-Disposition")).toContain("inline");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.text()).toBe("%PDF-1.7\n%%EOF");
  expect(mocks.eq).toHaveBeenCalledWith("organization_id", "local-org");
  expect(fetchMock).toHaveBeenNthCalledWith(1, `https://thirdparty.qonto.com/v2/client_invoices/${invoiceId}`, expect.objectContaining({
    method: "GET", headers: expect.objectContaining({ Authorization: "private-login:private-secret" }),
  }));
  expect(fetchMock).toHaveBeenNthCalledWith(2, `https://thirdparty.qonto.com/v2/attachments/${attachmentId}`, expect.objectContaining({ method: "GET" }));
  const [storageUrl, options] = fetchMock.mock.calls[2]!;
  expect(String(storageUrl)).toBe(signedUrl);
  expect(options.redirect).toBe("error");
  expect(new Headers(options.headers).has("Authorization")).toBe(false);
  expect(Array.from(response.headers.values()).join(" ")).not.toContain("private-value");
});

it("rejette les liens de téléchargement non approuvés et les réponses non PDF", async () => {
  fetchMock.mockResolvedValueOnce(invoice()).mockResolvedValueOnce(attachment("https://127.0.0.1/internal"))
    .mockResolvedValueOnce(invoice()).mockResolvedValueOnce(attachment())
    .mockResolvedValueOnce(new Response("<html>error</html>", { headers: { "Content-Type": "application/pdf" } }));
  expect((await request()).status).toBe(502);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect((await request()).status).toBe(502);
});

it("refuse un PDF au-delà de la taille autorisée", async () => {
  fetchMock.mockResolvedValueOnce(invoice()).mockResolvedValueOnce(attachment()).mockResolvedValueOnce(
    new Response("%PDF-1.7", { headers: { "Content-Type": "application/pdf", "Content-Length": String(21 * 1024 * 1024) } }),
  );
  expect((await request()).status).toBe(413);
});
