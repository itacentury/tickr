import { describe, it, expect } from "vitest";
import { groupHistoryByItem, relativeTime } from "./history-model.js";

/** Build a history row with sensible defaults. */
function ev(item_id, action, item_text, timestamp) {
  return { item_id, action, item_text, timestamp };
}

const CATS = [
  { id: "c1", name: "Work", color: "#f06363" },
  { id: "c2", name: "Home", color: "#f5934a" },
];

describe("groupHistoryByItem", () => {
  it("creates one card per item with newest-first events", () => {
    const events = [
      ev("a", "item_completed", "Task A", "2026-06-01T10:00:00Z"),
      ev("a", "item_created", "Task A", "2026-06-01T09:00:00Z"),
    ];
    const items = [
      {
        id: "a",
        text: "Task A",
        completed: true,
        createdAt: "2026-06-01T09:00:00Z",
      },
    ];

    const cards = groupHistoryByItem(events, items, CATS);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: "a", name: "Task A", status: "done" });
    expect(cards[0].events.map((e) => e.type)).toEqual(["completed", "added"]);
    expect(cards[0].lastChanged).toBe("2026-06-01T10:00:00Z");
  });

  it("derives active vs done from the live item's completed flag", () => {
    const items = [
      { id: "a", text: "A", completed: false },
      { id: "b", text: "B", completed: true },
    ];
    const events = [
      ev("a", "item_created", "A", "2026-06-01T09:00:00Z"),
      ev("b", "item_created", "B", "2026-06-01T08:00:00Z"),
    ];
    const cards = groupHistoryByItem(events, items, CATS);
    expect(cards.find((c) => c.id === "a").status).toBe("active");
    expect(cards.find((c) => c.id === "b").status).toBe("done");
  });

  it("marks items with no live doc as deleted", () => {
    const events = [
      ev("a", "item_deleted", "Gone", "2026-06-01T10:00:00Z"),
      ev("a", "item_created", "Gone", "2026-06-01T09:00:00Z"),
    ];
    const cards = groupHistoryByItem(events, [], CATS);
    expect(cards[0]).toMatchObject({ status: "deleted", name: "Gone" });
  });

  it("treats created→deleted→restored→deleted (no live doc) as deleted", () => {
    const events = [
      ev("a", "item_deleted", "X", "2026-06-04T00:00:00Z"),
      ev("a", "item_restored", "X", "2026-06-03T00:00:00Z"),
      ev("a", "item_deleted", "X", "2026-06-02T00:00:00Z"),
      ev("a", "item_created", "X", "2026-06-01T00:00:00Z"),
    ];
    const cards = groupHistoryByItem(events, [], CATS);
    expect(cards[0].status).toBe("deleted");
    expect(cards[0].events.map((e) => e.type)).toEqual([
      "deleted",
      "restored",
      "deleted",
      "added",
    ]);
  });

  it("treats a pending-delete item as deleted even while it is still live", () => {
    const items = [{ id: "a", text: "A", completed: false }];
    const events = [ev("a", "item_created", "A", "2026-06-01T09:00:00Z")];
    const cards = groupHistoryByItem(events, items, CATS, {
      pendingDeleteIds: new Set(["a"]),
    });
    expect(cards[0].status).toBe("deleted");
  });

  it("filters out cards in pendingHideIds", () => {
    const items = [
      { id: "a", text: "A", completed: false },
      { id: "b", text: "B", completed: false },
    ];
    const events = [
      ev("a", "item_created", "A", "2026-06-01T09:00:00Z"),
      ev("b", "item_created", "B", "2026-06-01T08:00:00Z"),
    ];
    const cards = groupHistoryByItem(events, items, CATS, {
      pendingHideIds: new Set(["a"]),
    });
    expect(cards.map((c) => c.id)).toEqual(["b"]);
  });

  it("drops list-level and orphaned (null item_id) events", () => {
    const events = [
      ev(null, "list_created", "My List", "2026-06-01T10:00:00Z"),
      ev(null, "item_deleted", "orphan", "2026-06-01T09:30:00Z"),
      ev("a", "item_created", "A", "2026-06-01T09:00:00Z"),
    ];
    const items = [{ id: "a", text: "A", completed: false }];
    const cards = groupHistoryByItem(events, items, CATS);
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe("a");
  });

  it("resolves the current name from the latest rename when no live doc exists", () => {
    const events = [
      ev("a", "item_renamed", "Second → Third", "2026-06-01T11:00:00Z"),
      ev("a", "item_renamed", "First → Second", "2026-06-01T10:00:00Z"),
      ev("a", "item_created", "First", "2026-06-01T09:00:00Z"),
    ];
    const cards = groupHistoryByItem(events, [], CATS);
    expect(cards[0].name).toBe("Third");
    const rename = cards[0].events[0];
    expect(rename).toMatchObject({
      type: "renamed",
      before: "Second",
      after: "Third",
    });
  });

  it("prefers the live item's text over history-derived names", () => {
    const items = [{ id: "a", text: "Live Name", completed: false }];
    const events = [
      ev("a", "item_renamed", "Old → Stale", "2026-06-01T10:00:00Z"),
    ];
    const cards = groupHistoryByItem(events, items, CATS);
    expect(cards[0].name).toBe("Live Name");
  });

  it("resolves category and accent from the live item", () => {
    const items = [{ id: "a", text: "A", completed: false, categoryId: "c1" }];
    const events = [ev("a", "item_created", "A", "2026-06-01T09:00:00Z")];
    const cards = groupHistoryByItem(events, items, CATS);
    expect(cards[0].category).toEqual({
      id: "c1",
      name: "Work",
      color: "#f06363",
    });
    expect(cards[0].accent).toBe("#f06363");
  });

  it("yields a neutral accent when the category no longer exists", () => {
    const items = [
      { id: "a", text: "A", completed: false, categoryId: "deleted-cat" },
    ];
    const events = [ev("a", "item_created", "A", "2026-06-01T09:00:00Z")];
    const cards = groupHistoryByItem(events, items, CATS);
    expect(cards[0].category).toBeNull();
    expect(cards[0].accent).toBeNull();
  });

  it("treats a cleared category (empty item_text) as none", () => {
    const events = [
      ev("a", "item_category_changed", "", "2026-06-01T10:00:00Z"),
      ev("a", "item_created", "A", "2026-06-01T09:00:00Z"),
    ];
    const cards = groupHistoryByItem(events, [], CATS);
    expect(cards[0].category).toBeNull();
    const change = cards[0].events.find((e) => e.type === "category");
    expect(change.after).toBeNull();
  });

  it("produces no card for a live item with no visible history", () => {
    const items = [
      {
        id: "a",
        text: "A",
        completed: false,
        createdAt: "2026-06-01T09:00:00Z",
      },
    ];
    const cards = groupHistoryByItem([], items, CATS);
    expect(cards).toEqual([]);
  });

  it("orders cards by most recent activity first", () => {
    const events = [
      ev("old", "item_created", "Old", "2026-06-01T09:00:00Z"),
      ev("new", "item_created", "New", "2026-06-05T09:00:00Z"),
    ];
    const cards = groupHistoryByItem(events, [], CATS);
    expect(cards.map((c) => c.id)).toEqual(["new", "old"]);
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-06-14T12:00:00Z").getTime();

  it("returns 'just now' under a minute", () => {
    expect(relativeTime("2026-06-14T11:59:30Z", now)).toBe("just now");
  });

  it("returns minutes ago under an hour", () => {
    expect(relativeTime("2026-06-14T11:37:00Z", now)).toBe("23m ago");
  });

  it("returns hours ago under a day", () => {
    expect(relativeTime("2026-06-14T10:00:00Z", now)).toBe("2h ago");
  });

  it("returns an absolute day/month once older than 24h", () => {
    expect(relativeTime("2026-05-30T12:00:00Z", now)).toBe("30 May");
  });
});
