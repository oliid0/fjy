import { classroomSummaryMessages } from "./classroomSummary";
import { classroomCommands } from "./commands";
import { sceneAPI } from "./test/scene";
import * as ai from "./ai";

import type { Workspace } from "./boards";

const setup = (count: number) => {
  const api = sceneAPI();
  const pages = Array.from({ length: count + 1 }, (_, i) => ({
    id: `page-${i}`,
    name: `白板 ${i + 1}`,
    elements: api.getSceneElements(),
    files: {},
    view: {
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 },
      viewBackgroundColor: "#fff",
    },
    updated: i,
  }));
  const ids = pages.slice(0, count).map((page) => page.id);
  const unread = classroomCommands.context("classroom.scope", () => ({
    boards: ids,
  }));
  const unpages = classroomCommands.register(
    "board.pages",
    "@internal",
    () => ({ active: ids.at(-1), boards: pages } as Workspace),
  );
  const read = vi
    .spyOn(ai, "boardContext")
    .mockImplementation(async (source) => ({
      elements: source.getSceneElements(),
      text: "已保存页的定律推导",
      image: "data:image/png;base64,page",
    }));
  return {
    api,
    ids,
    read,
    stop: () => {
      unread();
      unpages();
    },
  };
};
afterEach(() => vi.restoreAllMocks());
it("includes every page actually used by the lesson, ignores unrelated pages and does not navigate", async () => {
  const host = setup(3);
  try {
    const messages = await classroomSummaryMessages(host.api, {
      elements: host.api.getSceneElements(),
      text: "当前第三页结论",
      image: "data:image/png;base64,current",
    });
    expect(messages).toHaveLength(3);
    expect(JSON.stringify(messages)).toContain("白板 1");
    expect(JSON.stringify(messages)).toContain("当前第三页结论");
    expect(JSON.stringify(messages)).not.toContain("白板 4");
    expect(host.read).toHaveBeenCalledTimes(2);
    expect(host.api.updateScene).not.toHaveBeenCalled();
  } finally {
    host.stop();
  }
});
it("batches long classes without omitting earlier pages or sending unlimited page images", async () => {
  const host = setup(6);
  const chat = vi
    .spyOn(ai, "chat")
    .mockResolvedValueOnce("前四页推导")
    .mockResolvedValueOnce("最后两页结论");
  try {
    const messages = await classroomSummaryMessages(host.api, {
      elements: [],
      text: "第六页",
      image: undefined,
    });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[0][0]).toHaveLength(5);
    expect(chat.mock.calls[1][0]).toHaveLength(3);
    expect(JSON.stringify(messages)).toContain("前四页推导");
    expect(JSON.stringify(messages)).toContain("最后两页结论");
  } finally {
    host.stop();
  }
});
it("stops collecting an obsolete class after manual navigation", async () => {
  const host = setup(3);
  host.read.mockImplementationOnce(async (source) => {
    classroomCommands.invalidate();
    return {
      elements: source.getSceneElements(),
      text: "旧页",
      image: undefined,
    };
  });
  try {
    await expect(
      classroomSummaryMessages(host.api, {
        elements: [],
        text: "当前",
        image: undefined,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  } finally {
    host.stop();
  }
});
