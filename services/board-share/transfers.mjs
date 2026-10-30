import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import {
  randomBytes,
  randomInt,
  createHash,
  timingSafeEqual,
} from "node:crypto";

const LIMIT = 20 * 1024 * 1024;
const PAGE_LIFETIME = 10 * 60 * 1000;
const DOCUMENT_LIFETIME = 24 * 60 * 60 * 1000;
const id = (value) => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const fail = (status, message) => Object.assign(new Error(message), { status });
const equal = (left, right) => {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const validXml = (xml) =>
  typeof xml === "string" &&
  /^\s*(?:<\?xml[^>]*>\s*)?<bzd(?:\s|>)/.test(xml) &&
  xml.trimEnd().endsWith("</bzd>") &&
  !/<!DOCTYPE|<!ENTITY/i.test(xml);
const hash = (salt, password) =>
  createHash("sha256").update(salt).update(password).digest("hex");

/** ChooseServerPopu / BoardShareServer and ChooseBzdPopu / ExtraCodePopu are separate transfers. */
export class Transfers {
  pages = new Map();
  documents = new Map();
  size = 0;
  constructor(directory, budget = 64 * 1024 * 1024) {
    this.directory = directory;
    if (!directory) {
      return;
    }
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const filename of readdirSync(directory)) {
      if (!/^[a-f0-9]{32}\.json$/.test(filename)) {
        continue;
      }
      const path = join(directory, filename);
      if (statSync(path).size > LIMIT) {
        throw new Error("Stored BZD exceeds the transfer budget");
      }
      const value = JSON.parse(readFileSync(path, "utf8"));
      if (value.expires <= Date.now()) {
        unlinkSync(path);
        continue;
      }
      if (
        !id(value.id) ||
        filename !== `${value.id}.json` ||
        !id(value.key) ||
        !/^[a-zA-Z0-9]{4}$/.test(value.code) ||
        !validXml(value.xml) ||
        !Number.isSafeInteger(value.expires) ||
        [...this.documents.values()].some((item) => item.code === value.code)
      ) {
        throw new Error("Invalid stored BZD transfer");
      }
      const size = Buffer.byteLength(JSON.stringify(value));
      if (this.size + size > budget || this.documents.size >= 32) {
        throw new Error("Stored BZD exceeds the transfer budget");
      }
      this.documents.set(value.id, { ...value, size });
      this.size += size;
    }
  }
  remove(collection, key) {
    const value = collection.get(key);
    if (!value) {
      return;
    }
    if (collection === this.documents && this.directory) {
      unlinkSync(join(this.directory, `${key}.json`));
    }
    collection.delete(key);
    this.size -= value.size;
  }
  sweep() {
    for (const collection of [this.pages, this.documents]) {
      for (const [key, value] of collection) {
        if (value.expires <= Date.now()) {
          this.remove(collection, key);
        }
      }
    }
  }
  async route(
    request,
    response,
    path,
    { body, json, bearer, createToken, availableBytes },
  ) {
    const document = /^\/documents(?:\/([a-zA-Z0-9]{4}|[a-f0-9]{32}))?$/.exec(
      path,
    );
    const pages = /^\/shares(?:\/([a-f0-9]{32})(\/password)?)?$/.exec(path);
    const publicPage =
      /^\/share\/([a-f0-9]{32})(?:\/(?:page-(\d+)\.png)?)?$/.exec(path);
    if (!document && !pages && !publicPage) {
      return false;
    }
    this.sweep();
    if ((document || pages) && !(document || pages)[1]) {
      if (request.method !== "POST") {
        throw fail(405, "Method not allowed");
      }
      if (!bearer(request, createToken)) {
        throw fail(401, "Invalid share-service key");
      }
      const input = await body(request);
      if (!input || !id(input.id) || !id(input.key)) {
        throw fail(400, "Invalid transfer credentials");
      }
      const collection = document ? this.documents : this.pages;
      const previous = collection.get(input.id);
      if (previous) {
        if (!equal(previous.key, input.key)) {
          throw fail(409, "Transfer already exists");
        }
        json(response, 201, {
          id: input.id,
          protocol: 1,
          code: previous.code,
          expires: previous.expires,
        });
        return true;
      }
      if (this.pages.size + this.documents.size >= 32) {
        throw fail(503, "Transfer service is full");
      }
      let value;
      if (document) {
        if (!validXml(input.xml)) {
          throw fail(400, "Invalid BZD document");
        }
        const alphabet =
          "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const codes = new Set(
          [...this.documents.values()].map((item) => item.code),
        );
        let code;
        do {
          code = Array.from(
            { length: 4 },
            () => alphabet[randomInt(alphabet.length)],
          ).join("");
        } while (codes.has(code));
        value = {
          id: input.id,
          key: input.key,
          code,
          xml: input.xml,
          expires: Date.now() + DOCUMENT_LIFETIME,
        };
      } else {
        if (
          !Array.isArray(input.pages) ||
          !input.pages.length ||
          input.pages.length > 20 ||
          input.pages.some(
            (image) =>
              typeof image !== "string" ||
              !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image),
          )
        ) {
          throw fail(400, "Choose 1–20 PNG pages");
        }
        value = {
          id: input.id,
          key: input.key,
          pages: input.pages,
          expires: Date.now() + PAGE_LIFETIME,
        };
      }
      const serialized = JSON.stringify(value);
      const size = Buffer.byteLength(serialized);
      if (size > Math.min(LIMIT, availableBytes())) {
        throw fail(413, "Transfer exceeds the storage budget");
      }
      if (document && this.directory) {
        const temporary = join(this.directory, `${input.id}.tmp`);
        writeFileSync(temporary, serialized, { mode: 0o600 });
        renameSync(temporary, join(this.directory, `${input.id}.json`));
      }
      collection.set(input.id, {
        ...value,
        size,
        salt: randomBytes(32),
        sessions: new Set(),
      });
      this.size += size;
      json(response, 201, {
        id: input.id,
        protocol: 1,
        code: value.code,
        expires: value.expires,
      });
      return true;
    }
    if (document && document[1].length === 4 && request.method === "GET") {
      const value = [...this.documents.values()].find(
        (item) => item.code === document[1],
      );
      if (!value) {
        throw fail(404, "Incorrect or expired extraction code");
      }
      json(response, 200, { xml: value.xml });
      return true;
    }
    if (document || pages) {
      const match = document || pages;
      const collection = document ? this.documents : this.pages;
      const value = collection.get(match[1]);
      if (!value) {
        throw fail(404, "Transfer has ended");
      }
      if (!bearer(request, value.key)) {
        throw fail(401, "Invalid transfer-owner key");
      }
      if (pages?.[2] && request.method === "PUT") {
        const input = await body(request);
        if (
          typeof input?.password !== "string" ||
          (input.password !== "" && !/^[0-9]{4}$/.test(input.password))
        ) {
          throw fail(400, "Password must contain four digits");
        }
        value.password = input.password
          ? hash(value.salt, input.password)
          : undefined;
        value.sessions.clear();
        json(response, 200, { updated: true });
      } else if (!pages?.[2] && request.method === "DELETE") {
        this.remove(collection, match[1]);
        json(response, 200, { ended: true });
      } else {
        throw fail(405, "Method not allowed");
      }
      return true;
    }
    const value = this.pages.get(publicPage[1]);
    if (!value) {
      throw fail(410, "Sharing has expired; scan a new QR code");
    }
    const root = `/share/${value.id}/`;
    const index = publicPage[2] === undefined;
    if (!["GET", "HEAD", ...(index ? ["POST"] : [])].includes(request.method)) {
      throw fail(405, "Read only");
    }
    let session;
    let incorrect = false;
    if (request.method === "POST") {
      let raw = "";
      for await (const chunk of request) {
        raw += chunk.toString();
        if (raw.length > 1024) {
          throw fail(413, "Password form is too large");
        }
      }
      const password = new URLSearchParams(raw).get("password") || "";
      if (value.password && equal(hash(value.salt, password), value.password)) {
        session = randomBytes(32).toString("hex");
        if (value.sessions.size >= 256) {
          value.sessions.delete(value.sessions.values().next().value);
        }
        value.sessions.add(session);
      } else {
        incorrect = !!value.password;
      }
    }
    const cookies = (request.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim());
    const authorized =
      !value.password ||
      session ||
      cookies.some(
        (cookie) =>
          cookie.startsWith("fcboard-share=") &&
          value.sessions.has(cookie.slice(14)),
      );
    response.setHeader("Cache-Control", "no-store");
    if (!authorized) {
      if (!index) {
        throw fail(403, "Enter the sharing password");
      }
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
      });
      response.end(
        `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>白板分享</title><form method="post" action="${root}"><label>请输入密码<input name="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" required></label><button>确定</button>${
          incorrect ? '<p role="alert">密码错误，请重新输入</p>' : ""
        }</form></html>`,
      );
      return true;
    }
    if (index) {
      if (session) {
        const secure =
          request.socket.encrypted ||
          request.headers["x-forwarded-proto"] === "https";
        response.setHeader(
          "Set-Cookie",
          `fcboard-share=${session}; Path=${root}; HttpOnly; SameSite=Strict${
            secure ? "; Secure" : ""
          }`,
        );
      }
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      });
      const images = value.pages
        .map(
          (_, page) =>
            `<section><h2>第 ${page + 1} 页</h2><a download="Fcboard-${
              page + 1
            }.png" href="${root}page-${page}.png?download=1">下载本页</a><img alt="白板页面" src="${root}page-${page}.png"></section>`,
        )
        .join("");
      response.end(
        `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fcboard 页面分享</title><style>body{margin:24px;font:18px system-ui;background:#f5f7fa;color:#17243c}img{display:block;max-width:100%;margin:16px 0;background:white}a{display:inline-block;padding:12px;color:#245bd6}section{margin-bottom:32px}</style><h1>Fcboard 页面分享</h1><p>本次分享有效期十分钟，请及时下载。</p>${images}</html>`,
      );
    } else {
      const image = value.pages[Number(publicPage[2])];
      if (!image) {
        throw fail(404, "Page not found");
      }
      const data = Buffer.from(
        image.slice("data:image/png;base64,".length),
        "base64",
      );
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": data.length,
        ...(new URL(request.url, "http://localhost").searchParams.get(
          "download",
        ) === "1"
          ? {
              "Content-Disposition": `attachment; filename=Fcboard-${
                Number(publicPage[2]) + 1
              }.png`,
            }
          : {}),
      });
      response.end(request.method === "HEAD" ? undefined : data);
    }
    return true;
  }
}
