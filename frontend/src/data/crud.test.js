// @vitest-environment jsdom
// jsdom is required because crud.js transitively imports dom.js, which runs
// document.querySelector(...) at module-eval time (the queries return null
// here, which is harmless). These tests force the catch branches added to the
// deferred-delete CRUD helpers and assert their failure-path fallbacks.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getItemCount,
  markListPendingDelete,
  unmarkListPendingDelete,
  markItemPendingDelete,
  unmarkItemPendingDelete,
} from "./crud.js";
import { state } from "../state.js";
import { showErrorToast } from "../toast.js";
import { reportError } from "../error-reporting.js";
import {
  refreshLists,
  refreshCurrentItems,
  refreshItemCounts,
} from "./subscriptions.js";

vi.mock("../toast.js", () => ({
  showErrorToast: vi.fn(),
  showUndoToast: vi.fn(),
}));

vi.mock("../error-reporting.js", () => ({
  reportError: vi.fn(),
}));

vi.mock("./subscriptions.js", () => ({
  refreshLists: vi.fn(),
  refreshCurrentItems: vi.fn(),
  refreshItemCounts: vi.fn(),
  selectList: vi.fn(),
  subscribeItems: vi.fn(),
}));

/** A fake RxDB whose item query rejects, to drive the catch branches. */
function rejectingDb() {
  return {
    items: {
      find: () => ({ exec: () => Promise.reject(new Error("DB down")) }),
    },
  };
}

/** A fake RxDB whose item query resolves to the given docs. */
function resolvingDb(docs) {
  return {
    items: { find: () => ({ exec: () => Promise.resolve(docs) }) },
  };
}

describe("crud error/catch branches", () => {
  beforeEach(() => {
    state.db = null;
    state.pendingDeletes = {
      lists: new Set(),
      items: new Set(),
      history: new Set(),
    };
    vi.mocked(refreshLists).mockResolvedValue(undefined);
    vi.mocked(refreshCurrentItems).mockResolvedValue(undefined);
    vi.mocked(refreshItemCounts).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("getItemCount falls back to { remaining: 0 } when the query fails", async () => {
    state.db = rejectingDb();

    const result = await getItemCount("list-1");

    expect(result).toEqual({ remaining: 0 });
    expect(reportError).toHaveBeenCalledWith("count items", expect.any(Error));
  });

  it("markListPendingDelete returns null and reports on failure", async () => {
    state.db = rejectingDb();

    const result = await markListPendingDelete("list-1");

    expect(result).toBeNull();
    expect(reportError).toHaveBeenCalledWith("delete list", expect.any(Error));
    expect(showErrorToast).toHaveBeenCalledWith("Failed to delete list");
    // The query threw before any flag was set, so nothing is left pending.
    expect(state.pendingDeletes.lists.size).toBe(0);
  });

  it("markListPendingDelete returns [] (not null) for a successful empty-list delete", async () => {
    // A list with no items succeeds and yields an empty array; this must stay
    // distinct from the null failure sentinel so the caller still shows undo.
    state.db = resolvingDb([]);

    const result = await markListPendingDelete("list-1");

    expect(result).toEqual([]);
    expect(state.pendingDeletes.lists.has("list-1")).toBe(true);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("unmarkListPendingDelete clears pending flags then reports on refresh failure", async () => {
    state.pendingDeletes.lists.add("list-1");
    state.pendingDeletes.items.add("item-1");
    vi.mocked(refreshLists).mockRejectedValue(new Error("refresh failed"));

    await unmarkListPendingDelete("list-1", ["item-1"]);

    // Flags are cleared before the try block, so they go regardless of failure.
    expect(state.pendingDeletes.lists.has("list-1")).toBe(false);
    expect(state.pendingDeletes.items.has("item-1")).toBe(false);
    expect(reportError).toHaveBeenCalledWith("restore list", expect.any(Error));
    expect(showErrorToast).toHaveBeenCalledWith("Failed to restore list");
  });

  it("markItemPendingDelete reports on refresh failure", async () => {
    vi.mocked(refreshCurrentItems).mockRejectedValue(
      new Error("refresh failed"),
    );

    await markItemPendingDelete("item-1");

    expect(state.pendingDeletes.items.has("item-1")).toBe(true);
    expect(reportError).toHaveBeenCalledWith("delete item", expect.any(Error));
    expect(showErrorToast).toHaveBeenCalledWith("Failed to delete item");
  });

  it("unmarkItemPendingDelete reports on refresh failure", async () => {
    state.pendingDeletes.items.add("item-1");
    vi.mocked(refreshCurrentItems).mockRejectedValue(
      new Error("refresh failed"),
    );

    await unmarkItemPendingDelete("item-1");

    expect(state.pendingDeletes.items.has("item-1")).toBe(false);
    expect(reportError).toHaveBeenCalledWith("restore item", expect.any(Error));
    expect(showErrorToast).toHaveBeenCalledWith("Failed to restore item");
  });
});
