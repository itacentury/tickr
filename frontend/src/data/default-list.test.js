// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isIdleExpired,
  getIdleTimeoutMinutes,
  resolveDefaultListId,
} from "./default-list.js";

const MINUTE = 60_000;

describe("isIdleExpired", () => {
  it("treats a missing timestamp as idle", () => {
    expect(isIdleExpired(null, 0, 30)).toBe(true);
  });

  it("is false before the timeout elapses", () => {
    expect(isIdleExpired(0, 29 * MINUTE, 30)).toBe(false);
  });

  it("is true once the timeout elapses", () => {
    expect(isIdleExpired(0, 30 * MINUTE, 30)).toBe(true);
  });
});

describe("getIdleTimeoutMinutes", () => {
  it("uses the server value", () => {
    expect(getIdleTimeoutMinutes({ default_list_timeout_minutes: 5 })).toBe(5);
  });

  it("falls back when missing or invalid", () => {
    expect(getIdleTimeoutMinutes({})).toBe(30);
    expect(getIdleTimeoutMinutes({ default_list_timeout_minutes: "5" })).toBe(
      30,
    );
    expect(getIdleTimeoutMinutes({ default_list_timeout_minutes: NaN })).toBe(
      30,
    );
  });

  it("clamps zero and negative values to one minute", () => {
    expect(getIdleTimeoutMinutes({ default_list_timeout_minutes: 0 })).toBe(1);
    expect(getIdleTimeoutMinutes({ default_list_timeout_minutes: -5 })).toBe(1);
  });
});

describe("resolveDefaultListId", () => {
  const lists = [{ id: "a" }, { id: "b" }];

  it("returns null when no default is set", () => {
    expect(resolveDefaultListId(lists, {})).toBeNull();
  });

  it("returns the default when the list exists", () => {
    expect(resolveDefaultListId(lists, { default_list_id: "b" })).toBe("b");
  });

  it("ignores a stale default whose list is gone", () => {
    expect(resolveDefaultListId(lists, { default_list_id: "gone" })).toBeNull();
  });
});

describe("consumeIdle", () => {
  const config = { default_list_timeout_minutes: 30 };
  /** @type {typeof import("./default-list.js")} */
  let defaultList;

  beforeEach(async () => {
    localStorage.clear();
    // Fresh module per test: the in-tab hide time is module state.
    vi.resetModules();
    defaultList = await import("./default-list.js");
  });

  it("is idle on first launch", () => {
    expect(defaultList.consumeIdle(config, 0)).toBe(true);
  });

  it("uses the recorded hide time", () => {
    defaultList.recordHidden(0);
    expect(defaultList.consumeIdle(config, 10 * MINUTE)).toBe(false);
    defaultList.recordHidden(0);
    expect(defaultList.consumeIdle(config, 30 * MINUTE)).toBe(true);
  });

  it("is not idle again until the next hide", () => {
    defaultList.recordHidden(0);
    expect(defaultList.consumeIdle(config, 5 * MINUTE)).toBe(false);
    expect(defaultList.consumeIdle(config, 60 * MINUTE)).toBe(false);
  });

  it("is not idle again after a cold start", () => {
    expect(defaultList.consumeIdle(config, 0)).toBe(true);
    expect(defaultList.consumeIdle(config, 60 * MINUTE)).toBe(false);
  });

  it("re-arms after the app is hidden again", () => {
    defaultList.recordHidden(0);
    defaultList.consumeIdle(config, 5 * MINUTE);
    defaultList.recordHidden(10 * MINUTE);
    expect(defaultList.consumeIdle(config, 40 * MINUTE)).toBe(true);
  });

  it("ignores a later hide time written by another tab", () => {
    defaultList.recordHidden(0);
    localStorage.setItem("tickr_last_hidden_at", String(25 * MINUTE));
    expect(defaultList.consumeIdle(config, 30 * MINUTE)).toBe(true);
  });

  it("falls back to the stored hide time on a cold start", () => {
    localStorage.setItem("tickr_last_hidden_at", "0");
    expect(defaultList.consumeIdle(config, 10 * MINUTE)).toBe(false);
  });
});
