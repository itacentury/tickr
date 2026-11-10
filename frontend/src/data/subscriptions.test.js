// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { state } from "../state.js";
import { removeStorageItem } from "../storage.js";
import { fetchSettings, updateSettings } from "./subscriptions.js";

const CACHE_KEY = "tickr_settings";
const DEFAULTS = { list_sort: "alphabetical" };
const SERVER_SETTINGS = { list_sort: "custom", default_list_id: "list-1" };

/** @param {Object} body */
const okResponse = (body) => ({ ok: true, json: async () => body });

describe("fetchSettings", () => {
  beforeEach(() => {
    // Also clears storage.js's in-memory mirror, which localStorage.clear() misses.
    removeStorageItem(CACHE_KEY);
    state.appSettings = { ...DEFAULTS };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies and caches the server settings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse(SERVER_SETTINGS)),
    );

    await fetchSettings();

    expect(state.appSettings).toEqual(SERVER_SETTINGS);
    expect(JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null")).toEqual(
      SERVER_SETTINGS,
    );
  });

  it("restores the cached settings when offline", async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify(SERVER_SETTINGS));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await fetchSettings();

    expect(state.appSettings).toEqual(SERVER_SETTINGS);
  });

  it("restores the cached settings on a non-ok response", async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify(SERVER_SETTINGS));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    await fetchSettings();

    expect(state.appSettings).toEqual(SERVER_SETTINGS);
  });

  it("keeps the defaults when offline without a cache", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await fetchSettings();

    expect(state.appSettings).toEqual(DEFAULTS);
  });

  it("ignores a corrupt cache", async () => {
    localStorage.setItem(CACHE_KEY, "{not json");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await fetchSettings();

    expect(state.appSettings).toEqual(DEFAULTS);
  });
});

describe("updateSettings", () => {
  beforeEach(() => {
    // Also clears storage.js's in-memory mirror, which localStorage.clear() misses.
    removeStorageItem(CACHE_KEY);
    state.appSettings = { ...DEFAULTS };
    const subscription = { unsubscribe() {} };
    state.db = /** @type {any} */ ({
      lists: { find: () => ({ $: { subscribe: () => subscription } }) },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("caches the merged settings after a successful update", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    await updateSettings({ default_list_id: "list-2" });

    expect(JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null")).toEqual({
      ...DEFAULTS,
      default_list_id: "list-2",
    });
  });
});
