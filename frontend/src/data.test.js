// @vitest-environment jsdom
// jsdom is required because data.js transitively imports dom.js, which queries
// the DOM at module-evaluation time. The sort functions themselves are pure.
import { describe, it, expect, beforeEach } from "vitest";
import { sortItems, sortLists } from "./data.js";
import { state } from "./state.js";

describe("sortItems", () => {
  const items = [
    { text: "banana", createdAt: "2026-01-02" },
    { text: "Apple", createdAt: "2026-01-03" },
    { text: "cherry", createdAt: "2026-01-01" },
  ];

  it("sorts alphabetically, case-insensitive", () => {
    const result = sortItems(items, "alphabetical");
    expect(result.map((i) => i.text)).toEqual(["Apple", "banana", "cherry"]);
  });

  it("sorts alphabetically descending", () => {
    const result = sortItems(items, "alphabetical_desc");
    expect(result.map((i) => i.text)).toEqual(["cherry", "banana", "Apple"]);
  });

  it("sorts by creation date descending (newest first)", () => {
    const result = sortItems(items, "created_desc");
    expect(result.map((i) => i.text)).toEqual(["Apple", "banana", "cherry"]);
  });

  it("sorts by creation date ascending (oldest first)", () => {
    const result = sortItems(items, "created_asc");
    expect(result.map((i) => i.text)).toEqual(["cherry", "banana", "Apple"]);
  });

  it("falls back to alphabetical for an unknown sort option", () => {
    const result = sortItems(items, "nonsense");
    expect(result.map((i) => i.text)).toEqual(["Apple", "banana", "cherry"]);
  });

  it("treats missing createdAt as the empty string", () => {
    const withMissing = [
      { text: "has-date", createdAt: "2026-01-01" },
      { text: "no-date" },
    ];
    const result = sortItems(withMissing, "created_desc");
    expect(result.map((i) => i.text)).toEqual(["has-date", "no-date"]);
  });

  it("does not mutate the input array", () => {
    const input = [...items];
    sortItems(input, "alphabetical");
    expect(input).toEqual(items);
  });
});

describe("sortLists", () => {
  const lists = [
    { name: "Work", createdAt: "2026-01-02", sortOrder: 2 },
    { name: "admin", createdAt: "2026-01-03", sortOrder: 0 },
    { name: "Home", createdAt: "2026-01-01", sortOrder: 1 },
  ];

  beforeEach(() => {
    state.appSettings = { list_sort: "alphabetical" };
  });

  it("sorts alphabetically, case-insensitive", () => {
    state.appSettings.list_sort = "alphabetical";
    expect(sortLists(lists).map((l) => l.name)).toEqual([
      "admin",
      "Home",
      "Work",
    ]);
  });

  it("sorts alphabetically descending", () => {
    state.appSettings.list_sort = "alphabetical_desc";
    expect(sortLists(lists).map((l) => l.name)).toEqual([
      "Work",
      "Home",
      "admin",
    ]);
  });

  it("sorts by creation date descending", () => {
    state.appSettings.list_sort = "created_desc";
    expect(sortLists(lists).map((l) => l.name)).toEqual([
      "admin",
      "Work",
      "Home",
    ]);
  });

  it("sorts by creation date ascending", () => {
    state.appSettings.list_sort = "created_asc";
    expect(sortLists(lists).map((l) => l.name)).toEqual([
      "Home",
      "Work",
      "admin",
    ]);
  });

  it("sorts by custom sortOrder", () => {
    state.appSettings.list_sort = "custom";
    expect(sortLists(lists).map((l) => l.name)).toEqual([
      "admin",
      "Home",
      "Work",
    ]);
  });

  it("defaults to alphabetical when no sort setting is present", () => {
    state.appSettings.list_sort = undefined;
    expect(sortLists(lists).map((l) => l.name)).toEqual([
      "admin",
      "Home",
      "Work",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [...lists];
    sortLists(input);
    expect(input).toEqual(lists);
  });
});
