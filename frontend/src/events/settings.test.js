import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { settingsRejected$ } from "../bus.js";
import { showErrorToast } from "../toast.js";
import { wireSettingsRejectedToast } from "./settings.js";

vi.mock("../data.js", () => ({
  flushPendingSettings: vi.fn(),
  updateSettings: vi.fn(),
}));
vi.mock("../dom.js", () => ({}));
vi.mock("../auth.js", () => ({ logout: vi.fn() }));
vi.mock("../toast.js", () => ({ showErrorToast: vi.fn() }));
vi.mock("../error-reporting.js", () => ({ reportError: vi.fn() }));

describe("wireSettingsRejectedToast", () => {
  beforeAll(() => {
    wireSettingsRejectedToast();
  });

  beforeEach(() => {
    vi.mocked(showErrorToast).mockClear();
  });

  it("names the default list when only it was rejected", () => {
    settingsRejected$.next(["default_list_id"]);

    expect(showErrorToast).toHaveBeenCalledExactlyOnceWith(
      "Failed to update default list",
    );
  });

  it.each([[["list_sort"]], [["list_sort", "default_list_id"]]])(
    "shows the generic message for %j",
    (rejectedKeys) => {
      settingsRejected$.next(rejectedKeys);

      expect(showErrorToast).toHaveBeenCalledExactlyOnceWith(
        "Failed to update settings",
      );
    },
  );
});
