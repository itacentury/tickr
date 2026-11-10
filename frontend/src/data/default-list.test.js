// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  isIdleExpired,
  getIdleTimeoutMinutes,
  resolveDefaultListId,
  recordHidden,
  isAppIdle,
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

describe("isAppIdle", () => {
  const config = { default_list_timeout_minutes: 30 };

  beforeEach(() => {
    localStorage.clear();
  });

  it("is idle on first launch", () => {
    expect(isAppIdle(config, 0)).toBe(true);
  });

  it("uses the recorded hide time", () => {
    recordHidden(0);
    expect(isAppIdle(config, 10 * MINUTE)).toBe(false);
    expect(isAppIdle(config, 30 * MINUTE)).toBe(true);
  });
});
