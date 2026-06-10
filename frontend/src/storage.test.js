// @vitest-environment jsdom
// jsdom provides a real localStorage so the happy path exercises the native
// store; the fallback tests stub it to throw.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getStorageItem,
  setStorageItem,
  removeStorageItem,
} from "./storage.js";

describe("safe storage wrapper", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips a value through set and get", () => {
    setStorageItem("key", "value");
    expect(getStorageItem("key")).toBe("value");
  });

  it("returns null for a missing key", () => {
    expect(getStorageItem("absent")).toBeNull();
  });

  it("removes a value", () => {
    setStorageItem("key", "value");
    removeStorageItem("key");
    expect(getStorageItem("key")).toBeNull();
  });

  it("does not throw and keeps the value in memory when setItem throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    expect(() => setStorageItem("key", "value")).not.toThrow();
    // localStorage rejected the write, but the in-memory mirror retains it.
    expect(getStorageItem("key")).toBe("value");
  });

  it("falls back to memory when getItem throws", () => {
    setStorageItem("key", "value");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });

    expect(() => getStorageItem("key")).not.toThrow();
    expect(getStorageItem("key")).toBe("value");
  });

  it("does not throw when removeItem throws", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });

    expect(() => removeStorageItem("key")).not.toThrow();
  });
});
