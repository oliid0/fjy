import voiceVocabulary from "@fcboard/fcboard/locales/data/voiceCommands.json";
import { t } from "@fcboard/fcboard/i18n";

export type Command = { name: string; args?: Record<string, unknown> };
type Handler = (args: Record<string, unknown>) => unknown | Promise<unknown>;
export type CommandContract = {
  parameters?: Record<string, unknown>;
  returns?: string;
};

/** One route for touch controls, voice and model tools. Components own their actions. */
export class CommandRouter {
  private commands = new Map<
    string,
    { description: string; handler: Handler; contract?: CommandContract }
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

  register(
    name: string,
    description: string,
    handler: Handler,
    contract?: CommandContract,
  ) {
    const entry = { description, handler, contract };
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
  definitions() {
    return Array.from(this.commands)
      .filter(([, value]) => value.description !== "@internal")
      .map(([name, value]) => ({
        name,
        description: value.description,
        ...value.contract,
      }));
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
  "agent.start",
  "agent.say",
  "agent.update",
  "agent.wait",
  "quiz.generate",
  "canvas.snapshot",
  "collaboration.start",
  "canvas.text",
  "canvas.configure",
  "canvas.tool",
  "canvas.ink",
  "canvas.animate",
  "resources.use",
  "resources.generate",
  "resources.prepare",
  "resources.inspect",
  "resources.interact",
  "canvas.resource",
  "voice.speak",
  "math.evaluate",
  "language.translate",
  "language.card",
  "tools.configure",
  "files.open",
  "document.next",
  "document.previous",
  "document.page",
  "document.close",
  "board.new",
  "board.switch",
  "board.discard",
  "board.open",
  "math.calculate",
  "math.plot",
  "insert.object",
  "insert.open",
  "insert.configure",
  "mail.action",
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
  let routed =
    signal && isCancellableBoardCommand(command.name)
      ? { ...command, args: { ...command.args, signal } }
      : command;
  if (signal && routed === command) {
    // New public tools receive task ownership without adding a name to a list.
    // Keep metadata out of argument enumeration used by existing validators.
    routed = {
      ...command,
      args: Object.defineProperty({ ...command.args }, "signal", {
        value: signal,
        enumerable: false,
      }),
    };
  }
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

/** Some controls report their terminal state without throwing for manual callers. */
export const verifyBoardCommandResult = (command: Command, result: unknown) => {
  const receipt = result as
    | {
        cancelled?: boolean;
        changed?: boolean;
        boundary?: string;
        phase?: string;
        error?: Parameters<typeof t>[0];
      }
    | undefined;
  if (receipt?.cancelled === true) {
    throw new DOMException("Board operation cancelled", "AbortError");
  }
  if (
    ["board.step", "document.next", "document.previous"].includes(
      command.name,
    ) &&
    receipt?.changed === false
  ) {
    throw new Error(
      t(
        receipt.boundary === "last"
          ? "fcboard.last_page_reached"
          : receipt.boundary === "first"
          ? "fcboard.first_page_reached"
          : "fcboard.command_unavailable_command",
        { command: command.name },
      ),
    );
  }
  if (command.name === "projection.start" && receipt?.phase === "error") {
    throw new Error(t(receipt.error || "projection.connectionError"));
  }
  return result;
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

type VoiceRule = {
  patterns: string[];
  compact: boolean;
  rejectCompound?: boolean;
  command?: Command;
  kind?: string;
};
const voiceRules = (voiceVocabulary.rules as VoiceRule[]).map((rule) => ({
  ...rule,
  patterns: rule.patterns.map((pattern) => new RegExp(pattern, "i")),
}));
const compoundRequests = voiceVocabulary.compound.map(
  (pattern) => new RegExp(pattern, "i"),
);
const voiceWord = (word: string) =>
  (voiceVocabulary.words as Record<string, string>)[word.toLowerCase()];
const voiceNumber = (value: string) =>
  /^\d+$/.test(value)
    ? Number(value)
    : (voiceVocabulary.numbers as Record<string, number>)[value.toLowerCase()];

/** Localized exact labels and unambiguous speech shortcuts share the component routes. */
export const directCommand = (text: string): Command | null => {
  const request = text.trim();
  const compact = request.replace(/[，。！!？?\s]/g, "");
  for (const rule of voiceRules) {
    const input = rule.compact ? compact : request;
    const match = rule.patterns
      .map((pattern) => input.match(pattern))
      .find(Boolean);
    if (
      !match ||
      (rule.rejectCompound &&
        compoundRequests.some((pattern) => pattern.test(request)))
    ) {
      continue;
    }
    if (rule.command) {
      return {
        ...rule.command,
        ...(rule.command.args ? { args: { ...rule.command.args } } : {}),
      };
    }
    const value = match[1]?.trim() || "";
    switch (rule.kind) {
      case "title":
      case "write":
        if (value) {
          return {
            name: "canvas.text",
            args: {
              text: value,
              presentation: "handwritten",
              placement: "center",
              ...(rule.kind === "title"
                ? { role: "title", sourceIds: [] }
                : {}),
            },
          };
        }
        break;
      case "file":
        if (value) {
          return { name: "files.open", args: { name: value } };
        }
        break;
      case "resource":
        return { name: "resources.generate", args: { prompt: request } };
      case "pen":
        return { name: "canvas.style", args: { pen: voiceWord(value) } };
      case "gizmo":
        return { name: "tools.insert", args: { kind: voiceWord(value) } };
      case "eraser":
        return {
          name: "canvas.tool",
          args: {
            tool: "eraser",
            ...(value
              ? {
                  eraserMode: voiceVocabulary.objectEraser.includes(value)
                    ? "object"
                    : "stroke",
                }
              : {}),
          },
        };
      case "table": {
        const rows = voiceNumber(match[1]);
        const columns = voiceNumber(match[2]);
        if (rows >= 1 && rows <= 12 && columns >= 1 && columns <= 12) {
          return {
            name: "insert.object",
            args: { kind: "table", rows, columns },
          };
        }
        return null;
      }
    }
  }
  const labels = [
    ["language_pen", "language"],
    ["function_pen", "function"],
    ["calculation_pen", "calculation"],
    ["magic_pen", "magic"],
    ["rainbow_pen", "rainbow"],
    ["text_pen", "text"],
    ["shape_pen", "shape"],
  ] as const;
  for (const [label, pen] of labels) {
    if (
      request.toLocaleLowerCase() === t(`fcboard.${label}`).toLocaleLowerCase()
    ) {
      return { name: "canvas.style", args: { pen } };
    }
  }
  return null;
};
