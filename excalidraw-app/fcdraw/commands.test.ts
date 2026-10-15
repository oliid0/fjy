import { CommandRouter, directCommand } from "./commands";

describe("component commands", () => {
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
  });
  it("routes common speech to the same controls without model calls", () => {
    expect(directCommand("下一页")).toEqual({ name: "document.next" });
    expect(directCommand("暂停讲解")).toEqual({ name: "lesson.pause" });
    expect(directCommand("帮我新建白板")?.name).toBe("board.new");
    expect(directCommand("帮我画一条经过这些点的抛物线")).toBeNull();
  });
});
