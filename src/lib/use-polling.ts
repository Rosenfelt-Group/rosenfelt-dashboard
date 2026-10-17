"use client";

import { useEffect, useRef } from "react";
import { browserPollerEnv, startPoller } from "@/lib/polling";

/**
 * Calls `run` every `intervalMs` while the tab is visible, and once as soon as
 * a hidden tab becomes visible. Does not run on mount; load initial data
 * separately. Pass `enabled: false` to pause.
 */
export function usePolling(run: () => void, intervalMs: number, enabled = true) {
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!enabled) return;
    return startPoller(() => runRef.current(), intervalMs, browserPollerEnv);
  }, [intervalMs, enabled]);
}
