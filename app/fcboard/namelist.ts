export const namelistFileLimit = 8 * 1024 * 1024;
const invalid = () => new Error("namelist_invalid");

/** RFC4180 quoting also preserves punctuation inside imported personal names. */
export const delimitedRows = (text: string, separators: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const field = () => {
    row.push(cell.trim());
    cell = "";
    if (row.length > 256) {
      throw invalid();
    }
  };
  const line = () => {
    field();
    if (row.some(Boolean)) {
      rows.push(row);
    }
    row = [];
    if (rows.length > 5001) {
      throw invalid();
    }
  };
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || !cell.trim()) {
        quoted = !quoted;
      } else {
        cell += character;
      }
    } else if (!quoted && separators.includes(character)) {
      field();
    } else if (!quoted && /[\r\n]/.test(character)) {
      line();
      if (character === "\r" && text[i + 1] === "\n") {
        i++;
      }
    } else {
      cell += character;
    }
  }
  if (quoted) {
    throw invalid();
  }
  line();
  return rows;
};

export const parseNamelist = (text: string) =>
  delimitedRows(text, ",，;；\t").flat().filter(Boolean);

export const namelistText = (names: readonly string[]) =>
  names
    .map((name) =>
      /[",，;；\t\r\n]/.test(name) ? `"${name.replace(/"/g, '""')}"` : name,
    )
    .join("\n");
