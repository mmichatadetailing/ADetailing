import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({
  auth: { exchangeCodeForSession: async () => ({ error: null }) },
}) }));
import { GET } from "./route";

it("conserve une destination interne après authentification", async () => {
  const params = new URLSearchParams({ code: "test", next: "/planning?date=2026-11-16" });
  const response = await GET(new NextRequest(`https://app.test/auth/callback?${params}`));
  expect(response.headers.get("location")).toBe("https://app.test/planning?date=2026-11-16");
});

it.each(["//external.test", "/\\external.test", "https://external.test", "/\\[invalid"])(
  "ne permet pas une redirection externe avec %s",
  async (next) => {
    const params = new URLSearchParams({ code: "test", next });
    const response = await GET(new NextRequest(`https://app.test/auth/callback?${params}`));
    expect(response.headers.get("location")).toBe("https://app.test/dashboard");
  },
);
