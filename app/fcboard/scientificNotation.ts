type Atom = { start: number; end: number; source: string };

/** Read one explicitly delimited operand, preserving its internal expression.
 * This is notation conversion only: the validated mathjs AST does evaluation. */
const atom = (text: string, from: number, depth = 0): Atom | undefined => {
  if (depth > 24) {
    throw new Error("Mathematical notation is too deeply nested");
  }
  let start = from;
  while (/[ \t]/.test(text[start] || "\n")) {
    start++;
  }
  let end = start;
  if (/[+-]/.test(text[end] || " ")) {
    end++;
  }
  const number = text
    .slice(end)
    .match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
  const name = text.slice(end).match(/^[A-Za-z]+/);
  if (number) {
    end += number[0].length;
  } else if (name) {
    end += name[0].length;
  }
  if (text[end] === "(" && !number) {
    let nesting = 0;
    do {
      if (text[end] === "(") {
        nesting++;
      }
      if (text[end] === ")") {
        nesting--;
      }
      if (nesting > 32 || /[\r\n]/.test(text[end])) {
        return;
      }
      end++;
    } while (end < text.length && nesting);
    if (nesting) {
      return;
    }
  } else if (!number && !name) {
    return;
  }
  if (text[end] === "^") {
    const power = atom(text, end + 1, depth + 1);
    if (!power) {
      return;
    }
    end = power.end;
  }
  let degree = end;
  while (/[ \t]/.test(text[degree] || "\n")) {
    degree++;
  }
  if (text[degree] === "°") {
    end = degree + 1;
  }
  return { start, end, source: text.slice(start, end) };
};

const replaceOperand = (
  text: string,
  pattern: RegExp,
  replace: (match: RegExpExecArray, argument: string) => string,
) => {
  let output = "";
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const argument = atom(text, pattern.lastIndex);
    if (!argument) {
      continue;
    }
    output += `${text.slice(cursor, match.index)}${replace(
      match,
      argument.source,
    )}`;
    cursor = argument.end;
    pattern.lastIndex = cursor;
  }
  return output + text.slice(cursor);
};

export const scientificNotation = (input: string) => {
  let text = input;
  // Explicit log bases, including Unicode subscripts normalised by mathNotation.
  const basePattern = /(^|[^A-Za-z_])log_\s*/g;
  let match: RegExpExecArray | null;
  let output = "";
  let cursor = 0;
  while ((match = basePattern.exec(text))) {
    const base = atom(text, basePattern.lastIndex);
    const argument = base && atom(text, base.end);
    if (!base || !argument) {
      continue;
    }
    output += `${text.slice(cursor, match.index)}${match[1]}log(${
      argument.source
    },${base.source})`;
    cursor = argument.end;
    basePattern.lastIndex = cursor;
  }
  text = output + text.slice(cursor);
  text = replaceOperand(
    text,
    /(^|[^A-Za-z_])(sin|cos|tan|sinh|cosh|tanh|log|ln)\s*\^\s*(\([+-]?\d+\)|[+-]?\d+)\s*/g,
    (match, argument) => {
      const inverse =
        Number(match[3].replace(/[()]/g, "")) === -1 &&
        /^(sin|cos|tan)$/.test(match[2]);
      return inverse
        ? `${match[1]}a${match[2]}(${argument})`
        : `${match[1]}(${match[2]}(${argument}))^${match[3]}`;
    },
  );
  text = replaceOperand(
    text,
    /(^|[^A-Za-z_])(asinh|acosh|atanh|sinh|cosh|tanh|asin|acos|atan|sin|cos|tan|sqrt|cbrt|exp|log10|log2|log(?![12]0?\()|ln)([ \t]*)(?=[+\-.\dxyz])/g,
    (match, argument) => {
      // log24 is ambiguous; log2 4 and log₂4 explicitly identify their base.
      if (/\d$/.test(match[2]) && !match[3]) {
        return match[0] + argument;
      }
      return `${match[1]}${match[2] === "ln" ? "log" : match[2]}(${argument})`;
    },
  );
  text = replaceOperand(
    text,
    /([√∛])[ \t]*/g,
    (match, argument) => `${match[1] === "√" ? "sqrt" : "cbrt"}(${argument})`,
  );

  // A degree marker belongs to its preceding numeric or parenthesised operand.
  // Unmarked trigonometric arguments retain the existing radian convention.
  for (let index = text.indexOf("°"); index >= 0; index = text.indexOf("°")) {
    let end = index;
    while (/[ \t]/.test(text[end - 1] || "\n")) {
      end--;
    }
    let start = end;
    if (text[end - 1] === ")") {
      let nesting = 1;
      start--;
      while (start > 0 && nesting) {
        start--;
        if (text[start] === ")") {
          nesting++;
        }
        if (text[start] === "(") {
          nesting--;
        }
      }
      if (nesting) {
        throw new Error("Unbalanced angle expression");
      }
      const fn = text.slice(0, start).match(/[A-Za-z]+$/);
      if (fn) {
        start -= fn[0].length;
      }
    } else {
      const value = text
        .slice(0, end)
        .match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$|[xyz]$/);
      if (!value) {
        throw new Error("A degree marker needs an angle");
      }
      start -= value[0].length;
    }
    text = `${text.slice(0, start)}((${text.slice(
      start,
      end,
    )})*pi/180)${text.slice(index + 1)}`;
  }
  return text;
};
