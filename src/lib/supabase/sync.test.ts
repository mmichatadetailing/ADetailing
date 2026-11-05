import { expect, it } from "vitest";
import { hasPendingWorkspaceMutations, queueWorkspaceMutation, registerWorkspaceMutationHandler, waitForWorkspaceMutations } from "./sync";

it("sérialise les enregistrements et permet à l’export d’attendre leur fin", async () => {
  const calls: string[] = [];
  const unregister = registerWorkspaceMutationHandler(async (mutation) => { calls.push(mutation.action); });
  queueWorkspaceMutation({ action: "first" });
  queueWorkspaceMutation({ action: "second" });
  expect(hasPendingWorkspaceMutations()).toBe(true);
  await waitForWorkspaceMutations();
  expect(calls).toEqual(["first", "second"]);
  expect(hasPendingWorkspaceMutations()).toBe(false);
  unregister();
});

it("continue après un échec et libère l’état en cours", async () => {
  const calls: string[] = [];
  const unregister = registerWorkspaceMutationHandler(async (mutation) => {
    calls.push(mutation.action);
    if (mutation.action === "fail") throw new Error("Erreur attendue");
  });
  queueWorkspaceMutation({ action: "fail" });
  queueWorkspaceMutation({ action: "next" });
  await waitForWorkspaceMutations();
  expect(calls).toEqual(["fail", "next"]);
  expect(hasPendingWorkspaceMutations()).toBe(false);
  unregister();
});
