import { describe, expect, it, vi } from "vitest";
import { startPoller, type PollerEnv } from "./polling";

function fakeEnv() {
  let hidden = false;
  let tick: (() => void) | null = null;
  let visible: (() => void) | null = null;
  const env: PollerEnv = {
    isHidden: () => hidden,
    onVisible: (cb) => {
      visible = cb;
      return () => { visible = null; };
    },
    setInterval: (cb) => { tick = cb; return 1; },
    clearInterval: () => { tick = null; },
  };
  return {
    env,
    tick: () => tick?.(),
    becomeVisible: () => { hidden = false; visible?.(); },
    hide: () => { hidden = true; },
    stopped: () => tick === null && visible === null,
  };
}

describe("startPoller", () => {
  it("runs on each tick while visible, not immediately", () => {
    const f = fakeEnv();
    const run = vi.fn();
    startPoller(run, 5000, f.env);
    expect(run).not.toHaveBeenCalled();
    f.tick();
    f.tick();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("skips ticks while hidden and catches up when visible again", () => {
    const f = fakeEnv();
    const run = vi.fn();
    startPoller(run, 5000, f.env);
    f.hide();
    f.tick();
    expect(run).not.toHaveBeenCalled();
    f.becomeVisible();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("stop clears the interval and the visibility listener", () => {
    const f = fakeEnv();
    const stop = startPoller(vi.fn(), 5000, f.env);
    stop();
    expect(f.stopped()).toBe(true);
  });
});
