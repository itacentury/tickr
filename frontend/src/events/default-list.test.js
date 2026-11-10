// @vitest-environment jsdom
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { state } from "../state.js";
import * as dom from "../dom.js";
import {
  fetchSettings,
  isAppIdle,
  recordHidden,
  resolveDefaultListId,
  selectList,
  updateSettings,
} from "../data.js";
import { reportError } from "../error-reporting.js";
import { showErrorToast } from "../toast.js";
import { saveDefaultListChoice, wireDefaultList } from "./default-list.js";

vi.mock("../data.js", () => ({
  fetchSettings: vi.fn(),
  isAppIdle: vi.fn(),
  recordHidden: vi.fn(),
  resolveDefaultListId: vi.fn(),
  selectList: vi.fn(),
  subscribeLists: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("../dom.js", () => ({
  addItemInput: { value: "" },
  editListDefault: { checked: false },
}));

vi.mock("../toast.js", () => ({ showErrorToast: vi.fn() }));
vi.mock("../error-reporting.js", () => ({ reportError: vi.fn() }));

const CURRENT_ID = "list-current";
const DEFAULT_ID = "list-default";

/**
 * Fire a visibilitychange event and wait for the async handler to settle.
 *
 * @param {DocumentVisibilityState} visibility
 */
async function changeVisibility(visibility) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(visibility);
  document.dispatchEvent(new Event("visibilitychange"));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("handleResume", () => {
  beforeAll(() => {
    wireDefaultList();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    state.currentListId = CURRENT_ID;
    dom.addItemInput.value = "";
    document.body.replaceChildren();
    vi.mocked(isAppIdle).mockReturnValue(true);
    vi.mocked(fetchSettings).mockResolvedValue(undefined);
    vi.mocked(resolveDefaultListId).mockReturnValue(DEFAULT_ID);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records the hide time when hidden", async () => {
    await changeVisibility("hidden");

    expect(recordHidden).toHaveBeenCalledOnce();
    expect(fetchSettings).not.toHaveBeenCalled();
  });

  it("does nothing when the app was not idle", async () => {
    vi.mocked(isAppIdle).mockReturnValue(false);

    await changeVisibility("visible");

    expect(fetchSettings).not.toHaveBeenCalled();
    expect(selectList).not.toHaveBeenCalled();
  });

  it("opens the default list after an idle period", async () => {
    await changeVisibility("visible");

    expect(selectList).toHaveBeenCalledWith(DEFAULT_ID);
  });

  it("keeps the current list when it already is the default", async () => {
    vi.mocked(resolveDefaultListId).mockReturnValue(CURRENT_ID);

    await changeVisibility("visible");

    expect(selectList).not.toHaveBeenCalled();
  });

  it("keeps the current list when no default is set", async () => {
    vi.mocked(resolveDefaultListId).mockReturnValue(null);

    await changeVisibility("visible");

    expect(selectList).not.toHaveBeenCalled();
  });

  it.each([".modal.open", ".history-panel.open"])(
    "does not switch under an open %s",
    async (selector) => {
      const [, ...classes] = selector.split(".");
      const element = document.createElement("div");
      element.classList.add(...classes);
      document.body.append(element);

      await changeVisibility("visible");

      expect(selectList).not.toHaveBeenCalled();
    },
  );

  it("does not switch with an unsent add-item draft", async () => {
    dom.addItemInput.value = "milk";

    await changeVisibility("visible");

    expect(selectList).not.toHaveBeenCalled();
  });

  it("keeps a list the user picked while settings were loading", async () => {
    vi.mocked(fetchSettings).mockImplementation(async () => {
      state.currentListId = "list-picked";
    });

    await changeVisibility("visible");

    expect(selectList).not.toHaveBeenCalled();
  });

  it("reports a failed settings fetch", async () => {
    vi.mocked(fetchSettings).mockRejectedValue(new Error("boom"));

    await changeVisibility("visible");

    expect(reportError).toHaveBeenCalledOnce();
    expect(selectList).not.toHaveBeenCalled();
  });
});

describe("saveDefaultListChoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateSettings).mockResolvedValue(true);
  });

  it.each([
    { current: CURRENT_ID, checked: true },
    { current: DEFAULT_ID, checked: false },
  ])(
    "sends nothing when unchanged (default $current, checked $checked)",
    async ({ current, checked }) => {
      state.appSettings = { list_sort: "custom", default_list_id: current };
      dom.editListDefault.checked = checked;

      await saveDefaultListChoice(CURRENT_ID);

      expect(updateSettings).not.toHaveBeenCalled();
    },
  );

  it("makes the edited list the default when ticked", async () => {
    state.appSettings = { list_sort: "custom", default_list_id: DEFAULT_ID };
    dom.editListDefault.checked = true;

    await saveDefaultListChoice(CURRENT_ID);

    expect(updateSettings).toHaveBeenCalledWith({
      default_list_id: CURRENT_ID,
    });
  });

  it("clears the default when the current default is unticked", async () => {
    state.appSettings = { list_sort: "custom", default_list_id: CURRENT_ID };
    dom.editListDefault.checked = false;

    await saveDefaultListChoice(CURRENT_ID);

    expect(updateSettings).toHaveBeenCalledWith({ default_list_id: "" });
  });

  it("shows an error toast when saving fails", async () => {
    state.appSettings = { list_sort: "custom" };
    dom.editListDefault.checked = true;
    vi.mocked(updateSettings).mockResolvedValue(false);

    await saveDefaultListChoice(CURRENT_ID);

    expect(showErrorToast).toHaveBeenCalledOnce();
  });
});
