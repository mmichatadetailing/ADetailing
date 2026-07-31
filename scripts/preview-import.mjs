import fs from "node:fs/promises";
import path from "node:path";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: npm run import:preview -- <fichier.pdf|fichier.xlsx>");
  process.exit(1);
}
const absolutePath = path.resolve(filePath);
const extension = path.extname(absolutePath).toLowerCase();
if (![".pdf", ".xlsx"].includes(extension)) {
  console.error("Formats acceptés : .pdf ou .xlsx");
  process.exit(1);
}
const bytes = await fs.readFile(absolutePath);
const form = new FormData();
form.append("file", new File([bytes], path.basename(absolutePath), { type: extension === ".pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
const baseUrl = process.env.ADETAILING_LOCAL_URL ?? "http://127.0.0.1:3000";
const response = await fetch(`${baseUrl}/api/imports/${extension === ".pdf" ? "henrri" : "xlsx"}`, { method: "POST", body: form });
const payload = await response.json();
if (!response.ok) {
  console.error(payload);
  process.exit(1);
}
console.log(JSON.stringify(payload, null, 2));

