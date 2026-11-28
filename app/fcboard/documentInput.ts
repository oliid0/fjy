export type NativeDocumentInput = {
  key: string;
  name: string;
  mime: string;
  size: number;
  fingerprint: string;
};

export type DocumentInput = File | NativeDocumentInput;

export const isNativeDocumentInput = (
  source: unknown,
): source is NativeDocumentInput => {
  const input = source as Partial<NativeDocumentInput> | undefined;
  return (
    !!input &&
    typeof input.key === "string" &&
    /^[a-f0-9-]{36}$/.test(input.key) &&
    typeof input.name === "string" &&
    typeof input.mime === "string" &&
    typeof input.size === "number" &&
    Number.isSafeInteger(input.size) &&
    input.size > 0 &&
    typeof input.fingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(input.fingerprint)
  );
};

export const nativeDocumentUrl = (input: NativeDocumentInput) =>
  `${location.origin}/_fc_courseware/${input.key}`;
