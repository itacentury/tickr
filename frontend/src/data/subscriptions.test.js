// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { state } from "../state.js";
import { removeStorageItem } from "../storage.js";
import {
  fetchSettings,
  fetchServerConfig,
  flushPendingSettings,
  getInitialListId,
  updateSettings,
} from "./subscriptions.js";
import { recordHidden } from "./default-list.js";
import { reportError } from "../error-reporting.js";
import { settingsRejected$ } from "../bus.js";

vi.mock("../error-reporting.js", () => ({ reportError: vi.fn() }));

const CACHE_KEY = "tickr_settings";
const PENDING_KEY = "tickr_pending_settings";
const SW_OFFLINE = { ok: false, status: 503 };
const TIMEOUT_ERROR = new DOMException("timed out", "TimeoutError");

/** @returns {Object|null} The queued settings patch. */
const readPending = () =>
  JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null");
const DEFAULTS = { list_sort: "alphabetical" };
const SERVER_SETTINGS = { list_sort: "custom", default_list_id: "list-1" };

/** @param {Object} body */
const okResponse = (body) => ({ ok: true, json: async () => body });

describe("fetchSettings", () => {
  beforeEach(() => {
    // Also clears storage.js's in-memory mirror, which localStorage.clear() misses.
    removeStorageItem(CACHE_KEY);
    removeStorageItem(PENDING_KEY);
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

  it("restores the cached settings when the request times out", async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify(SERVER_SETTINGS));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(TIMEOUT_ERROR));

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

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/config", {
      signal: expect.any(AbortSignal),
    });
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
    removeStorageItem(PENDING_KEY);
    state.appSettings = { ...DEFAULTS };
    vi.mocked(reportError).mockClear();
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
    expect(readPending()).toBeNull();
  });

  it("applies and queues the update while offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await updateSettings({ default_list_id: "list-2" });

    expect(state.appSettings.default_list_id).toBe("list-2");
    expect(readPending()).toEqual({ default_list_id: "list-2" });
  });

  it("keeps the patch queued when the request times out", async () => {
    const fetchMock = vi.fn().mockRejectedValue(TIMEOUT_ERROR);
    vi.stubGlobal("fetch", fetchMock);

    await updateSettings({ list_sort: "custom" });

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(readPending()).toEqual({ list_sort: "custom" });
  });

  it("treats the service worker's offline 503 as offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(SW_OFFLINE));

    await updateSettings({ list_sort: "custom" });

    expect(readPending()).toEqual({ list_sort: "custom" });
    expect(reportError).not.toHaveBeenCalled();
  });

  it.each([500, 501])(
    "keeps the patch queued and reports a server error %i",
    async (status) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status }));

      await updateSettings({ list_sort: "custom" });

      expect(readPending()).toEqual({ list_sort: "custom" });
      expect(reportError).toHaveBeenCalledWith(
        "update settings",
        expect.any(Error),
      );
    },
  );

  it.each([502, 504])(
    "keeps the patch queued without reporting a gateway error %i",
    async (status) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status }));

      await updateSettings({ list_sort: "custom" });

      expect(readPending()).toEqual({ list_sort: "custom" });
      expect(reportError).not.toHaveBeenCalled();
    },
  );

  it("keeps the patch queued on an expired session without reporting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );

    await updateSettings({ list_sort: "custom" });

    expect(readPending()).toEqual({ list_sort: "custom" });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("drops the patch on a validation error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 422 })
      .mockResolvedValueOnce(okResponse(SERVER_SETTINGS));
    vi.stubGlobal("fetch", fetchMock);

    await updateSettings({ list_sort: "invalid" });

    expect(readPending()).toBeNull();
    expect(state.appSettings).toEqual(SERVER_SETTINGS);
  });

  it("sends merged offline edits once when flushed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await updateSettings({ default_list_id: "list-2" });
    await updateSettings({ default_list_id: "list-3", list_sort: "custom" });

    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    expect(await flushPendingSettings()).toBe("synced");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      default_list_id: "list-3",
      list_sort: "custom",
    });
    expect(readPending()).toBeNull();
  });

  it("drops the patch and restores server settings on rejection", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce(okResponse(SERVER_SETTINGS));
    vi.stubGlobal("fetch", fetchMock);

    await updateSettings({ default_list_id: "deleted" });

    expect(readPending()).toBeNull();
    expect(state.appSettings).toEqual(SERVER_SETTINGS);
  });

  /**
   * @param {number} status
   * @param {string} code
   */
  const errorResponse = (status, code) => ({
    ok: false,
    status,
    json: async () => ({ error: { code, message: "", status } }),
  });

  it("resends the rest of the patch when the default list was deleted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await updateSettings({ list_sort: "alphabetical" });
    await updateSettings({ default_list_id: "deleted" });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(404, "LIST_NOT_FOUND"))
      .mockResolvedValueOnce(okResponse(SERVER_SETTINGS))
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    expect(await flushPendingSettings()).toBe("rejected");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      list_sort: "alphabetical",
    });
    expect(readPending()).toBeNull();
    expect(state.appSettings).toEqual({
      ...SERVER_SETTINGS,
      list_sort: "alphabetical",
    });
  });

  it("drops the whole patch on any other rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await updateSettings({ list_sort: "bogus", default_list_id: "list-2" });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(400, "INVALID_SORT_OPTION"))
      .mockResolvedValueOnce(okResponse(SERVER_SETTINGS));
    vi.stubGlobal("fetch", fetchMock);

    expect(await flushPendingSettings()).toBe("rejected");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readPending()).toBeNull();
    expect(state.appSettings).toEqual(SERVER_SETTINGS);
  });

  it("keeps the patch queued when the flush fails unexpectedly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await updateSettings({ list_sort: "custom" });

    const failure = new Error("unexpected");
    const fetchMock = vi.fn().mockResolvedValue({
      get status() {
        throw failure;
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await flushPendingSettings()).toBe("queued");
    expect(readPending()).toEqual({ list_sort: "custom" });
    expect(reportError).toHaveBeenCalledWith("update settings", failure);

    await flushPendingSettings();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  describe("when storage cannot clear the queue", () => {
    beforeEach(() => {
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      localStorage.removeItem(PENDING_KEY);
    });

    /** @param {import("vitest").Mock} fetchMock */
    const putCount = (fetchMock) =>
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT").length;

    it("stops after a 2xx instead of resending", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);

      await updateSettings({ list_sort: "custom" });
      expect(putCount(fetchMock)).toBe(1);
    });

    it("stops after a rejection instead of resending", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 422 })
        .mockResolvedValue(okResponse(SERVER_SETTINGS));
      vi.stubGlobal("fetch", fetchMock);

      await updateSettings({ list_sort: "invalid" });
      expect(putCount(fetchMock)).toBe(1);
    });
  });

  describe("rejection reporting", () => {
    /** @type {import("rxjs").Subscription} */
    let subscription;
    /** @type {string[][]} */
    let rejections = [];

    beforeEach(async () => {
      rejections = [];
      subscription = settingsRejected$.subscribe((keys) =>
        rejections.push(keys),
      );
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("offline")),
      );
      await updateSettings({ list_sort: "bogus" });
    });

    afterEach(() => {
      subscription.unsubscribe();
    });

    it("reports a rejection from the flush fetchSettings starts", async () => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(okResponse(SERVER_SETTINGS))
          .mockResolvedValueOnce(errorResponse(400, "INVALID_SORT_OPTION"))
          .mockResolvedValueOnce(okResponse(SERVER_SETTINGS)),
      );

      await fetchSettings();
      // Joins the background flush fetchSettings did not await.
      await flushPendingSettings();

      expect(rejections).toEqual([["list_sort"]]);
    });

    it("reports a rejection even when the flush ends queued", async () => {
      await updateSettings({ default_list_id: "deleted" });
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(errorResponse(404, "LIST_NOT_FOUND"))
          .mockResolvedValueOnce(okResponse(SERVER_SETTINGS))
          .mockResolvedValueOnce(SW_OFFLINE),
      );

      expect(await flushPendingSettings()).toBe("queued");
      expect(rejections).toEqual([["default_list_id"]]);
    });

    it("reports two rejections in one flush once", async () => {
      await updateSettings({ default_list_id: "deleted" });
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(errorResponse(404, "LIST_NOT_FOUND"))
          .mockResolvedValueOnce(okResponse(SERVER_SETTINGS))
          .mockResolvedValueOnce(errorResponse(400, "INVALID_SORT_OPTION"))
          .mockResolvedValueOnce(okResponse(SERVER_SETTINGS)),
      );

      expect(await flushPendingSettings()).toBe("rejected");
      expect(rejections).toEqual([["default_list_id", "list_sort"]]);
    });

    it.each([
      { outcome: "synced", response: { ok: true } },
      { outcome: "queued", response: SW_OFFLINE },
    ])("does not report a $outcome flush", async ({ outcome, response }) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

      expect(await flushPendingSettings()).toBe(outcome);
      expect(rejections).toEqual([]);
    });
  });

  describe("with a change made while a request is in flight", () => {
    /** @type {(response: Object) => void} */
    let resolveFirst;
    /** @type {import("vitest").Mock} */
    let fetchMock;

    beforeEach(() => {
      fetchMock = vi.fn().mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
    });

    /** @param {number} call */
    const sentBody = (call) => JSON.parse(fetchMock.mock.calls[call][1].body);

    it("sends the later change in a follow-up request", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const first = updateSettings({ list_sort: "custom" });
      const second = updateSettings({ default_list_id: "list-9" });
      resolveFirst({ ok: true });

      await Promise.all([first, second]);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sentBody(0)).toEqual({ list_sort: "custom" });
      expect(sentBody(1)).toEqual({ default_list_id: "list-9" });
      expect(readPending()).toBeNull();
    });

    it("re-sends a key changed since it was sent", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const first = updateSettings({ list_sort: "custom" });
      const second = updateSettings({ list_sort: "alphabetical" });
      resolveFirst({ ok: true });
      await Promise.all([first, second]);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sentBody(1)).toEqual({ list_sort: "alphabetical" });
      expect(readPending()).toBeNull();
    });

    it("keeps the later change when the first request is rejected", async () => {
      fetchMock
        .mockResolvedValueOnce(okResponse(SERVER_SETTINGS))
        .mockResolvedValueOnce({ ok: true });
      const first = updateSettings({ list_sort: "custom" });
      const second = updateSettings({ default_list_id: "list-9" });
      resolveFirst({ ok: false, status: 404 });
      await Promise.all([first, second]);

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(sentBody(2)).toEqual({ default_list_id: "list-9" });
      expect(readPending()).toBeNull();
      expect(state.appSettings.default_list_id).toBe("list-9");
    });
  });

  it("keeps pending edits over fetched settings while still offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await updateSettings({ default_list_id: "list-2" });

    // GET is answered, PUT still fails (e.g. flaky connection).
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(okResponse(SERVER_SETTINGS))
        .mockResolvedValueOnce(SW_OFFLINE),
    );
    await fetchSettings();
    await flushPendingSettings();

    expect(state.appSettings).toEqual({
      ...SERVER_SETTINGS,
      default_list_id: "list-2",
    });
    expect(readPending()).toEqual({ default_list_id: "list-2" });
  });

  it("does not wait for queued settings to flush", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await updateSettings({ default_list_id: "list-2" });

    /** @type {(response: Object) => void} */
    let resolvePut = () => {};
    const stalledPut = new Promise((resolve) => {
      resolvePut = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) =>
        init?.method === "PUT"
          ? stalledPut
          : Promise.resolve(okResponse(SERVER_SETTINGS)),
      ),
    );

    await fetchSettings();

    expect(state.appSettings).toEqual({
      ...SERVER_SETTINGS,
      default_list_id: "list-2",
    });

    // Settle the background flush so it doesn't leak into later tests.
    resolvePut(SW_OFFLINE);
    expect(await flushPendingSettings()).toBe("queued");
    expect(readPending()).toEqual({ default_list_id: "list-2" });
  });

  it("removes the default list locally when cleared", async () => {
    state.appSettings = { ...DEFAULTS, default_list_id: "list-2" };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await updateSettings({ default_list_id: "" });

    expect(state.appSettings).toEqual(DEFAULTS);
    expect(JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null")).toEqual(
      DEFAULTS,
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      default_list_id: "",
    });
  });

  it("keeps a pending clear when reloading settings offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await updateSettings({ default_list_id: "" });

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(okResponse(SERVER_SETTINGS))
        .mockResolvedValueOnce(SW_OFFLINE),
    );
    await fetchSettings();
    await flushPendingSettings();

    expect(state.appSettings).toEqual({ list_sort: "custom" });
    expect(readPending()).toEqual({ default_list_id: "" });
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

  it("reopens the last viewed list on a later call in the same session", () => {
    recordHidden(Date.now() - 31 * MINUTE);
    localStorage.setItem("tickr_current_list", "list-2");

    expect(getInitialListId()).toBe("list-3");
    expect(getInitialListId()).toBe("list-2");
  });
});
