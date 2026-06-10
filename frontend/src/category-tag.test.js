import { describe, it, expect } from "vitest";
import { parseCategoryTag, detectTrigger, formatTag } from "./category-tag.js";

describe("parseCategoryTag", () => {
  it("returns empty result for blank input", () => {
    expect(parseCategoryTag("   ")).toEqual({
      cleanText: "",
      categoryName: null,
    });
  });

  it("parses a bare trailing tag", () => {
    expect(parseCategoryTag("Buy milk #Groceries")).toEqual({
      cleanText: "Buy milk",
      categoryName: "Groceries",
    });
  });

  it("parses a quoted trailing tag with spaces", () => {
    expect(parseCategoryTag('Buy milk #"To Do Soon"')).toEqual({
      cleanText: "Buy milk",
      categoryName: "To Do Soon",
    });
  });

  it("returns no category when there is no tag", () => {
    expect(parseCategoryTag("Buy milk")).toEqual({
      cleanText: "Buy milk",
      categoryName: null,
    });
  });

  it("treats an unclosed quoted form as literal text", () => {
    // `#"Foo` is not a valid bareword (bare excludes `"`), so it stays literal.
    expect(parseCategoryTag('Buy milk #"Foo')).toEqual({
      cleanText: 'Buy milk #"Foo',
      categoryName: null,
    });
  });

  it("trims surrounding whitespace from the category name", () => {
    expect(parseCategoryTag("Task   #Work   ")).toEqual({
      cleanText: "Task",
      categoryName: "Work",
    });
  });

  it("requires whitespace before the hash (no inline #)", () => {
    expect(parseCategoryTag("a#b")).toEqual({
      cleanText: "a#b",
      categoryName: null,
    });
  });
});

describe("detectTrigger", () => {
  it("detects an active bare hash at end", () => {
    expect(detectTrigger("Buy milk #")).toEqual({ prefix: "", start: 9 });
  });

  it("detects a hash with a partial prefix", () => {
    expect(detectTrigger("Buy milk #Gro")).toEqual({ prefix: "Gro", start: 9 });
  });

  it("detects a hash at the very start", () => {
    expect(detectTrigger("#Gro")).toEqual({ prefix: "Gro", start: 0 });
  });

  it("returns null when the token is already committed", () => {
    expect(detectTrigger("Buy milk #Gro ")).toBeNull();
  });

  it("returns null when there is no hash", () => {
    expect(detectTrigger("Buy milk")).toBeNull();
  });

  it("returns null when a quote follows the hash", () => {
    expect(detectTrigger('Buy milk #"Gro')).toBeNull();
  });
});

describe("formatTag", () => {
  it("uses the bare form for single-word names", () => {
    expect(formatTag("Groceries")).toBe("#Groceries");
  });

  it("quotes names containing whitespace", () => {
    expect(formatTag("To Do Soon")).toBe('#"To Do Soon"');
  });
});
