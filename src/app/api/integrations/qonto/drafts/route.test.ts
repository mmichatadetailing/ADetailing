import { expect, it } from "vitest";
import { GET, POST } from "./route";
it("retire définitivement l’ancienne file de validation, sans lecture ni écriture bancaire", async () => {
  for (const handler of [GET, POST]) {
    const response = handler();
    expect(response.status).toBe(410);
    expect(await response.json()).not.toHaveProperty("drafts");
  }
});
