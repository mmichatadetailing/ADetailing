export type WorkspaceMutation = { action: string; [key: string]: unknown };
type MutationHandler = (mutation: WorkspaceMutation) => Promise<void>;

let handler: MutationHandler | null = null;
let queue = Promise.resolve();
let pending = 0;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

export function hasPendingWorkspaceMutations() { return pending > 0; }

export async function waitForWorkspaceMutations() {
  // Include writes added while the caller was waiting for an earlier batch.
  while (pending > 0) await queue;
}

export function subscribeWorkspaceMutations(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

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
  queue = queue.then(() => activeHandler(mutation)).catch(() => undefined).finally(() => { pending -= 1; notify(); });
  notify();
}
