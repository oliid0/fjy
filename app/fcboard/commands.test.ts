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
});
