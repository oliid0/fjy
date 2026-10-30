const { readdirSync, writeFileSync } = require("fs");
const files = readdirSync(`${__dirname}/../packages/fcboard/locales`);

const flatten = (object = {}, result = {}, extraKey = "") => {
  for (const key in object) {
    if (typeof object[key] !== "object") {
      result[extraKey + key] = object[key];
    } else {
      flatten(object[key], result, `${extraKey}${key}.`);
    }
  }
  return result;
};

const locales = files.filter(
  (file) => file.endsWith(".json") && file !== "percentages.json",
);

const percentages = {};
const eligibility = {};
const referenceKeys = Object.keys(
  flatten(require("../packages/fcboard/locales/en.json")),
);
// App-specific teaching features use the existing English fallback. Adding one
// must not remove an otherwise translated editor language from its picker.
const editorKeys = referenceKeys.filter((key) => !key.startsWith("fcboard."));

for (let index = 0; index < locales.length; index++) {
  const currentLocale = locales[index];
  const data = flatten(
    require(`${__dirname}/../packages/fcboard/locales/${currentLocale}`),
  );

  const translatedKeys = referenceKeys.filter(
    (key) => typeof data[key] === "string" && data[key].trim() !== "",
  );
  const percentage = Math.floor(
    (100 * translatedKeys.length) / referenceKeys.length,
  );
  percentages[currentLocale.replace(".json", "")] = percentage;
  eligibility[currentLocale.replace(".json", "")] = Math.floor(
    (100 *
      editorKeys.filter(
        (key) => typeof data[key] === "string" && data[key].trim() !== "",
      ).length) /
      editorKeys.length,
  );
}

writeFileSync(
  `${__dirname}/../packages/fcboard/locales/percentages.json`,
  `${JSON.stringify(percentages, null, 2)}\n`,
  "utf8",
);
writeFileSync(
  `${__dirname}/../packages/fcboard/localeEligibility.json`,
  `${JSON.stringify(eligibility, null, 2)}\n`,
  "utf8",
);
