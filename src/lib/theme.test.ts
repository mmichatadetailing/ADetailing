import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { parseTheme, THEME_BOOTSTRAP_SCRIPT, THEME_STORAGE_KEY } from "./theme";

describe("préférence d’apparence", () => {
  it.each([null, undefined, "", "light", "system", "DARK", "<script>", {}])("garde le mode clair pour une valeur absente ou invalide : %s", (value) => {
    expect(parseTheme(value)).toBe("light");
  });

  it("accepte uniquement le choix sombre explicite", () => {
    expect(parseTheme("dark")).toBe("dark");
  });

  it.each(["light", "dark", null, "invalid"])("applique le choix %s avant le premier affichage sans écrire dans le stockage", (saved) => {
    const document = { documentElement: { dataset: { theme: "" } } };
    const getItem = vi.fn(() => saved);
    runInNewContext(THEME_BOOTSTRAP_SCRIPT, { document, localStorage: { getItem } });
    expect(getItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
    expect(document.documentElement.dataset.theme).toBe(parseTheme(saved));
  });

  it("ne bloque pas la page si le stockage est interdit", () => {
    const document = { documentElement: { dataset: { theme: "" } } };
    expect(() => runInNewContext(THEME_BOOTSTRAP_SCRIPT, { document, localStorage: { getItem: () => { throw new Error("Storage blocked"); } } })).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
