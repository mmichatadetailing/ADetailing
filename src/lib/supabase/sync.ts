export type WorkspaceMutation = { action: string; [key: string]: unknown };
type MutationHandler = (mutation: WorkspaceMutation) => Promise<void>;

let handler: MutationHandler | null = null;
let queue = Promise.resolve();
let pending = 0;

export function hasPendingWorkspaceMutations() { return pending > 0; }

export async function waitForWorkspaceMutations() { await queue; }

export function registerWorkspaceMutationHandler(nextHandler: MutationHandler) {
  handler = nextHandler;
  return () => {
    if (handler === nextHandler) handler = null;
  };
}

export function queueWorkspaceMutation(mutation: WorkspaceMutation) {
  if (!handler) return;
  const activeHandler = handler;
  pending += 1;
  queue = queue.then(() => activeHandler(mutation)).catch(() => undefined).finally(() => { pending -= 1; });
}
