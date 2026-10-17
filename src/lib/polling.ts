// Interval polling that pauses while the tab is hidden and catches up as soon
// as it is visible again. Used instead of Supabase Realtime in the browser:
// the browser only holds the anon key, and the tables it would watch are not
// (and should not be) readable by anon. Polls go through /api routes, which
// read with the service role.

export type PollerEnv = {
  isHidden: () => boolean;
  onVisible: (cb: () => void) => () => void;
  setInterval: (cb: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

/** Starts polling and returns a stop function. Does not run immediately. */
export function startPoller(run: () => void, intervalMs: number, env: PollerEnv): () => void {
  const handle = env.setInterval(() => {
    if (!env.isHidden()) run();
  }, intervalMs);
  const unsubscribe = env.onVisible(run);
  return () => {
    env.clearInterval(handle);
    unsubscribe();
  };
}

export const browserPollerEnv: PollerEnv = {
  isHidden: () => typeof document !== "undefined" && document.hidden,
  onVisible: (cb) => {
    const handler = () => {
      if (!document.hidden) cb();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  },
  setInterval: (cb, ms) => window.setInterval(cb, ms),
  clearInterval: (handle) => window.clearInterval(handle as number),
};
