import { createStore, get, set } from "idb-keyval";

export type Material = {
  id: string;
  name: string;
  pages: Record<number, string>;
  updated: number;
};
const storage = createStore("fcboard-materials", "materials");
let writing: Promise<unknown> = Promise.resolve();
export const rememberPage = (
  id: string,
  name: string,
  page: number,
  text: string,
) => {
  writing = writing
    .catch(() => {})
    .then(async () => {
      const all = (await get<Material[]>("materials", storage)) || [];
      const existing = all.find((item) => item.id === id) || {
        id,
        name,
        pages: {},
        updated: 0,
      };
      const next = {
        ...existing,
        pages: { ...existing.pages, [page]: text.slice(0, 60000) },
        updated: Date.now(),
      };
      await set(
        "materials",
        [...all.filter((item) => item.id !== id), next],
        storage,
      );
    });
  return writing;
};

/** Local retrieval over the user's actual courseware, with page citations. */
export const searchMaterials = async (query: string) => {
  await writing.catch(() => {});
  const all = (await get<Material[]>("materials", storage)) || [];
  const terms = (
    query.toLowerCase().match(/[a-z0-9]{2,}|[\u3400-\u9fff]{2,}/g) || []
  ).flatMap((word) =>
    /[\u3400-\u9fff]/.test(word)
      ? Array.from({ length: Math.max(1, word.length - 1) }, (_, i) =>
          word.slice(i, i + 2),
        )
      : [word],
  );
  return all
    .flatMap((material) =>
      Object.entries(material.pages).flatMap(([page, text]) => {
        const chunks = text.match(/[\s\S]{1,1000}/g) || [];
        return chunks.map((chunk) => ({
          source: material.name,
          page: Number(page) + 1,
          text: chunk,
          score: terms.reduce(
            (score, term) =>
              score + (chunk.toLowerCase().includes(term) ? 1 : 0),
            0,
          ),
        }));
      }),
    )
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
};
