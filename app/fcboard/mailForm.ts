import type { MailAccount } from "./mail";

/** NewEmailPopu.mStmpSeverArray and EmailAutoComplete.emailSufixs. */
export const mailProviders = [
  { key: "provider_netease", host: "smtp.qiye.163.com" },
  { key: "provider_alibaba", host: "smtp.mxhichina.com" },
  { key: "provider_tencent", host: "smtp.exmail.qq.com" },
  { key: "provider_163", host: "smtp.163.com" },
  { key: "provider_qq", host: "smtp.qq.com" },
  { key: "other_mailbox", host: "" },
] as const;
const suffixes = [
  "@qq.com",
  "@163.com",
  "@126.com",
  "@gmail.com",
  "@sina.com",
  "@hotmail.com",
  "@yahoo.cn",
  "@sohu.com",
  "@foxmail.com",
  "@139.com",
  "@yeah.net",
  "@vip.qq.com",
  "@vip.sina.com",
];
export const emailSuggestions = (value: string) => {
  const separator = value.lastIndexOf(";") + 1;
  const tail = value.slice(separator);
  const prefix = value.slice(0, separator) + (tail.match(/^\s*/)?.[0] || "");
  const token = tail.trimStart();
  const at = token.indexOf("@");
  if (at < 0 && !/^[a-zA-Z0-9_]+$/.test(token)) {
    return [];
  }
  const stem = at < 0 ? token : token.slice(0, at);
  if (!stem) {
    return [];
  }
  const filter = at < 0 ? "@" : token.slice(at).toLowerCase();
  return suffixes
    .filter((suffix) => suffix.startsWith(filter))
    .map((suffix) => ({ label: stem + suffix, value: prefix + stem + suffix }));
};

// Native NewEmailPopu validates each semicolon-delimited receiver before export.
const address =
  /^[_A-Za-z0-9-]+(\.[_A-Za-z0-9-]+)*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*(\.[A-Za-z]{2,})$/;
export const validMailRecipients = (value: string) => {
  const values = value.split(";").map((part) => part.trim());
  return values.length <= 100 && values.every((value) => address.test(value));
};
export const validMailAccount = (value: MailAccount) =>
  address.test(value.address.trim()) &&
  !!value.host.trim() &&
  value.host.length <= 253 &&
  !/[\s/\\]/.test(value.host.trim()) &&
  Number.isInteger(value.port) &&
  value.port >= 1 &&
  value.port <= 65535 &&
  !!(value.secret?.trim() || value.hasSecret) &&
  (!value.imapHost ||
    (!/[\s/\\]/.test(value.imapHost) &&
      value.imapHost.length <= 253 &&
      Number.isInteger(value.imapPort) &&
      value.imapPort! >= 1 &&
      value.imapPort! <= 65535 &&
      !!value.sentFolder?.trim()));

export const publicMailAccount = (account: MailAccount) => {
  const { secret, ...visible } = account;
  return { ...visible, hasSecret: !!(secret || account.hasSecret) };
};
