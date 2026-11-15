import recognitionVocabulary from "@fcboard/fcboard/locales/data/recognition.json";

export { recognitionVocabulary };
type PatternKey = Exclude<
  keyof typeof recognitionVocabulary,
  "spokenMath" | "normalCloseReasons"
>;
const patterns = new Map<PatternKey, RegExp>();
export const recognitionPattern = (key: PatternKey) => {
  let pattern = patterns.get(key);
  if (!pattern) {
    const entry = recognitionVocabulary[key];
    pattern = new RegExp(entry.pattern, entry.flags);
    patterns.set(key, pattern);
  }
  // Global replacement patterns must not leak lastIndex into a later request.
  pattern.lastIndex = 0;
  return pattern;
};
