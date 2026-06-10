// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Subject } from "rxjs";
import { initSyncStatus } from "./sync-status.js";

describe("initSyncStatus", () => {
  /** @type {HTMLElement} */
  let indicator;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="syncIndicator"></div>';
    indicator = document.getElementById("syncIndicator");
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  /** Build a replications map whose active$ streams are controllable subjects. */
  function makeReplications() {
    const lists$ = new Subject();
    const items$ = new Subject();
    return {
      lists$,
      items$,
      replications: {
        listsReplication: { active$: lists$ },
        itemsReplication: { active$: items$ },
      },
    };
  }

  it("returns a teardown function", () => {
    const { replications } = makeReplications();
    expect(typeof initSyncStatus(replications)).toBe("function");
  });

  it("shows the indicator only after the 500ms delay while syncing", () => {
    const { lists$, replications } = makeReplications();
    initSyncStatus(replications);

    lists$.next(true);
    expect(indicator.classList.contains("visible")).toBe(false);

    vi.advanceTimersByTime(500);
    expect(indicator.classList.contains("visible")).toBe(true);
  });

  it("hides the indicator and cancels the pending show when sync stops early", () => {
    const { lists$, replications } = makeReplications();
    initSyncStatus(replications);

    lists$.next(true);
    vi.advanceTimersByTime(300);
    lists$.next(false);
    vi.advanceTimersByTime(500);

    expect(indicator.classList.contains("visible")).toBe(false);
  });

  it("unsubscribes from all active$ streams on teardown", () => {
    const { lists$, items$, replications } = makeReplications();
    const teardown = initSyncStatus(replications);

    expect(lists$.observed).toBe(true);
    expect(items$.observed).toBe(true);

    teardown();

    expect(lists$.observed).toBe(false);
    expect(items$.observed).toBe(false);
  });

  it("stops updating the indicator after teardown", () => {
    const { lists$, replications } = makeReplications();
    const teardown = initSyncStatus(replications);

    teardown();
    lists$.next(true);
    vi.advanceTimersByTime(500);

    expect(indicator.classList.contains("visible")).toBe(false);
  });
});
