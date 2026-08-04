import { describe, expect, it } from "vitest";
import { decodeGoogleOAuthContext, encodeGoogleOAuthContext } from "./google-oauth";

const context = {
  state: "2b695229-213e-4f83-906c-89de416ecba5",
  organizationId: "d6a14f53-b9c5-42b9-84c2-2fe3a70a7c42",
  profileId: "92992624-77aa-46be-835b-874521384bcc",
};

describe("contexte OAuth Google", () => {
  it("conserve l’état, l’utilisateur et l’entreprise pendant le retour OAuth", () => {
    expect(decodeGoogleOAuthContext(encodeGoogleOAuthContext(context))).toEqual(context);
  });

  it("refuse un cookie OAuth incomplet ou altéré", () => {
    expect(decodeGoogleOAuthContext("valeur-invalide")).toBeNull();
    expect(decodeGoogleOAuthContext()).toBeNull();
  });
});
