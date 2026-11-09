import { t } from "@fcboard/fcboard/i18n";

/** Existing local/cloud transports use a real 32-hex room ID in #lan=. */
export const collaborationAddress = (input: string, endpoint: string) => {
  try {
    const value = input.trim();
    const address = new URL(/^[a-f0-9]{32}$/i.test(value) ? endpoint : value);
    if (/^[a-f0-9]{32}$/i.test(value)) {
      address.hash = `lan=${value.toLowerCase()}`;
    }
    if (
      !/^https?:$/.test(address.protocol) ||
      address.username ||
      address.password ||
      address.pathname !== "/" ||
      address.search ||
      !/^#lan=[a-f0-9]{32}$/.test(address.hash)
    ) {
      throw new Error();
    }
    return address.href;
  } catch {
    throw new Error(t("fcboard.collab_code_invalid"));
  }
};
