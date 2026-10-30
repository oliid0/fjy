import { createServer } from "node:http";
import { createReadStream, realpathSync, statSync } from "node:fs";
import { resolve, sep, extname } from "node:path";
import { pathToFileURL } from "node:url";
import {
  setTimeout,
  setInterval,
  clearInterval,
  clearTimeout,
} from "node:timers";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { WebSocketServer, WebSocket } from "ws";

import { Transfers } from "./transfers.mjs";

const LIMIT = 20 * 1024 * 1024;
const validId = (value) =>
  typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const equal = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const record = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const fail = (status, message) => Object.assign(new Error(message), { status });

/** LanRoom.merge / resolve: versions, lower nonce, immutable files and background clock. */
class Room {
  active = true;
  elements = new Map();
  files = new Map();
  sizes = new Map();
  size = 0;
  background = undefined;
  page = undefined;
  document = undefined;
  peers = new Set();
  waiting = new Set();
  host = undefined;
  password = undefined;
  salt = randomBytes(32);
  touched = Date.now();
  constructor(key, scene, budget) {
    this.key = key;
    this.merge(scene, budget, true);
  }
  merge(packet, budget = LIMIT, owner = false) {
    if (!this.active) {
      throw fail(404, "Collaboration has ended");
    }
    if (
      !record(packet) ||
      packet.kind !== "scene" ||
      !Array.isArray(packet.elements) ||
      packet.elements.length > 50000 ||
      !record(packet.files)
    ) {
      throw fail(400, "Invalid scene packet");
    }
    const page = packet.page;
    if (
      page !== undefined &&
      (!record(page) ||
        typeof page.id !== "string" ||
        !page.id ||
        page.id.length > 128 ||
        !Number.isSafeInteger(page.epoch) ||
        page.epoch < 0)
    ) {
      throw fail(400, "Invalid board page");
    }
    const switched =
      page?.id !== this.page?.id || page?.epoch !== this.page?.epoch;
    if (
      switched &&
      (!owner || !page || (this.page && page.epoch <= this.page.epoch))
    ) {
      return this.snapshot();
    }
    const next = new Map(switched ? [] : this.elements);
    let document = switched ? undefined : this.document;
    if (owner && packet.document !== undefined) {
      const incoming = packet.document;
      if (
        !record(incoming) ||
        typeof incoming.id !== "string" ||
        !incoming.id ||
        incoming.id.length > 128 ||
        typeof incoming.name !== "string" ||
        !incoming.name ||
        incoming.name.length > 512 ||
        typeof incoming.mimeType !== "string" ||
        incoming.mimeType.length > 128 ||
        !Number.isSafeInteger(incoming.page) ||
        incoming.page < 0
      ) {
        throw fail(400, "Invalid shared document");
      }
      const dataURL =
        incoming.dataURL ??
        (this.document?.id === incoming.id ? this.document.dataURL : undefined);
      if (
        typeof dataURL !== "string" ||
        !/^data:[^;,]*;base64,[A-Za-z0-9+/]*={0,2}$/.test(dataURL)
      ) {
        throw fail(400, "Invalid shared document content");
      }
      document = {
        id: incoming.id,
        name: incoming.name,
        mimeType: incoming.mimeType,
        page: incoming.page,
        dataURL,
        ...(incoming.view ? { view: incoming.view } : {}),
      };
      const view = incoming.view;
      if (
        view !== undefined &&
        (!record(view) ||
          !Number.isFinite(view.zoom) ||
          view.zoom < 0.5 ||
          view.zoom > 3 ||
          !Number.isFinite(view.scroll) ||
          !Number.isSafeInteger(view.animation) ||
          view.animation < 0 ||
          typeof view.animate !== "boolean")
      ) {
        throw fail(400, "Invalid shared document viewport");
      }
    }
    const files = new Map(switched ? [] : this.files);
    const sizes = new Map(switched ? [] : this.sizes);
    let size = switched ? 0 : this.size;
    const put = (key, value) => {
      const length = bytes(value);
      size += length - (sizes.get(key) || 0);
      sizes.set(key, length);
    };
    if (document && (switched || (owner && packet.document !== undefined))) {
      put("document", document);
    }
    for (const element of packet.elements) {
      if (
        !record(element) ||
        typeof element.id !== "string" ||
        !element.id.length ||
        element.id.length > 128 ||
        !Number.isSafeInteger(element.version) ||
        element.version < 0 ||
        !Number.isSafeInteger(element.versionNonce)
      ) {
        throw fail(400, "Invalid board element");
      }
      const old = next.get(element.id);
      if (
        !old ||
        element.version > old.version ||
        (element.version === old.version &&
          element.versionNonce < old.versionNonce)
      ) {
        next.set(element.id, element);
        put(`e:${element.id}`, element);
      }
    }
    if (next.size > 50000) {
      throw fail(413, "Too many board elements");
    }
    for (const [id, image] of Object.entries(packet.files)) {
      if (
        id.length > 128 ||
        !record(image) ||
        image.id !== id ||
        typeof image.dataURL !== "string" ||
        !image.dataURL.startsWith("data:image/")
      ) {
        throw fail(400, "Invalid board image");
      }
      if (!files.has(id)) {
        files.set(id, image);
        put(`f:${id}`, image);
      }
    }
    let background = switched ? undefined : this.background;
    const incoming = packet.background;
    if (incoming !== undefined) {
      if (
        !record(incoming) ||
        !Number.isSafeInteger(incoming.clock) ||
        incoming.clock < 0 ||
        typeof incoming.client !== "string" ||
        incoming.client.length > 128 ||
        typeof incoming.color !== "string" ||
        incoming.color.length > 64
      ) {
        throw fail(400, "Invalid board background");
      }
      if (
        !background ||
        incoming.clock > background.clock ||
        (incoming.clock === background.clock &&
          incoming.client > background.client)
      ) {
        background = incoming;
        put("background", incoming);
      }
    }
    // Include JSON container overhead in the same 20 MB budget used by LanServer.
    if (
      size + next.size * 4 + files.size * 140 + 4096 >
      Math.min(LIMIT, budget)
    ) {
      throw fail(413, "Room exceeds the 20 MB scene budget");
    }
    this.elements = next;
    this.files = files;
    this.sizes = sizes;
    this.size = size;
    this.background = background;
    this.page = page ? { id: page.id, epoch: page.epoch } : undefined;
    this.document = document;
    this.touched = Date.now();
    if (switched) {
      return this.snapshot();
    }
    return {
      kind: "scene",
      ...(this.page ? { page: this.page } : {}),
      ...(document ? { document: { ...document, dataURL: undefined } } : {}),
      elements: packet.elements.map((element) => next.get(element.id)),
      files: Object.fromEntries(
        Object.keys(packet.files).map((id) => [id, files.get(id)]),
      ),
      ...(incoming !== undefined && background ? { background } : {}),
    };
  }
  snapshot() {
    return {
      kind: "initial",
      ...(this.page ? { page: this.page } : {}),
      ...(this.document ? { document: this.document } : {}),
      elements: [...this.elements.values()],
      files: Object.fromEntries(this.files),
      ...(this.background ? { background: this.background } : {}),
    };
  }
  hash(password) {
    return createHash("sha256")
      .update(this.salt)
      .update(password)
      .digest("hex");
  }
  send(socket, data) {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    if (socket.bufferedAmount > LIMIT) {
      socket.terminate();
      return;
    }
    socket.send(
      typeof data === "string" ? data : JSON.stringify(data),
      (error) => {
        if (error) {
          socket.terminate();
        }
      },
    );
  }
  counts() {
    if (this.host) {
      this.send(this.host, { kind: "peers", count: this.peers.size });
    }
  }
  join(socket) {
    if (!this.active) {
      socket.close(1000, "collaboration_ended");
      return;
    }
    if (this.peers.size >= 32) {
      socket.close(1000, "Room is full");
      return;
    }
    this.waiting.delete(socket);
    this.peers.add(socket);
    this.send(socket, this.snapshot());
    this.counts();
  }
  setPassword(value) {
    if (!this.active) {
      throw fail(404, "Collaboration has ended");
    }
    if (
      typeof value !== "string" ||
      (value !== "" && !/^[0-9]{4}$/.test(value))
    ) {
      throw fail(400, "Password must contain four digits");
    }
    this.password = value ? this.hash(value) : undefined;
    if (!this.password) {
      for (const socket of [...this.waiting]) {
        this.join(socket);
      }
    }
  }
  stop() {
    this.active = false;
    for (const socket of [
      ...this.peers,
      ...this.waiting,
      ...(this.host ? [this.host] : []),
    ]) {
      socket.close(1000, "collaboration_ended");
      const timer = setTimeout(() => socket.terminate(), 1000);
      timer.unref();
    }
    this.peers.clear();
    this.waiting.clear();
    this.host = undefined;
  }
}

/** A deployable cloud transport for the existing SceneSync and LanSession protocol.
 * @param {{publicDir:string, createToken:string, dataDir?:string, origins?:string[], maxRooms?:number, roomTimeoutMs?:number, totalBytes?:number}} options
 */
export function createShareServer(options) {
  if (!options.createToken || options.createToken.length < 16) {
    throw new Error("Configure a SHARE_CREATE_TOKEN of at least 16 characters");
  }
  const root = realpathSync(options.publicDir);
  if (!statSync(resolve(root, "index.html")).isFile()) {
    throw new Error("The packaged whiteboard index.html is missing");
  }
  const rooms = new Map();
  const transfers = new Transfers(options.dataDir, options.totalBytes);
  const availableBytes = (current) =>
    (options.totalBytes || 64 * 1024 * 1024) -
    transfers.size -
    [...rooms.values()].reduce(
      (sum, room) => sum + (room === current ? 0 : room.size + 4096),
      0,
    );
  const allowed = new Set(
    options.origins || ["https://localhost", "capacitor://localhost"],
  );
  const originAllowed = (request) =>
    !request.headers.origin ||
    allowed.has(request.headers.origin) ||
    [
      `http://${request.headers.host}`,
      `https://${request.headers.host}`,
    ].includes(request.headers.origin);
  const bearer = (request, key) =>
    equal(request.headers.authorization, `Bearer ${key}`);
  const json = (response, status, value) => {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(value));
  };
  const body = async (request) => {
    let length = 0;
    const chunks = [];
    for await (const chunk of request) {
      length += chunk.length;
      if (length > LIMIT) {
        throw fail(413, "Request is too large");
      }
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw fail(400, "Invalid JSON");
    }
  };
  const route = (request) =>
    new URL(request.url || "/", "http://localhost").pathname;
  const server = createServer(async (request, response) => {
    try {
      if (!originAllowed(request)) {
        throw fail(403, "Origin is not allowed");
      }
      if (request.headers.origin) {
        response.setHeader(
          "Access-Control-Allow-Origin",
          request.headers.origin,
        );
        response.setHeader("Vary", "Origin");
      }
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
      );
      response.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer");
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      const path = route(request);
      if (path === "/health" && request.method === "GET") {
        json(response, 200, {
          service: "fcboard-live-share",
          protocol: 1,
          ready: true,
          version: process.env.SHARE_VERSION || "",
        });
        return;
      }
      if (path === undefined) {
        throw fail(404, "Not found");
      }
      if (
        await transfers.route(request, response, path, {
          body,
          json,
          bearer,
          createToken: options.createToken,
          availableBytes,
        })
      ) {
        return;
      }
      if (path === "/rooms" && request.method === "POST") {
        if (!bearer(request, options.createToken)) {
          throw fail(401, "Invalid share-service key");
        }
        const input = await body(request);
        if (!record(input) || !validId(input.room) || !validId(input.key)) {
          throw fail(400, "Invalid room credentials");
        }
        const previous = rooms.get(input.room);
        if (previous && !equal(previous.key, input.key)) {
          throw fail(409, "Room already exists");
        }
        if (!previous) {
          if (rooms.size >= (options.maxRooms || 32)) {
            throw fail(503, "Share service is full");
          }
          rooms.set(
            input.room,
            new Room(input.key, input.scene, availableBytes()),
          );
        }
        json(response, 201, { room: input.room, protocol: 1 });
        return;
      }
      const command = /^\/rooms\/([a-f0-9]{32})(\/password)?$/.exec(path);
      if (command) {
        const room = rooms.get(command[1]);
        if (!room) {
          throw fail(404, "Collaboration has ended");
        }
        if (!bearer(request, room.key)) {
          throw fail(401, "Invalid room-owner key");
        }
        if (command[2] && request.method === "PUT") {
          const input = await body(request);
          room.setPassword(input?.password);
          room.touched = Date.now();
          json(response, 200, { updated: true });
          return;
        }
        if (!command[2] && request.method === "DELETE") {
          room.stop();
          rooms.delete(command[1]);
          json(response, 200, { ended: true });
          return;
        }
        throw fail(405, "Method not allowed");
      }
      if (request.method !== "GET") {
        throw fail(405, "Method not allowed");
      }
      const decoded = decodeURIComponent(path);
      if (decoded.includes("\\") || decoded.includes("\0")) {
        throw fail(404, "Not found");
      }
      const filename = realpathSync(
        resolve(root, `.${decoded === "/" ? "/index.html" : decoded}`),
      );
      if (
        !filename.startsWith(`${root}${sep}`) ||
        !statSync(filename).isFile()
      ) {
        throw fail(404, "Not found");
      }
      const mime =
        {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript",
          ".mjs": "text/javascript",
          ".css": "text/css",
          ".json": "application/json",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".webp": "image/webp",
          ".woff2": "font/woff2",
          ".woff": "font/woff",
          ".ttf": "font/ttf",
          ".wasm": "application/wasm",
          ".mp4": "video/mp4",
          ".pdf": "application/pdf",
          ".gif": "image/gif",
          ".bmp": "image/bmp",
          ".avif": "image/avif",
          ".ico": "image/x-icon",
          ".otf": "font/otf",
          ".webmanifest": "application/manifest+json",
          ".webm": "video/webm",
          ".mp3": "audio/mpeg",
          ".wav": "audio/wav",
          ".ogg": "audio/ogg",
          ".txt": "text/plain; charset=utf-8",
        }[extname(filename)] || "application/octet-stream";
      response.writeHead(200, {
        "Content-Type": mime,
        "Cache-Control": "no-cache",
      });
      const stream = createReadStream(filename);
      stream.on("error", () => response.destroy());
      stream.pipe(response);
    } catch (error) {
      if (!response.headersSent) {
        json(response, error.status || (error.code === "ENOENT" ? 404 : 500), {
          error: error.status ? error.message : "Share request failed",
        });
      } else {
        response.destroy();
      }
    }
  });
  server.requestTimeout = 30000;
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: LIMIT,
    perMessageDeflate: false,
  });
  server.on("upgrade", (request, socket, head) => {
    const match = /^\/(board|host)\/([a-f0-9]{32})$/.exec(route(request) || "");
    const room = match && rooms.get(match[2]);
    if (
      !room ||
      !originAllowed(request) ||
      room.waiting.size >= 32 ||
      (match[1] === "board" && room.peers.size >= 32)
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(request, socket, head, (transport) => {
      room.waiting.add(transport);
      let owner = false;
      let live = true;
      const authTimer = setTimeout(() => {
        if (!owner && !room.peers.has(transport)) {
          transport.close(1000, "Authentication timed out");
        }
      }, 30000);
      authTimer.unref();
      if (match[1] === "board") {
        if (room.password) {
          room.waiting.add(transport);
          room.send(transport, {
            kind: "auth",
            required: true,
            incorrect: false,
          });
        } else {
          room.join(transport);
          clearTimeout(authTimer);
        }
      }
      transport.on("message", (raw, binary) => {
        if (!live || !room.active) {
          return;
        }
        try {
          if (binary) {
            throw fail(400, "Text messages are required");
          }
          const text = raw.toString();
          if (text === "ping") {
            room.touched = Date.now();
            room.send(transport, "pong");
            return;
          }
          if (text === "snapshot" && (owner || room.peers.has(transport))) {
            room.send(transport, room.snapshot());
            return;
          }
          const packet = JSON.parse(text);
          if (match[1] === "host" && !owner) {
            if (packet.kind !== "host" || !equal(packet.key, room.key)) {
              throw fail(401, "Invalid room-owner key");
            }
            room.host?.close(1000, "Owner reconnected");
            room.host = transport;
            room.waiting.delete(transport);
            owner = true;
            clearTimeout(authTimer);
            room.send(transport, room.snapshot());
            room.counts();
            return;
          }
          if (!owner && !room.peers.has(transport)) {
            if (
              packet.kind === "join" &&
              typeof packet.password === "string" &&
              equal(room.hash(packet.password), room.password)
            ) {
              room.join(transport);
              clearTimeout(authTimer);
            } else {
              room.send(transport, {
                kind: "auth",
                required: true,
                incorrect: true,
              });
            }
            return;
          }
          const resolved = room.merge(packet, availableBytes(room), owner);
          for (const peer of room.peers) {
            room.send(peer, resolved);
          }
          if (room.host) {
            room.send(room.host, resolved);
          }
        } catch (error) {
          room.send(transport, {
            error: error.status
              ? error.message
              : "Invalid collaboration message",
          });
        }
      });
      transport.on("close", () => {
        live = false;
        clearTimeout(authTimer);
        room.peers.delete(transport);
        room.waiting.delete(transport);
        if (room.host === transport) {
          room.host = undefined;
        }
        room.counts();
      });
      transport.on("error", () => transport.terminate());
    });
  });
  const sweep = setInterval(() => {
    transfers.sweep();
    for (const [id, room] of rooms) {
      if (
        Date.now() - room.touched >
        (options.roomTimeoutMs || 8 * 60 * 60 * 1000)
      ) {
        room.stop();
        rooms.delete(id);
      }
    }
  }, 30000);
  sweep.unref();
  return {
    server,
    close: async () => {
      clearInterval(sweep);
      for (const room of rooms.values()) {
        room.stop();
      }
      rooms.clear();
      for (const socket of sockets.clients) {
        socket.terminate();
      }
      sockets.close();
      if (server.listening) {
        await new Promise((done, reject) =>
          server.close((error) => (error ? reject(error) : done())),
        );
      }
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const service = createShareServer({
    publicDir:
      process.env.SHARE_PUBLIC_DIR ||
      resolve(import.meta.dirname, "../../app/build"),
    createToken: process.env.SHARE_CREATE_TOKEN || "",
    dataDir: process.env.SHARE_DATA_DIR || "/var/lib/fcboard/transfers",
    origins: (
      process.env.SHARE_ORIGINS || "https://localhost,capacitor://localhost"
    ).split(","),
  });
  service.server.listen(
    Number(process.env.PORT || 8080),
    process.env.HOST || "127.0.0.1",
  );
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(
      signal,
      () => void service.close().then(() => process.exit(0)),
    );
  }
}
