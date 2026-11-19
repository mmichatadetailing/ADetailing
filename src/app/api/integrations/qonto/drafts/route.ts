import { NextResponse } from "next/server";

// Older tabs may still call the old inbox. No banking data or writes here.
function retired() {
  return NextResponse.json({ error: "Le traitement Qonto est automatique. Rechargez la page pour consulter le journal bancaire." }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
export { retired as GET, retired as POST };
