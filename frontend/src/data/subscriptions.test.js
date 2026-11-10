// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { state } from "../state.js";
import { removeStorageItem } from "../storage.js";
import {
  fetchSettings,
  fetchServerConfig,
  getInitialListId,
  updateSettings,
} from "./subscriptions.js";
import { recordHidden } from "./default-list.js";

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

describe("fetchServerConfig", () => {
  const CONFIG_CACHE_KEY = "tickr_server_config";
  const SERVER_CONFIG = { default_list_timeout_minutes: 5 };

  beforeEach(() => {
    removeStorageItem(CONFIG_CACHE_KEY);
    state.serverConfig = {};
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies and caches the server config", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(SERVER_CONFIG));
    vi.stubGlobal("fetch", fetchMock);

    await fetchServerConfig();

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/config");
    expect(state.serverConfig).toEqual(SERVER_CONFIG);
    expect(
      JSON.parse(localStorage.getItem(CONFIG_CACHE_KEY) ?? "null"),
    ).toEqual(SERVER_CONFIG);
  });

  it("restores the cached config when offline", async () => {
    localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(SERVER_CONFIG));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await fetchServerConfig();

    expect(state.serverConfig).toEqual(SERVER_CONFIG);
  });

  it("keeps the current config when offline without a cache", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await fetchServerConfig();

    expect(state.serverConfig).toEqual({});
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

describe("getInitialListId", () => {
  const MINUTE = 60_000;
  const LISTS = [{ id: "list-1" }, { id: "list-2" }, { id: "list-3" }];

  beforeEach(() => {
    removeStorageItem("tickr_current_list");
    state.lists = /** @type {any} */ (LISTS);
    state.appSettings = { ...DEFAULTS, default_list_id: "list-3" };
    state.serverConfig = { default_list_timeout_minutes: 30 };
  });

  it("opens the default list after an idle period", () => {
    recordHidden(Date.now() - 31 * MINUTE);
    localStorage.setItem("tickr_current_list", "list-2");

    expect(getInitialListId()).toBe("list-3");
  });

  it("reopens the last viewed list before the timeout", () => {
    recordHidden(Date.now() - 5 * MINUTE);
    localStorage.setItem("tickr_current_list", "list-2");

    expect(getInitialListId()).toBe("list-2");
  });

  it("falls back to the last viewed list when the default is gone", () => {
    recordHidden(Date.now() - 31 * MINUTE);
    state.appSettings = { ...DEFAULTS, default_list_id: "deleted" };
    localStorage.setItem("tickr_current_list", "list-2");

    expect(getInitialListId()).toBe("list-2");
  });

  it("falls back to the first list without a last viewed list", () => {
    recordHidden(Date.now() - 5 * MINUTE);

    expect(getInitialListId()).toBe("list-1");
  });
});
