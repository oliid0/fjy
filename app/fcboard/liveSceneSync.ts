import { getDataURL, dataURLToFile } from "@fcboard/fcboard/data/blob";

import type { FcboardImperativeAPI } from "@fcboard/fcboard/types";

import { classroomCommands } from "./commands";
import { documentSharing } from "./documentSharing";
import { SceneSync } from "./sceneSync";
import { SharedDocumentScene } from "./sharedDocumentScene";

import type { SharedDocumentSource } from "./documentSharing";
import type { ScenePacket, SharedDocument } from "./sceneSync";

/** The same room follows the host's board or original, editable courseware. */
export class LiveSceneSync {
  private scene: SceneSync;
  private boardId = "";
  private scope = "";
  private epoch = -1;
  private owner = false;
  private started = false;
  private disposed = false;
  private stop?: () => void;
  private document?: SharedDocument;
  private file?: File;
  private generation = 0;
  private receivedEpoch = -1;
  private receiving = 0;
  private lifetime = new AbortController();
  private incoming: Promise<void> = Promise.resolve();
  private outgoing: Promise<void> = Promise.resolve();
  private sentDocument = "";
  private assets = new Map<string, File>();
  private encoded = new WeakMap<File, Promise<string>>();

  constructor(
    private api: FcboardImperativeAPI,
    private send: (packet: ScenePacket) => Promise<void>,
    private onError: (error: unknown) => void,
  ) {
    this.scene = this.createScene();
  }

  private createScene(
    source?: SharedDocumentSource,
    descriptor?: SharedDocument,
  ) {
    const file = source?.file;
    const page = source?.page;
    const target = source
      ? new SharedDocumentScene(this.api, () => {
          const current = documentSharing.current();
          return current && current.file === file && current.page === page
            ? current
            : undefined;
        }).api
      : this.api;
    return new SceneSync(
      target,
      (packet) => {
        const operation = this.outgoing
          .catch(() => {})
          .then(async () => {
            if (
              this.disposed ||
              (this.owner && packet.page?.epoch !== this.epoch)
            ) {
              return;
            }
            const document = descriptor
              ? {
                  ...descriptor,
                  ...(!this.owner || this.sentDocument === descriptor.id
                    ? { dataURL: undefined }
                    : {}),
                }
              : undefined;
            await this.send({ ...packet, ...(document ? { document } : {}) });
            if (this.owner && document?.dataURL) {
              this.sentDocument = document.id;
            }
          });
        this.outgoing = operation;
        return operation;
      },
      this.onError,
    );
  }

  hostPage(id: string) {
    this.owner = true;
    this.boardId = id;
    if (documentSharing.current()) {
      if (!this.scope) {
        this.scope = id;
        this.scene.hostPage(id, ++this.epoch);
      }
      if (this.started) {
        void this.refreshHost().catch(this.onError);
      }
      return false;
    }
    if (this.scope === id) {
      return false;
    }
    this.selectHost(undefined);
    return true;
  }

  initialize(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.owner && documentSharing.current()) {
      return this.refreshHost().then(() => signal?.throwIfAborted());
    }
  }

  private selectHost(
    source?: SharedDocumentSource,
    descriptor?: SharedDocument,
  ) {
    const scope = source
      ? `document:${source.id}:${source.page}`
      : this.boardId;
    if (scope === this.scope) {
      return;
    }
    this.scene.dispose();
    this.file = source?.file;
    this.document = descriptor;
    this.scope = scope;
    this.scene = this.createScene(source, descriptor);
    this.scene.hostPage(scope, ++this.epoch);
    if (this.started) {
      this.scene.start();
      this.scene.flush(true);
    }
  }

  private async refreshHost() {
    const source = documentSharing.current();
    if (!source) {
      this.generation++;
      this.selectHost();
      return;
    }
    if (!source.ready) {
      return;
    }
    if (this.scope === `document:${source.id}:${source.page}`) {
      if (
        this.document &&
        JSON.stringify(this.document.view) !== JSON.stringify(source.view)
      ) {
        this.document.view = source.view;
        this.scene.flush(true);
      }
      return;
    }
    const generation = ++this.generation;
    let encoded = this.encoded.get(source.file);
    if (!encoded) {
      encoded = getDataURL(source.file);
      this.encoded.set(source.file, encoded);
    }
    const dataURL = await encoded;
    const current = documentSharing.current();
    if (
      this.disposed ||
      generation !== this.generation ||
      !current?.ready ||
      current.id !== source.id ||
      current.page !== source.page
    ) {
      return;
    }
    this.selectHost(current, {
      id: current.id,
      name: current.file.name,
      mimeType: current.file.type,
      page: current.page,
      dataURL,
      view: current.view,
    });
  }

  snapshot() {
    return {
      ...this.scene.snapshot(),
      ...(this.document ? { document: this.document } : {}),
    };
  }

  start() {
    this.started = true;
    this.scene.start();
    this.stop = documentSharing.watch(() => {
      if (this.owner) {
        void this.refreshHost().catch(this.onError);
      } else if (!this.disposed && this.document) {
        const source = documentSharing.current();
        if (
          source &&
          source.file === this.file &&
          source.ready &&
          source.page !== this.document.page
        ) {
          void source.navigate(this.document.page).catch(this.onError);
        }
      }
    });
  }

  flush(full = false) {
    if (this.receiving) {
      return;
    }
    if (this.file) {
      const source = documentSharing.current();
      if (
        source?.file !== this.file ||
        !source.ready ||
        source.page !== this.document?.page
      ) {
        return;
      }
    } else if (documentSharing.current()) {
      return;
    }
    this.scene.flush(full);
  }

  receive(packet: ScenePacket, replace = false) {
    if (this.disposed) {
      return;
    }
    const epoch = packet.page?.epoch ?? 0;
    if (!this.owner && epoch < this.receivedEpoch) {
      return;
    }
    this.receivedEpoch = Math.max(this.receivedEpoch, epoch);
    if (!packet.document && !this.file && !this.receiving) {
      this.scene.receive(packet, replace);
      return;
    }
    this.receiving++;
    this.incoming = this.incoming
      .catch(() => {})
      .then(async () => {
        if (this.disposed || (!this.owner && epoch < this.receivedEpoch)) {
          return;
        }
        if (!this.owner && packet.document) {
          const descriptor = packet.document;
          if (
            !descriptor.id ||
            !descriptor.name ||
            !Number.isSafeInteger(descriptor.page) ||
            descriptor.page < 0
          ) {
            throw new Error("Invalid shared document");
          }
          let file = this.assets.get(descriptor.id);
          if (!file) {
            if (!descriptor.dataURL?.startsWith("data:")) {
              throw new Error("Shared document content is missing");
            }
            file = dataURLToFile(
              descriptor.dataURL as Parameters<typeof dataURLToFile>[0],
              descriptor.name,
            );
            this.assets.set(descriptor.id, file);
            if (this.assets.size > 3) {
              this.assets.delete(this.assets.keys().next().value!);
            }
          }
          if (documentSharing.current()?.file !== file) {
            await classroomCommands.execute({
              name: "document.share.open",
              args: { file, signal: this.lifetime.signal },
            });
          }
          const source = documentSharing.current();
          if (!source?.ready || source.file !== file) {
            throw new Error("Shared document could not be opened");
          }
          if (source.page !== descriptor.page) {
            await source.navigate(descriptor.page);
          }
          if (this.disposed || epoch < this.receivedEpoch) {
            return;
          }
          if (this.scope !== packet.page?.id || this.epoch !== epoch) {
            this.scene.dispose();
            this.file = file;
            this.document = descriptor;
            this.scope = packet.page?.id || "";
            this.epoch = epoch;
            this.scene = this.createScene(
              documentSharing.current(),
              descriptor,
            );
            if (this.started) {
              this.scene.start();
            }
          }
          documentSharing.follow(true);
          if (descriptor.view) {
            const view = descriptor.view;
            if (
              !Number.isFinite(view.zoom) ||
              view.zoom < 0.5 ||
              view.zoom > 3 ||
              !Number.isFinite(view.scroll) ||
              !Number.isSafeInteger(view.animation) ||
              view.animation < 0 ||
              typeof view.animate !== "boolean"
            ) {
              throw new Error("Invalid shared document viewport");
            }
            documentSharing.current()?.present(view);
          }
        } else if (!this.owner && this.file) {
          await documentSharing.current()?.close();
          if (this.disposed || epoch < this.receivedEpoch) {
            return;
          }
          documentSharing.follow(false);
          this.scene.dispose();
          this.file = undefined;
          this.document = undefined;
          this.scope = packet.page?.id || "";
          this.epoch = epoch;
          this.scene = this.createScene();
          if (this.started) {
            this.scene.start();
          }
        }
        this.scene.receive(packet, replace);
      })
      .catch((error) => {
        if (!this.disposed) {
          this.onError(error);
        }
      })
      .finally(() => {
        this.receiving--;
      });
    return this.incoming;
  }

  dispose() {
    this.disposed = true;
    this.lifetime.abort();
    this.generation++;
    this.scene.dispose();
    this.stop?.();
    if (!this.owner) {
      documentSharing.follow(false);
    }
    this.assets.clear();
  }
}
