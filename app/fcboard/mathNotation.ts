/** A deliberately small notation grammar: unsupported/ambiguous layouts stay ink. */
export const mathNotation = (input: string): string => {
  if (input.length > 500) {
    throw new Error("Math input is too long");
  }
  let text = input
    .trim()
    .replace(/[＝]/g, "=")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/π/g, "pi")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/\*\*/g, "^")
    .replace(/∞/g, "Infinity")
    .replace(/≥|\\geq?\b/g, ">=")
    .replace(/≤|\\leq?\b/g, "<=")
    .replace(/\\\(|\\\)|\\\[|\\\]/g, "")
    .replace(/^\$|\$$/g, "")
    .replace(/\\(?:left|right)\b/g, "")
    .replace(/\\(?:cdot|times)\b/g, "*")
    .replace(/\\div\b/g, "/")
    .replace(/\\pi\b/g, "pi")
    .replace(/\\(?:,|;|!|quad\b|qquad\b)/g, " ")
    .replace(/\\(sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|log|exp)\b/g, "$1")
    .replace(/\\ln\b/g, "log");
  text = text
    .replace(
      /\\?\b(arcsin|arccos|arctan|ln)\b/g,
      (_, name: string) =>
        ({ arcsin: "asin", arccos: "acos", arctan: "atan", ln: "log" }[name]!),
    )
    .replace(/(sin|cos|tan)\^\{?-1\}?\s*\(/g, "a$1(")
    .replace(/(?:\\log|log)_\{?(2|10)\}?\s*\(/g, "log$1(")
    .replace(/\\(?:pmod|bmod)\s*\{([^{}]+)\}/g, "%($1)")
    .replace(/\\(?:pmod|bmod)\b/g, "%")
    .replace(/\\(?:lvert|rvert|vert)\b/g, "|")
    .replace(/\|([^|]+)\|/g, "abs($1)")
    .replace(/\\frac\{d\}\{d\s*([xyz])\}/g, "\\derivative_($1)");

  // Rows and columns must be explicit; never infer a matrix from spacing alone.
  text = text.replace(
    /\\begin\{(bmatrix|pmatrix|matrix)\}([\s\S]*?)\\end\{\1\}/g,
    (_, _kind: string, body: string) => {
      const rows = body
        .trim()
        .split(/\\\\/)
        .map((row) => row.trim().split("&"));
      if (
        !rows.length ||
        rows.length > 12 ||
        rows.some(
          (row) =>
            row.length !== rows[0].length ||
            row.length > 12 ||
            row.some((cell) => !cell.trim()),
        )
      ) {
        throw new Error("Invalid matrix layout");
      }
      return `[${rows.map((row) => row.join(",")).join(";")}]`;
    },
  );
  // Work from the innermost braces out, with a fixed input/iteration budget.
  for (
    let depth = 0;
    depth < 32 && /\\(?:frac|sqrt)|[{}]/.test(text);
    depth++
  ) {
    const previous = text;
    text = text
      .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "(($1)/($2))")
      .replace(/\\sqrt\[(\d+)\]\{([^{}]+)\}/g, "nthRoot($2,$1)")
      .replace(/\\sqrt\{([^{}]+)\}/g, "sqrt($1)")
      .replace(/([_^])\{([^{}]+)\}/g, "$1($2)");
    if (text === previous) {
      break;
    }
  }
  // Only an explicit differential closes an integral; no guessed variable/bounds.
  const integral = text.match(
    /^\\int(?:_\(([^()]+)\)\^\(([^()]+)\)|_([\w.+-]+)\^([\w.+-]+))?\s*(.+?)\s*(?:\\mathrm\{d\}|d)\s*([xyz])\s*=?$/,
  );
  if (integral) {
    const [, a, b, c, d, body, variable] = integral;
    text =
      a !== undefined || c !== undefined
        ? `defint(${body},${a ?? c},${b ?? d},${variable})`
        : `integrate(${body},${variable})`;
  }
  const limit = text.match(/^\\lim_\(([xyz])\s*\\to\s*([^()]+)\)\s*(.+)$/);
  if (limit) {
    text = `limit(${limit[3]},${limit[1]},${limit[2]})`;
  }
  const derivative = text.match(/^\\derivative_\(([xyz])\)\s*(.+)$/);
  if (derivative) {
    text = `diff(${derivative[2]},${derivative[1]})`;
  }
  const series = text.match(
    /^\\(sum|prod)_\(([a-z])\s*=\s*([^()]+)\)\^\(([^()]+)\)\s*(.+)$/,
  );
  if (series) {
    text = `${series[1] === "sum" ? "sum" : "product"}(${series[5]},${
      series[2]
    },${series[3]},${series[4]})`;
  }
  if (/[{}\\]/.test(text)) {
    throw new Error("Unsupported mathematical notation");
  }
  // Explicit long-division notation puts the divisor before the bracket.
  text = text.replace(
    /^(\d+(?:\.\d+)?)\s*[)⟌]\s*(\d+(?:\.\d+)?)\s*$/,
    "($2)/($1)",
  );
  const rows = text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);
  if (rows.length > 1 && !text.includes("[")) {
    if (rows.every((row) => /^[^=]+=[^=]+$/.test(row))) {
      return rows.join(";");
    }
    // A vertical sum/product needs an operator on each subsequent operand.
    const operands = rows.filter((row) => !/^[-_=─━]{2,}$/.test(row));
    if (
      !/^\d+(?:\.\d+)?$/.test(operands[0]) ||
      operands.length < 2 ||
      operands.slice(1).some((row) => !/^[+*/-]\s*\d+(?:\.\d+)?$/.test(row))
    ) {
      throw new Error("Ambiguous multiline mathematics");
    }
    text = operands.join("");
  }
  return text.replace(/\s*=\s*$/, "").trim();
};
