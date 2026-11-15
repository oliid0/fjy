import { defaultLang, setLanguage, t } from "@fcboard/fcboard/i18n";

import votePage from "../../android/app/src/main/assets/vote.html?raw";
import transferPage from "../../android/app/src/main/assets/transfer.html?raw";

import { pageLocalization } from "./pageLocalization";
import { nativeErrorMessage } from "./nativeErrorMessage";

afterEach(async () => {
  await setLanguage(defaultLang);
});

const openPage = (html: string) => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const window = frame.contentWindow as Window & typeof globalThis;
  const doc = window.document;
  doc.open();
  doc.write(
    html.replace(
      "__FCBOARD_PAGE_LOCALIZATION__",
      JSON.stringify(pageLocalization()).replace(/</g, "\\u003c"),
    ),
  );
  doc.close();
  const script = [...doc.scripts].find(
    (node) => node.type !== "application/json",
  )!.textContent!;
  return { frame, window, doc, script };
};

it("renders the actual voting page in Spanish, submits real choices, and follows a later UI locale without losing the ballot", async () => {
  await setLanguage({ code: "es-ES", label: "Spanish" });
  let locale = pageLocalization();
  let selection: number[] = [];
  const view = openPage(votePage);
  const polls: (() => void)[] = [];
  const fetcher = vi.fn(async (_url: string, options?: { body?: string }) => {
    if (options?.body) {
      selection = JSON.parse(options.body).choices;
    }
    return {
      ok: true,
      json: async () => ({
        localization: locale,
        topic: "English classroom topic",
        options: ["A", "B"],
        multiple: false,
        accepting: true,
        participants: selection.length ? 1 : 0,
        counts: [selection.includes(0) ? 1 : 0, 0],
        selection,
      }),
    };
  });
  view.window.fetch = fetcher as unknown as typeof fetch;
  view.window.setInterval = ((callback: () => void) => {
    polls.push(callback);
    return 1;
  }) as unknown as typeof setInterval;
  try {
    view.window.eval(view.script);
    await vi.waitFor(() =>
      expect(view.doc.querySelectorAll("input[name=choice]")).toHaveLength(2),
    );
    expect(view.doc.documentElement.lang).toBe("es-ES");
    expect(view.doc.getElementById("submit")!.textContent).toBe(
      t("fcboard.remotePages.submit"),
    );
    (view.doc.querySelector("input") as HTMLInputElement).click();
    view.doc
      .getElementById("form")!
      .dispatchEvent(new view.window.Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(selection).toEqual([0]));
    await setLanguage({ code: "zh-CN", label: "Chinese" });
    locale = pageLocalization();
    polls[0]();
    await vi.waitFor(() => expect(view.doc.documentElement.lang).toBe("zh-CN"));
    expect(view.doc.getElementById("submit")!.textContent).toBe(
      t("fcboard.remotePages.submit"),
    );
    expect((view.doc.querySelector("input") as HTMLInputElement).checked).toBe(
      true,
    );
    expect(view.doc.getElementById("topic")!.textContent).toBe(
      "English classroom topic",
    );
  } finally {
    view.frame.remove();
  }
});

it("uses the actual Spanish transfer controls and real upload endpoint, preserving the filename", async () => {
  await setLanguage({ code: "es-ES", label: "Spanish" });
  const view = openPage(transferPage);
  const fetcher = vi.fn().mockResolvedValue({ ok: true });
  view.window.fetch = fetcher;
  try {
    view.window.eval(view.script);
    expect(view.doc.documentElement.lang).toBe("es-ES");
    expect(view.doc.getElementById("send")!.textContent).toBe(
      t("fcboard.remotePages.chooseFiles"),
    );
    const picker = view.doc.getElementById("files") as HTMLInputElement;
    const file = new view.window.File(["actual bytes"], "English lesson.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(picker, "files", {
      configurable: true,
      value: [file],
    });
    picker.dispatchEvent(new view.window.Event("change"));
    await vi.waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        "upload?name=English%20lesson.pdf",
        expect.objectContaining({ method: "POST", body: file }),
      ),
    );
    await vi.waitFor(() =>
      expect(view.doc.getElementById("status")!.textContent).toBe(
        t("fcboard.remotePages.sent"),
      ),
    );
  } finally {
    view.frame.remove();
  }
});

it("localizes native error feedback without changing its diagnostic source", async () => {
  const diagnostic = "Error: Cloud speech connection interrupted";
  await setLanguage({ code: "zh-CN", label: "Chinese" });
  expect(nativeErrorMessage(diagnostic)).not.toContain("Cloud speech");
  await setLanguage(defaultLang);
  expect(nativeErrorMessage(diagnostic)).toBe(
    "Cloud speech connection interrupted",
  );
  expect(diagnostic).toBe("Error: Cloud speech connection interrupted");
});
