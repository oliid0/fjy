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
  private invalidations = new Set<(source?: AbortSignal) => void>();
  private transitions = new WeakMap<
    AbortSignal,
    { start: number; latest: number }
  >();
  private owners = new WeakMap<AbortSignal, AbortSignal>();
  revision = 0;
  private activeInteraction?: AbortSignal;
  get interactionSource() {
    return this.activeInteraction;
  }
  /** Internal request scopes explicitly register their parent; model data cannot claim an owner. */
  registerOwner(child: AbortSignal, parent?: AbortSignal) {
    if (!parent || child === parent || child.aborted || parent.aborted) {
      return () => {};
    }
    if (this.owners.has(child) || this.isOwnedBy(parent, child)) {
      throw new Error("COMMAND_OWNER_CONFLICT");
    }
    this.owners.set(child, parent);
    const release = () => {
      if (this.owners.get(child) === parent) {
        this.owners.delete(child);
      }
      child.removeEventListener("abort", release);
      parent.removeEventListener("abort", release);
    };
    child.addEventListener("abort", release, { once: true });
    parent.addEventListener("abort", release, { once: true });
    return release;
  }
  isOwnedBy(source?: AbortSignal, owner?: AbortSignal): boolean {
    if (!source || !owner || owner.aborted) {
      return false;
    }
    for (
      let current: AbortSignal | undefined = source;
      current;
      current = this.owners.get(current)
    ) {
      if (current.aborted) {
        return false;
      }
      if (current === owner) {
        return true;
      }
    }
    return false;
  }
  /** Only synchronous events from this command inherit its exact owner. */
  withInteraction<T>(source: AbortSignal | undefined, dispatch: () => T): T {
    const previous = this.activeInteraction;
    this.activeInteraction = source;
    try {
      return dispatch();
    } finally {
      this.activeInteraction = previous;
    }
  }

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
  touch(source?: AbortSignal) {
    source?.throwIfAborted();
    const before = this.revision;
    this.revision++;
    for (
      let current = source;
      current && !current.aborted;
      current = this.owners.get(current)
    ) {
      const previous = this.transitions.get(current);
      this.transitions.set(current, {
        start: previous?.latest === before ? previous.start : before,
        latest: this.revision,
      });
    }
  }
  isExpectedTransition(source?: AbortSignal) {
    return (
      !!source &&
      !source.aborted &&
      this.transitions.get(source)?.latest === this.revision
    );
  }
  isCurrent(revision: number, source?: AbortSignal) {
    if (source?.aborted) {
      return false;
    }
    const transition = source && this.transitions.get(source);
    return (
      revision === this.revision ||
      (transition?.start === revision && transition.latest === this.revision)
    );
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
  invalidate(source?: AbortSignal) {
    this.touch(source);
    this.invalidations.forEach((listener) => listener(source));
  }
  onInvalidate(listener: (source?: AbortSignal) => void) {
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
  "lesson.resume",
  "canvas.text",
  "canvas.configure",
  "canvas.tool",
  "canvas.ink",
  "canvas.animate",
  "resources.use",
  "resources.generate",
  "resources.inspect",
  "resources.interact",
  "canvas.resource",
  "voice.speak",
  "math.evaluate",
  "language.translate",
  "tools.configure",
  "files.open",
  "document.next",
  "document.previous",
  "document.page",
  "document.close",
  "board.new",
  "board.switch",
  "board.discard",
  "math.calculate",
  "math.plot",
  "insert.object",
  "insert.open",
  "insert.configure",
  "signal.action",
  "web.open",
  "web.action",
  "tools.insert",
  "shapes.insert",
  "ui.inspect",
  "ui.interact",
  "record.start",
  "record.stop",
  "record.pause",
  "record.resume",
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
  const request = text.trim();
  const title = request.match(
    /^(?:请|帮我)?(?:用(?:画笔|钢笔))?(?:板书|写下?|写一个)(?:一个)?(?:标题|题目)\s*[:：]?\s*(.+)$/,
  );
  if (
    title?.[1]?.trim() &&
    !/(?:然后|接着|随后|并且|之后|同时(?:打开|使用|开始|插入|录制))/.test(
      request,
    )
  ) {
    return {
      name: "canvas.text",
      args: {
        text: title[1].trim(),
        presentation: "handwritten",
        placement: "center",
        sourceIds: [],
      },
    };
  }
  const file = request.match(
    /^(?:请|帮我)?(?:打开|切换到)(?:课件|文档|文件)\s*[:：]?\s*[“"「]?(.+?)[”"」]?[。！!]*$/,
  );
  if (
    file?.[1]?.trim() &&
    !/(?:然后|接着|随后|并且|并(?:写|插|用|生成|开始|录))/.test(request)
  ) {
    return { name: "files.open", args: { name: file[1].trim() } };
  }
  if (
    !/(?:然后|接着|随后|并且|之后|并讲解|同时(?:打开|使用|开始|插入|录制))/.test(
      request,
    ) &&
    /^(?:请|帮我)?(?:生成|制作|创建).*(?:html|教学动画|交互(?:动画|实验|图形|资源)|可交互|教学资源)/i.test(
      request,
    )
  ) {
    return { name: "resources.generate", args: { prompt: request } };
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
  const pen = value.match(
    /^(?:请|帮我)?(?:换成|切换到|切换为|改用|换|使用|选择|用)?(?:一支)?(画笔|钢笔|荧光笔|虚线笔|文字笔|图形笔|彩虹笔|魔术笔|算式笔|函数笔|语言笔)$/,
  )?.[1];
  if (pen) {
    const kinds = new Map([
      ["画笔", "hard"],
      ["钢笔", "brush"],
      ["荧光笔", "highlighter"],
      ["虚线笔", "dashed"],
      ["文字笔", "text"],
      ["图形笔", "shape"],
      ["彩虹笔", "rainbow"],
      ["魔术笔", "magic"],
      ["算式笔", "calculation"],
      ["函数笔", "function"],
      ["语言笔", "language"],
    ]);
    return { name: "canvas.style", args: { pen: kinds.get(pen) } };
  }
  if (
    /^(?:请|帮我)?(?:换成|切换到|使用|选择)?(?:选择|圈选|选择工具|套索)$/.test(
      value,
    )
  ) {
    return { name: "canvas.tool", args: { tool: "lasso" } };
  }
  const eraser = value.match(
    /^(?:请|帮我)?(?:换成|切换到|使用|选择|打开)?(局部|对象)?(?:橡皮擦?|擦除)$/,
  )?.[1];
  if (
    eraser ||
    /^(?:请|帮我)?(?:换成|切换到|使用|选择|打开)?橡皮擦?$/.test(value)
  ) {
    return {
      name: "canvas.tool",
      args: {
        tool: "eraser",
        ...(eraser
          ? { eraserMode: eraser === "对象" ? "object" : "stroke" }
          : {}),
      },
    };
  }
  if (/^(?:请|帮我)?(?:清屏|清空画布|擦掉全部内容)$/.test(value)) {
    return { name: "canvas.clear" };
  }
  if (/^(?:请|帮我)?(?:全选|选择全部|选中全部)$/.test(value)) {
    return { name: "canvas.action", args: { action: "selectAll" } };
  }
  if (/^(?:请|帮我)?(?:取消选择|取消圈选)$/.test(value)) {
    return { name: "canvas.select", args: { ids: [] } };
  }
  if (
    /^(?:请|帮我)?(?:复制)(?:圈中|选中|所选|选区)(?:的)?(?:内容|部分|对象)?$/.test(
      value,
    )
  ) {
    return { name: "canvas.action", args: { action: "duplicateSelection" } };
  }
  if (/^(?:请|帮我)?(?:开始|开启|打开)?录制$/.test(value)) {
    return { name: "record.start" };
  }
  if (/^(?:请|帮我)?暂停录制$/.test(value)) {
    return { name: "record.pause" };
  }
  if (/^(?:请|帮我)?继续录制$/.test(value)) {
    return { name: "record.resume" };
  }
  if (/^(?:请|帮我)?(?:打开|查看)(?:课件|文档|文件)$/.test(value)) {
    return { name: "files.open" };
  }
  if (/^(?:请|帮我)?(?:打开|开启|使用)聚光灯$/.test(value)) {
    return { name: "tools.spotlight", args: { open: true } };
  }
  if (/^(?:请|帮我)?(?:关闭|结束)聚光灯$/.test(value)) {
    return { name: "tools.spotlight", args: { open: false } };
  }
  const ruler = value.match(
    /^(?:请|帮我)?(?:插入|添加|创建|打开|使用)(?:一个|一把|个)?(直尺|量角器|圆规|三角板)$/,
  )?.[1];
  if (ruler) {
    return {
      name: "tools.insert",
      args: {
        kind: new Map([
          ["直尺", "ruler"],
          ["量角器", "protractor"],
          ["圆规", "compass"],
          ["三角板", "setSquare"],
        ]).get(ruler),
      },
    };
  }
  if (
    /^(?:请|帮我)?(?:插入|创建|添加)(?:一个|个)?(?:思维导图|思维图)$/.test(
      value,
    )
  ) {
    return { name: "insert.object", args: { kind: "mindmap" } };
  }
  if (/^(?:请|帮我)?(?:插入|创建|添加)(?:一个|个)?表格$/.test(value)) {
    return { name: "insert.object", args: { kind: "table" } };
  }
  const table = value.match(
    /^(?:请|帮我)?(?:插入|创建|添加)(?:一个|个)?([\d一二三四五六七八九十]+)行([\d一二三四五六七八九十]+)列(?:的)?表格$/,
  );
  if (table) {
    const number = (input: string) =>
      /^\d+$/.test(input)
        ? Number(input)
        : [
            "一",
            "二",
            "三",
            "四",
            "五",
            "六",
            "七",
            "八",
            "九",
            "十",
            "十一",
            "十二",
          ].indexOf(input) + 1;
    const rows = number(table[1]);
    const columns = number(table[2]);
    if (rows < 1 || rows > 12 || columns < 1 || columns > 12) {
      return null;
    }
    return {
      name: "insert.object",
      args: {
        kind: "table",
        rows,
        columns,
      },
    };
  }
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
