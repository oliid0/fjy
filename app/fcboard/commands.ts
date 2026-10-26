import { t } from "@excalidraw/excalidraw/i18n";

export type Command = { name: string; args?: Record<string, unknown> };
type Handler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

/** One route for touch controls, voice and model tools. Components own their actions. */
export class CommandRouter {
  private commands = new Map<
    string,
    { description: string; handler: Handler }
  >();
  private contexts = new Map<string, () => unknown>();
  private contextListeners = new Map<string, Set<() => void>>();
  private invalidations = new Set<() => void>();
  revision = 0;

  register(name: string, description: string, handler: Handler) {
    const entry = { description, handler };
    this.commands.set(name, entry);
    return () => {
      if (this.commands.get(name) === entry) {
        this.commands.delete(name);
      }
    };
  }
  context(name: string, read: () => unknown) {
    this.contexts.set(name, read);
    this.changed(name);
    return () => {
      if (this.contexts.get(name) === read) {
        this.contexts.delete(name);
        this.changed(name);
      }
    };
  }
  changed(name: string) {
    this.contextListeners.get(name)?.forEach((listener) => listener());
  }
  watch(name: string, listener: () => void) {
    const listeners = this.contextListeners.get(name) || new Set<() => void>();
    this.contextListeners.set(name, listeners);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
  describe() {
    return Array.from(
      new Map(
        Array.from(this.commands).filter(
          ([, value]) => value.description !== "@internal",
        ),
      ),
      ([name, value]) => `${name}: ${value.description}`,
    ).join("\n");
  }
  touch() {
    this.revision++;
  }
  has(name: string) {
    return this.commands.has(name);
  }
  isPublic(name: string) {
    const entry = this.commands.get(name);
    return !!entry && entry.description !== "@internal";
  }
  snapshot() {
    return Object.fromEntries(
      Array.from(this.contexts, ([name, read]) => [name, read()]),
    );
  }
  read(name: string) {
    return this.contexts.get(name)?.();
  }
  async execute(command: Command) {
    const entry = this.commands.get(command.name);
    if (!entry) {
      throw new Error(
        t("fcboard.command_unavailable_command", { command: command.name }),
      );
    }
    return entry.handler(command.args || {});
  }
  invalidate() {
    this.revision++;
    this.invalidations.forEach((listener) => listener());
  }
  onInvalidate(listener: () => void) {
    this.invalidations.add(listener);
    return () => {
      this.invalidations.delete(listener);
    };
  }
}

export const classroomCommands = new CommandRouter();

const cancellable = new Set([
  "lesson.ask",
  "lesson.teach",
  "canvas.text",
  "canvas.configure",
  "canvas.ink",
  "resources.use",
  "resources.generate",
  "resources.inspect",
  "resources.interact",
  "canvas.resource",
  "voice.speak",
  "math.evaluate",
  "tools.configure",
]);
export const isCancellableBoardCommand = (name: string) =>
  cancellable.has(name);

/** Voice and lesson tools share cancellation and the same component-owned handlers. */
export const executeBoardCommand = (command: Command, signal?: AbortSignal) => {
  signal?.throwIfAborted();
  const routed =
    signal && isCancellableBoardCommand(command.name)
      ? { ...command, args: { ...command.args, signal } }
      : command;
  if (!signal) {
    return classroomCommands.execute(routed);
  }
  return new Promise<unknown>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Board operation cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    classroomCommands.execute(routed).then(
      (result) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) {
          abort();
        } else {
          resolve(result);
        }
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
};

/** Validate the entire target set before an agent command changes any object. */
export const commandObjectIds = (
  input: unknown,
  objects: readonly { id: string; isDeleted?: boolean }[],
  allowEmpty = false,
) => {
  if (
    !Array.isArray(input) ||
    input.length > 3000 ||
    !input.every((id) => typeof id === "string" && id.length > 0)
  ) {
    throw new Error(t("fcboard.invalid_selection_format"));
  }
  if (!allowEmpty && !input.length) {
    throw new Error(t("fcboard.select_an_object_first"));
  }
  const available = new Set(
    objects.filter((object) => !object.isDeleted).map((object) => object.id),
  );
  const missing = input.filter((id) => !available.has(id));
  if (missing.length) {
    throw new Error(
      t("fcboard.objects_are_missing_or_deleted_ids", {
        ids: missing.slice(0, 10).join(", "),
      }),
    );
  }
  return new Set<string>(input);
};

/** Frequent unambiguous commands remain instant and work without a cloud model. */
export const directCommand = (text: string): Command | null => {
  if (
    /^(?:(?:please\s+)?(?:stop|cancel|stop talking)|(?:请)?(?:停止|取消|别说了|停下|停一下|等一下))[。.!！?？\s]*$/i.test(
      text.trim(),
    )
  ) {
    return { name: "voice.interrupt" };
  }
  const written = text
    .trim()
    .match(/^(?:请|帮我)?(?:写下|写上|写一个|写个|写[：:])\s*([\s\S]+)$/);
  if (written?.[1].trim()) {
    return {
      name: "canvas.text",
      args: {
        text: written[1].trim(),
        presentation: "handwritten",
        placement: "center",
      },
    };
  }
  const value = text.replace(/[，。！!？?\s]/g, "");
  if (/^(?:帮我)?(?:新建|创建)$/.test(value)) {
    return { name: "board.new" };
  }
  if (/^(?:清空|擦净)(?:当前|这块)?白板$/.test(value)) {
    return { name: "canvas.clear" };
  }
  if (/^(?:停止|结束)录制$/.test(value)) {
    return { name: "record.stop" };
  }
  if (/^(?:开启|打开)(?:快传|一键上屏|局域网快传)$/.test(value)) {
    return { name: "files.receive", args: { enabled: true } };
  }
  if (/^(?:关闭|停止)(?:快传|一键上屏|局域网快传)$/.test(value)) {
    return { name: "files.receive", args: { enabled: false } };
  }
  if (/^(?:关闭浮层|关闭总结|关闭设置)$/.test(value)) {
    return { name: "panel.close" };
  }
  if (/^(?:帮我)?放大$/.test(value)) {
    return { name: "canvas.action", args: { action: "zoomIn" } };
  }
  if (/^(?:帮我)?缩小$/.test(value)) {
    return { name: "canvas.action", args: { action: "zoomOut" } };
  }
  if (
    /^(?:选|我选|答案是|第)([A-Fa-f1-6一二三四五六])(?:个|项)?$/.test(value)
  ) {
    const choice = value.match(/([A-Fa-f1-6一二三四五六])(?:个|项)?$/)![1];
    const index = /[A-Fa-f]/.test(choice)
      ? choice.toUpperCase().charCodeAt(0) - 65
      : /[1-6]/.test(choice)
      ? Number(choice) - 1
      : "一二三四五六".indexOf(choice);
    return { name: "lesson.answer", args: { index } };
  }
  if (/^(?:帮我)?(?:新建|创建|新增)(?:一[块张个])?(?:白板|板)$/.test(value)) {
    return { name: "board.new" };
  }
  if (/^(?:下一页|下一张|往后翻)$/.test(value)) {
    return { name: "document.next" };
  }
  if (/^(?:上一页|上一张|往前翻)$/.test(value)) {
    return { name: "document.previous" };
  }
  if (/^(?:开启|打开|开始)板书$/.test(value)) {
    return { name: "document.ink", args: { enabled: true } };
  }
  if (/^(?:关闭|结束)板书$/.test(value)) {
    return { name: "document.ink", args: { enabled: false } };
  }
  if (/^(?:暂停|停一下|等一下)(?:讲解|讲课|课程)?$/.test(value)) {
    return { name: "lesson.pause" };
  }
  if (/^(?:继续|继续讲|继续讲课|继续讲解)$/.test(value)) {
    return { name: "lesson.resume" };
  }
  if (/^(?:结束|关闭|停止)(?:讲解|讲课|课程)$/.test(value)) {
    return { name: "lesson.stop" };
  }
  if (/^(?:继续|打开)(?:上次|上一节)(?:的)?(?:课|课程|讲解)$/.test(value)) {
    return { name: "lesson.reopen" };
  }
  if (/^(?:撤销|撤回)$/.test(value)) {
    return { name: "canvas.action", args: { action: "undo" } };
  }
  if (/^(?:重做|恢复上一步)$/.test(value)) {
    return { name: "canvas.action", args: { action: "redo" } };
  }
  if (
    /^(?:擦掉|删除|消除)(?:圈中|选中|所选|选区)(?:的)?(?:内容|部分|对象)?$/.test(
      value,
    )
  ) {
    return { name: "canvas.erase" };
  }
  if (/^(?:关闭课件|关闭预览|返回白板)$/.test(value)) {
    return { name: "document.close" };
  }
  if (/^(?:保存白板|保存这块板)$/.test(value)) {
    return { name: "board.save" };
  }
  return null;
};
