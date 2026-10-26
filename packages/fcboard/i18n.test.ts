import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { defaultLang, languages, setLanguage, t } from "./i18n";
import reference from "./locales/en.json";
import percentages from "./locales/percentages.json";

import type { TranslationKeys } from "./i18n";

const directory = path.resolve("packages/fcboard/locales");
const flatten = (
  value: Record<string, unknown>,
  prefix = "",
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(value).flatMap(([key, item]): [string, string][] =>
      typeof item === "string"
        ? [[`${prefix}${key}`, item]]
        : Object.entries(
            flatten(item as Record<string, unknown>, `${prefix}${key}.`),
          ),
    ),
  );
const canonical = flatten(reference);
const catalogs = readdirSync(directory)
  .filter((file) => file.endsWith(".json") && file !== "percentages.json")
  .map((file) => ({
    code: file.slice(0, -5),
    strings: flatten(
      JSON.parse(readFileSync(path.join(directory, file), "utf8")),
    ),
  }));
const placeholders = (value: string) =>
  [...new Set(value.match(/\{\{[^{}]+\}\}/g) || [])].sort();
const componentNames = (value: string) =>
  [
    ...new Set(
      [...value.matchAll(/<\/?([A-Za-z][\w.-]*)[^>]*>/g)].map(
        (match) => match[1],
      ),
    ),
  ].sort();

afterEach(async () => {
  await setLanguage(defaultLang);
});

describe.each(catalogs)("$code translation catalog", ({ code, strings }) => {
  it("uses English identifiers and preserves interpolation parameters", () => {
    for (const [key, value] of Object.entries(strings)) {
      expect(key).not.toMatch(/\p{Script=Han}/u);
      if (value && key in canonical) {
        expect([key, placeholders(value)]).toEqual([
          key,
          placeholders(canonical[key]),
        ]);
        expect(value).not.toMatch(/ZXQ\d+QXZ|FCID\d{1,4}:/);
        if (!canonical[key].includes("[")) {
          expect(value).not.toMatch(/\[+\s*$/);
        }
        expect([key, componentNames(value)]).toEqual([
          key,
          componentNames(canonical[key]),
        ]);
      }
    }
  });

  it("reports missing translations against the complete English catalog", () => {
    const translated = Object.keys(canonical).filter((key) =>
      strings[key]?.trim(),
    ).length;
    expect((percentages as Record<string, number>)[code]).toBe(
      Math.floor((100 * translated) / Object.keys(canonical).length),
    );
    if (translated === Object.keys(canonical).length) {
      expect(languages.some((language) => language.code === code)).toBe(true);
    }
  });

  it("loads its own strings and resolves translated placeholders", async () => {
    await setLanguage({ code, label: code });
    for (const key of Object.keys(canonical) as TranslationKeys[]) {
      const value = strings[key] || canonical[key];
      expect(t(key, { correct: 2, attempts: 3 })).toBe(
        value.replace("{{correct}}", "2").replace("{{attempts}}", "3"),
      );
    }
  });
});

it("keeps user resource names literal when resolving translated parameters", async () => {
  await setLanguage(defaultLang);
  const name = "$& {{attempts}}";
  expect(t("fcboard.delete_resource_name", { name, attempts: 3 })).toBe(
    `Delete resource ${name}`,
  );
});

it("offers complete whiteboard controls in every available language", () => {
  for (const language of languages.filter(
    (language) => !language.code.startsWith("__test__"),
  )) {
    const catalog = catalogs.find((item) => item.code === language.code)!;
    for (const key of Object.keys(reference.fcboard)) {
      expect({
        language: language.code,
        key,
        missing: !catalog.strings[`fcboard.${key}`],
      }).toEqual({ language: language.code, key, missing: false });
    }
  }
});

it.each([
  ["en", "Recording", "Fountain pen", "Partial erasing"],
  ["de-DE", "Aufnahme", "Füller", "Teilweise radieren"],
  ["fr-FR", "Enregistrement", "Stylo-plume", "Gommage partiel"],
  ["zh-HK", "錄製", "鋼筆", "局部擦除"],
])(
  "uses current recording and drawing terminology in %s",
  async (code, recording, fountain, erasing) => {
    await setLanguage({ code, label: code });
    expect([
      t("fcboard.recording"),
      t("fcboard.fountain"),
      t("fcboard.erase_part_of_a_stroke"),
    ]).toEqual([recording, fountain, erasing]);
  },
);
