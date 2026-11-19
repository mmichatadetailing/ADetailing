import "server-only";
import { getQontoReadAccess } from "./qonto-read-access";

export { QontoReadAccessError as QontoInvoiceAccessError } from "./qonto-read-access";
export function getQontoInvoiceAccess() {
  return getQontoReadAccess("les factures Qonto");
}
