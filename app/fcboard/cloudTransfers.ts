import { t } from "@fcboard/fcboard/i18n";

import {
  CloudShareHttpError,
  cloudShareAddress,
  cloudShareRequest,
} from "./cloudShare";

import type { CloudShareConfig } from "./cloudShare";

const credentials = (config: CloudShareConfig) => {
  const endpoint = cloudShareAddress(config.endpoint);
  if (config.key.trim().length < 16) {
    throw new Error(t("fcboard.live_share.service_key"));
  }
  return { endpoint, key: config.key.trim() };
};
const invalid = () => new Error(t("fcboard.live_share.invalid_server"));

/** Same selected PNGs and password lifecycle as the Android BoardShareServer. */
export class CloudPageShare {
  readonly url: string;
  private constructor(
    private endpoint: string,
    private id: string,
    private key: string,
  ) {
    this.url = `${endpoint}share/${id}/`;
  }
  static async start(
    config: CloudShareConfig,
    pages: string[],
    signal?: AbortSignal,
  ) {
    const { endpoint, key } = credentials(config);
    const share = new CloudPageShare(
      endpoint,
      crypto.randomUUID().replace(/-/g, ""),
      crypto.randomUUID().replace(/-/g, ""),
    );
    try {
      const result = await cloudShareRequest(
        `${endpoint}shares`,
        key,
        "POST",
        { id: share.id, key: share.key, pages },
        signal,
      );
      if (result.id !== share.id || result.protocol !== 1) {
        throw invalid();
      }
      signal?.throwIfAborted();
      return share;
    } catch (error) {
      void share.end().catch(() => {});
      throw error;
    }
  }
  async setPassword(password: string) {
    const result = await cloudShareRequest(
      `${this.endpoint}shares/${this.id}/password`,
      this.key,
      "PUT",
      { password },
    );
    if (result.updated !== true) {
      throw invalid();
    }
  }
  async end() {
    try {
      const result = await cloudShareRequest(
        `${this.endpoint}shares/${this.id}`,
        this.key,
        "DELETE",
      );
      if (result.ended !== true) {
        throw invalid();
      }
    } catch (error) {
      if (
        !(
          error instanceof CloudShareHttpError &&
          [404, 410].includes(error.status)
        )
      ) {
        throw error;
      }
    }
  }
}

/** Upload the actual BZD XML; extraction uses the same parser as a local file. */
export const uploadCloudBzd = async (
  config: CloudShareConfig,
  xml: string,
  signal?: AbortSignal,
) => {
  const { endpoint, key } = credentials(config);
  const id = crypto.randomUUID().replace(/-/g, "");
  const owner = crypto.randomUUID().replace(/-/g, "");
  try {
    const result = await cloudShareRequest(
      `${endpoint}documents`,
      key,
      "POST",
      { id, key: owner, xml },
      signal,
    );
    if (
      result.id !== id ||
      result.protocol !== 1 ||
      typeof result.code !== "string" ||
      !/^[a-zA-Z0-9]{4}$/.test(result.code) ||
      !Number.isSafeInteger(result.expires)
    ) {
      throw invalid();
    }
    signal?.throwIfAborted();
    return { code: result.code, expires: result.expires as number };
  } catch (error) {
    void cloudShareRequest(`${endpoint}documents/${id}`, owner, "DELETE").catch(
      () => {},
    );
    throw error;
  }
};
export const readCloudBzd = async (
  endpoint: string,
  code: string,
  signal?: AbortSignal,
) => {
  if (!/^[a-zA-Z0-9]{4}$/.test(code)) {
    throw new Error(t("fcboard.cloud_transfer.invalid_code"));
  }
  const result = await cloudShareRequest(
    `${cloudShareAddress(endpoint)}documents/${code}`,
    "",
    "GET",
    undefined,
    signal,
  );
  if (typeof result.xml !== "string" || result.xml.length > 20 * 1024 * 1024) {
    throw invalid();
  }
  return result.xml;
};
