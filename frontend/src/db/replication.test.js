// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { toClient, toServer } from "./replication.js";

describe("list converters", () => {
  it("maps a server list to client camelCase", () => {
    expect(
      toClient("lists", {
        id: "l1",
        name: "Work",
        icon: "star",
        item_sort: "created_desc",
        sort_order: 3,
        created_at: "2026-01-01",
        updated_at: "2026-01-02",
        _deleted: 0,
      }),
    ).toEqual({
      id: "l1",
      name: "Work",
      icon: "star",
      itemSort: "created_desc",
      sortOrder: 3,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
      _deleted: false,
    });
  });

  it("applies defaults for missing icon/item_sort/sort_order", () => {
    const result = toClient("lists", { id: "l1", name: "Work" });
    expect(result.icon).toBe("list");
    expect(result.itemSort).toBe("alphabetical");
    expect(result.sortOrder).toBe(0);
    expect(result._deleted).toBe(false);
  });

  it("keeps sort_order of 0 instead of falling back (?? not ||)", () => {
    expect(toClient("lists", { id: "l1", sort_order: 0 }).sortOrder).toBe(0);
  });

  it("maps a client list back to server snake_case", () => {
    expect(
      toServer("lists", {
        id: "l1",
        name: "Work",
        icon: "star",
        itemSort: "created_desc",
        sortOrder: 3,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-02",
        _deleted: false,
      }),
    ).toEqual({
      id: "l1",
      name: "Work",
      icon: "star",
      item_sort: "created_desc",
      sort_order: 3,
      created_at: "2026-01-01",
      updated_at: "2026-01-02",
      _deleted: false,
    });
  });

  it("round-trips a list through server and back", () => {
    const client = {
      id: "l1",
      name: "Work",
      icon: "star",
      itemSort: "created_desc",
      sortOrder: 3,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
      _deleted: false,
    };
    expect(toClient("lists", toServer("lists", client))).toEqual(client);
  });
});

describe("item converters", () => {
  it("maps a server item to client, normalizing booleans", () => {
    expect(
      toClient("items", {
        id: "i1",
        list_id: "l1",
        text: "Buy milk",
        completed: 1,
        category_id: "c1",
        created_at: "2026-01-01",
        updated_at: "2026-01-02",
        completed_at: "2026-01-03",
        _deleted: 0,
      }),
    ).toEqual({
      id: "i1",
      listId: "l1",
      text: "Buy milk",
      completed: true,
      categoryId: "c1",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
      completedAt: "2026-01-03",
      _deleted: false,
    });
  });

  it("defaults categoryId and completedAt to null", () => {
    const result = toClient("items", {
      id: "i1",
      list_id: "l1",
      text: "x",
      completed: 0,
    });
    expect(result.categoryId).toBeNull();
    expect(result.completedAt).toBeNull();
    expect(result.completed).toBe(false);
  });

  it("maps a client item back to server, encoding completed as 1/0", () => {
    expect(
      toServer("items", { id: "i1", listId: "l1", completed: true }),
    ).toMatchObject({ list_id: "l1", completed: 1 });
    expect(
      toServer("items", { id: "i1", listId: "l1", completed: false }).completed,
    ).toBe(0);
  });

  it("round-trips an item through server and back", () => {
    const client = {
      id: "i1",
      listId: "l1",
      text: "Buy milk",
      completed: true,
      categoryId: "c1",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
      completedAt: "2026-01-03",
      _deleted: false,
    };
    expect(toClient("items", toServer("items", client))).toEqual(client);
  });
});

describe("category converters", () => {
  it("maps a server category to client", () => {
    expect(
      toClient("categories", {
        id: "c1",
        list_id: "l1",
        name: "Urgent",
        color: "#ff0000",
        created_at: "2026-01-01",
        updated_at: "2026-01-02",
        _deleted: 0,
      }),
    ).toEqual({
      id: "c1",
      listId: "l1",
      name: "Urgent",
      color: "#ff0000",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
      _deleted: false,
    });
  });

  it("round-trips a category through server and back", () => {
    const client = {
      id: "c1",
      listId: "l1",
      name: "Urgent",
      color: "#ff0000",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
      _deleted: false,
    };
    expect(toClient("categories", toServer("categories", client))).toEqual(
      client,
    );
  });
});

describe("pull handler stale-checkpoint guard", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    // createPullHandler opens the shared SSE stream; stub EventSource so it is
    // inert (jsdom does not provide one).
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener() {}
        close() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("wipes and resyncs when the server returns 410", async () => {
    const resetDatabase = vi.fn();
    vi.doMock("./index.js", () => ({
      resetDatabase,
      CHECKPOINT_RESET_KEY: "tickr_checkpoint_reset",
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 410, ok: false }),
    );

    const { createPullHandler } = await import("./replication.js");
    const pull = createPullHandler("lists", (d) => d);

    await expect(
      pull.handler({ updatedAt: "2026-01-01T00:00:00.000Z", id: "x" }, 100),
    ).rejects.toThrow(/Checkpoint too old for lists/);
    expect(resetDatabase).toHaveBeenCalledOnce();
  });

  it("does not reset on a normal 500 error", async () => {
    const resetDatabase = vi.fn();
    vi.doMock("./index.js", () => ({
      resetDatabase,
      CHECKPOINT_RESET_KEY: "tickr_checkpoint_reset",
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 500, ok: false }),
    );

    const { createPullHandler } = await import("./replication.js");
    const pull = createPullHandler("lists", (d) => d);

    await expect(pull.handler(null, 100)).rejects.toThrow(/Pull failed/);
    expect(resetDatabase).not.toHaveBeenCalled();
  });

  it("clears the checkpoint-reset marker after a successful checkpoint pull", async () => {
    vi.doMock("./index.js", () => ({
      resetDatabase: vi.fn(),
      CHECKPOINT_RESET_KEY: "tickr_checkpoint_reset",
    }));
    sessionStorage.setItem("tickr_checkpoint_reset", "123");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: () => Promise.resolve({ documents: [], checkpoint: null }),
      }),
    );

    const { createPullHandler } = await import("./replication.js");
    const pull = createPullHandler("lists", (d) => d);

    await pull.handler({ updatedAt: "2026-01-01T00:00:00.000Z", id: "x" }, 100);
    expect(sessionStorage.getItem("tickr_checkpoint_reset")).toBeNull();
  });

  it("keeps the checkpoint-reset marker on a checkpoint-less pull", async () => {
    // The page-1 pull right after a reset has no checkpoint; its success does
    // not prove the checkpoint path is healthy, so the once-per-session reset
    // guard must stay armed.
    vi.doMock("./index.js", () => ({
      resetDatabase: vi.fn(),
      CHECKPOINT_RESET_KEY: "tickr_checkpoint_reset",
    }));
    sessionStorage.setItem("tickr_checkpoint_reset", "123");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: () => Promise.resolve({ documents: [], checkpoint: null }),
      }),
    );

    const { createPullHandler } = await import("./replication.js");
    const pull = createPullHandler("lists", (d) => d);

    await pull.handler(null, 100);
    expect(sessionStorage.getItem("tickr_checkpoint_reset")).toBe("123");
  });

  it("sends the checkpoint's issuedAt stamp as issued_at", async () => {
    vi.doMock("./index.js", () => ({
      resetDatabase: vi.fn(),
      CHECKPOINT_RESET_KEY: "tickr_checkpoint_reset",
    }));
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ documents: [], checkpoint: null }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createPullHandler } = await import("./replication.js");
    const pull = createPullHandler("lists", (d) => d);

    await pull.handler(
      {
        updatedAt: "2026-01-01T00:00:00.000Z",
        id: "x",
        issuedAt: "2026-06-09T00:00:00.000Z",
      },
      100,
    );

    const url = new URL(fetchMock.mock.calls[0][0], "http://localhost");
    expect(url.searchParams.get("updated_at")).toBe("2026-01-01T00:00:00.000Z");
    expect(url.searchParams.get("issued_at")).toBe("2026-06-09T00:00:00.000Z");
  });
});

describe("SSE staleness reconnect", () => {
  // Minimal EventSource stub that records constructed instances, registered
  // listeners, and close() calls, and lets a test emit named events.
  class MockEventSource {
    static instances = [];

    constructor(url) {
      this.url = url;
      this.listeners = {};
      this.closed = false;
      MockEventSource.instances.push(this);
    }

    addEventListener(type, cb) {
      (this.listeners[type] ??= []).push(cb);
    }

    close() {
      this.closed = true;
    }

    emit(type, event) {
      for (const cb of this.listeners[type] ?? []) cb(event);
    }
  }

  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.useFakeTimers();
    // Fresh module so the shared SSE singleton state does not leak between tests.
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens a single connection on first stream subscription", async () => {
    const { getCollectionStream } = await import("./replication.js");
    getCollectionStream("lists");
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe("/api/v1/sync/stream");
  });

  it("forces a reconnect when no frame arrives within the stale window", async () => {
    const { getCollectionStream } = await import("./replication.js");
    getCollectionStream("lists");
    expect(MockEventSource.instances).toHaveLength(1);

    vi.advanceTimersByTime(40000);

    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[0].closed).toBe(true);
  });

  it("treats a heartbeat as liveness and skips the reconnect", async () => {
    const { getCollectionStream } = await import("./replication.js");
    getCollectionStream("lists");
    const first = MockEventSource.instances[0];

    vi.advanceTimersByTime(39000);
    first.emit("heartbeat");
    vi.advanceTimersByTime(39000);

    expect(MockEventSource.instances).toHaveLength(1);
    expect(first.closed).toBe(false);
  });
});
