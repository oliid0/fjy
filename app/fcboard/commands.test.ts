import { CommandRouter, commandObjectIds, directCommand } from "./commands";

describe("component commands", () => {
  it("rejects deleted targets and permits only an explicit empty selection", () => {
    const objects = [{ id: "visible" }, { id: "deleted", isDeleted: true }];
    expect(() => commandObjectIds(["deleted"], objects)).toThrow("deleted");
    expect(() => commandObjectIds([], objects)).toThrow();
    expect([...commandObjectIds([], objects, true)]).toEqual([]);
    expect([...commandObjectIds(["visible", "visible"], objects)]).toEqual([
      "visible",
    ]);
  });
  it("does not remove a replacement command or context during an old cleanup", async () => {
    const router = new CommandRouter();
    const old = router.register("board.new", "new board", () => "old");
    router.register("board.new", "new board", () => "new");
    old();
    expect(await router.execute({ name: "board.new" })).toBe("new");
    const oldContext = router.context("page", () => 1);
    router.context("page", () => 2);
    oldContext();
    expect(router.read("page")).toBe(2);
    router.register("private", "@internal", () => {});
    expect(router.describe()).not.toContain("private");
    expect(router.isPublic("private")).toBe(false);
    expect(router.isPublic("board.new")).toBe(true);
  });
  it("routes common speech to the same controls without model calls", () => {
    expect(directCommand("下一页")).toEqual({ name: "document.next" });
    expect(directCommand("暂停讲解")).toEqual({ name: "lesson.pause" });
    expect(directCommand("帮我新建白板")?.name).toBe("board.new");
    expect(directCommand("帮我画一条经过这些点的抛物线")).toBeNull();
  });
  it("recognizes an explicit interruption without confusing it with a recording or lesson action", () => {
    for (const text of [
      "停止",
      "别说了！",
      "请停一下",
      "Stop.",
      "please stop talking",
      "cancel",
    ]) {
      expect(directCommand(text)).toEqual({ name: "voice.interrupt" });
    }
    expect(directCommand("停止录制")).toEqual({ name: "record.stop" });
    expect(directCommand("停止讲解")).toEqual({ name: "lesson.stop" });
    expect(directCommand("写下 stop")).toMatchObject({
      name: "canvas.text",
      args: { text: "stop" },
    });
  });
  it("preserves literal writing instead of solving or stripping its punctuation", () => {
    expect(directCommand("写一个1+1=2")).toEqual({
      name: "canvas.text",
      args: { text: "1+1=2", presentation: "handwritten", placement: "center" },
    });
    expect(directCommand("请写下 Hello, world! 3.14")).toMatchObject({
      args: { text: "Hello, world! 3.14" },
    });
    expect(directCommand("写下")).toBeNull();
    expect(directCommand("教我写一个函数")).toBeNull();
  });

  it.each([
    ["换成钢笔", { name: "canvas.style", args: { pen: "brush" } }],
    ["使用语言笔", { name: "canvas.style", args: { pen: "language" } }],
    ["选择", { name: "canvas.tool", args: { tool: "lasso" } }],
    [
      "对象橡皮擦",
      { name: "canvas.tool", args: { tool: "eraser", eraserMode: "object" } },
    ],
    [
      "局部擦除",
      { name: "canvas.tool", args: { tool: "eraser", eraserMode: "stroke" } },
    ],
    ["清屏", { name: "canvas.clear" }],
    ["全选", { name: "canvas.action", args: { action: "selectAll" } }],
    ["取消圈选", { name: "canvas.select", args: { ids: [] } }],
    [
      "复制选中的对象",
      { name: "canvas.action", args: { action: "duplicateSelection" } },
    ],
    ["打开课件", { name: "files.open" }],
    [
      "打开课件 牛顿定律.pptx",
      { name: "files.open", args: { name: "牛顿定律.pptx" } },
    ],
    ["开始录制", { name: "record.start" }],
    ["暂停录制", { name: "record.pause" }],
    ["继续录制", { name: "record.resume" }],
    ["使用聚光灯", { name: "tools.spotlight", args: { open: true } }],
    ["使用直尺", { name: "tools.insert", args: { kind: "ruler" } }],
    ["插入思维图", { name: "insert.object", args: { kind: "mindmap" } }],
    [
      "插入三行四列表格",
      { name: "insert.object", args: { kind: "table", rows: 3, columns: 4 } },
    ],
    [
      "生成一个牛顿定律教学动画html",
      {
        name: "resources.generate",
        args: { prompt: "生成一个牛顿定律教学动画html" },
      },
    ],
    [
      "板书标题：牛顿定律",
      {
        name: "canvas.text",
        args: {
          text: "牛顿定律",
          presentation: "handwritten",
          placement: "center",
          sourceIds: [],
        },
      },
    ],
  ])(
    "routes the complete unambiguous request %s into its actual component",
    (text, expected) => {
      expect(directCommand(text as string)).toEqual(expected);
    },
  );

  it("preserves compound tasks for planning and never guesses invalid table dimensions", () => {
    for (const text of [
      "打开课件牛顿定律，然后翻到第二页并开始录制",
      "生成一个教学动画然后讲解",
      "板书标题牛顿定律，接着插入一个表格",
      "插入二十一行四列表格",
      "插入十一二行四列表格",
    ]) {
      expect(directCommand(text)).toBeNull();
    }
  });

  it("adopts only contiguous target transitions owned by the exact active request", () => {
    const router = new CommandRouter();
    const owner = new AbortController();
    const other = new AbortController();
    const start = router.revision;
    router.invalidate(owner.signal);
    router.touch(owner.signal);
    expect(router.isCurrent(start, owner.signal)).toBe(true);
    expect(router.isCurrent(start, other.signal)).toBe(false);
    router.touch();
    expect(router.isExpectedTransition(owner.signal)).toBe(false);
    router.touch(owner.signal);
    expect(router.isCurrent(start, owner.signal)).toBe(false);
    const latest = router.revision;
    owner.abort();
    expect(router.isCurrent(latest, owner.signal)).toBe(false);
    expect(() => router.touch(owner.signal)).toThrow();
  });

  it("exposes an interaction owner only during synchronous dispatch, including exceptions and nested dispatch", async () => {
    const router = new CommandRouter();
    const owner = new AbortController().signal;
    let afterAwait: AbortSignal | undefined;
    const dispatch = router.withInteraction(owner, async () => {
      expect(router.interactionSource).toBe(owner);
      expect(() =>
        router.withInteraction(undefined, () => {
          expect(router.interactionSource).toBeUndefined();
          throw new Error("handler");
        }),
      ).toThrow("handler");
      expect(router.interactionSource).toBe(owner);
      await Promise.resolve();
      afterAwait = router.interactionSource;
    });
    expect(router.interactionSource).toBeUndefined();
    await dispatch;
    expect(afterAwait).toBeUndefined();
  });

  it("propagates only explicitly registered nested task transitions to active ancestors", () => {
    const router = new CommandRouter();
    const voice = new AbortController();
    const assistant = new AbortController();
    const teacher = new AbortController();
    const sibling = new AbortController();
    const releases = [
      router.registerOwner(assistant.signal, voice.signal),
      router.registerOwner(teacher.signal, assistant.signal),
      router.registerOwner(sibling.signal, assistant.signal),
    ];
    const start = router.revision;
    try {
      router.invalidate(teacher.signal);
      expect(router.isOwnedBy(teacher.signal, voice.signal)).toBe(true);
      expect(router.isOwnedBy(teacher.signal, sibling.signal)).toBe(false);
      expect(router.isCurrent(start, assistant.signal)).toBe(true);
      expect(router.isCurrent(start, voice.signal)).toBe(true);
      expect(router.isCurrent(start, sibling.signal)).toBe(false);
      expect(() => router.registerOwner(voice.signal, teacher.signal)).toThrow(
        "COMMAND_OWNER_CONFLICT",
      );
      router.touch();
      router.touch(teacher.signal);
      expect(router.isCurrent(start, assistant.signal)).toBe(false);
      expect(router.isExpectedTransition(assistant.signal)).toBe(true);
      teacher.abort();
      expect(router.isOwnedBy(teacher.signal, assistant.signal)).toBe(false);
      releases[2]();
      expect(router.isOwnedBy(sibling.signal, assistant.signal)).toBe(false);
      assistant.abort();
      expect(router.isOwnedBy(sibling.signal, voice.signal)).toBe(false);
    } finally {
      releases.forEach((release) => release());
    }
  });
});
