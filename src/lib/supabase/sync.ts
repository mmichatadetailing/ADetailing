export type WorkspaceMutation = { action: string; [key: string]: unknown };
type MutationHandler = (mutation: WorkspaceMutation) => Promise<void>;

let handler: MutationHandler | null = null;
let queue = Promise.resolve();

export function registerWorkspaceMutationHandler(nextHandler: MutationHandler) {
  handler = nextHandler;
  return () => {
    if (handler === nextHandler) handler = null;
  };
}

export function queueWorkspaceMutation(mutation: WorkspaceMutation) {
  if (!handler) return;
  const activeHandler = handler;
  queue = queue.then(() => activeHandler(mutation)).catch(() => undefined);
}
