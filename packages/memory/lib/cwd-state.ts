type CwdListener = (cwd: string) => void;

type CwdState = {
  trackedCwd: string;
  listeners: Set<CwdListener>;
};

const state = ((
  globalThis as typeof globalThis & { __piTrackedCwdState?: CwdState }
).__piTrackedCwdState ??= {
  trackedCwd: process.cwd(),
  listeners: new Set<CwdListener>(),
});

export function getTrackedCwd(): string {
  return state.trackedCwd;
}

export function setTrackedCwd(cwd: string): void {
  if (!cwd || cwd === state.trackedCwd) return;

  state.trackedCwd = cwd;
  for (const listener of state.listeners) listener(cwd);
}

export function onTrackedCwdChange(listener: CwdListener): () => void {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}
