import { describe, expect, it } from "vitest";
import { createScrollLock } from "./scroll-lock";

describe("verrou de défilement des fiches et confirmations", () => {
  it.each([true, false])("déverrouille quel que soit l’ordre de fermeture (fiche d’abord : %s)", (panelFirst) => {
    const style = { overflow: "auto" };
    const lock = createScrollLock(() => style);
    const closePanel = lock();
    const closeConfirmation = lock();
    (panelFirst ? closePanel : closeConfirmation)();
    expect(style.overflow).toBe("hidden");
    (panelFirst ? closeConfirmation : closePanel)();
    expect(style.overflow).toBe("auto");
  });
  it("tolère un nettoyage répété puis une nouvelle ouverture", () => {
    const style = { overflow: "" };
    const lock = createScrollLock(() => style);
    const close = lock();
    close(); close();
    const closeAgain = lock();
    expect(style.overflow).toBe("hidden");
    closeAgain();
    expect(style.overflow).toBe("");
  });
});
