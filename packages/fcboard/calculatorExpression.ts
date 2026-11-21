type Token =
  | { type: "number"; value: number }
  | { type: "name" | "symbol"; value: string };

function formatResult(value: number) {
  if (!Number.isFinite(value)) {
    throw new Error("Math error");
  }
  const rounded = Number(value.toPrecision(13));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function tokenize(source: string) {
  const tokens: Token[] = [];
  const tokenPattern =
    /\s*(?:(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?|([a-zA-Z][a-zA-Z0-9]*)|([()+\-*/%^!×÷]))/gy;
  let position = 0;

  while (position < source.length) {
    tokenPattern.lastIndex = position;
    const match = tokenPattern.exec(source);
    if (!match) {
      throw new Error("Invalid expression");
    }
    position = tokenPattern.lastIndex;
    if (match[1] !== undefined) {
      const value = Number(
        match[1] + (match[2] === undefined ? "" : `e${match[2]}`),
      );
      if (!Number.isFinite(value)) {
        throw new Error("Number out of range");
      }
      tokens.push({ type: "number", value });
    } else if (match[3] !== undefined) {
      tokens.push({ type: "name", value: match[3] });
    } else {
      tokens.push({ type: "symbol", value: match[4] });
    }
  }

  return tokens;
}

export function evaluateCalculator(source: string, isDegrees: boolean) {
  const tokens = tokenize(source);
  let cursor = 0;
  const peek = (): Token | undefined => tokens[cursor];
  const consume = (): Token | undefined => tokens[cursor++];
  const matchSymbol = (symbol: string) => {
    const token = peek();
    if (token?.type === "symbol" && token.value === symbol) {
      consume();
      return true;
    }
    return false;
  };
  const toRadians = (value: number) =>
    isDegrees ? (value * Math.PI) / 180 : value;
  const fromRadians = (value: number) =>
    isDegrees ? (value * 180) / Math.PI : value;

  function parseExpression(): number {
    let value = parseTerm();
    while (true) {
      const token = peek();
      if (token?.type !== "symbol" || !["+", "-"].includes(token.value)) {
        return value;
      }
      consume();
      const right = parseTerm();
      value = token.value === "+" ? value + right : value - right;
    }
  }

  function startsImplicitProduct(token: Token) {
    return (
      token &&
      (token.type === "number" ||
        token.type === "name" ||
        (token.type === "symbol" && token.value === "("))
    );
  }

  function parseTerm(): number {
    let value = parseUnary();
    for (let token = peek(); token; token = peek()) {
      if (
        token.type === "symbol" &&
        ["*", "×", "/", "÷", "%"].includes(token.value)
      ) {
        consume();
        const operator = token.value;
        const right = parseUnary();
        if (
          (operator === "/" || operator === "÷" || operator === "%") &&
          right === 0
        ) {
          throw new Error("Cannot divide by zero");
        }
        if (operator === "*" || operator === "×") {
          value *= right;
        } else if (operator === "/" || operator === "÷") {
          value /= right;
        } else {
          value %= right;
        }
      } else if (startsImplicitProduct(token)) {
        value *= parseUnary();
      } else {
        break;
      }
    }
    return value;
  }

  function parseUnary(): number {
    if (matchSymbol("+")) {
      return parseUnary();
    }
    if (matchSymbol("-")) {
      return -parseUnary();
    }
    return parsePower();
  }

  function parsePower(): number {
    let value = parsePostfix();
    if (matchSymbol("^")) {
      value = Math.pow(value, parseUnary());
    }
    return value;
  }

  function parsePostfix(): number {
    let value = parsePrimary();
    while (matchSymbol("!")) {
      value = factorial(value);
    }
    return value;
  }

  function parsePrimary(): number {
    const token = consume();
    if (!token) {
      throw new Error("Incomplete expression");
    }
    if (token.type === "number") {
      return token.value;
    }

    if (token.type === "symbol" && token.value === "(") {
      const value = parseExpression();
      if (!matchSymbol(")")) {
        throw new Error("Missing closing parenthesis");
      }
      return value;
    }

    if (token.type === "name") {
      const name = token.value.toLowerCase();
      if (name === "pi") {
        return Math.PI;
      }
      if (name === "e") {
        return Math.E;
      }

      if (!matchSymbol("(")) {
        throw new Error("Function needs parentheses");
      }
      const argument = parseExpression();
      if (!matchSymbol(")")) {
        throw new Error("Missing closing parenthesis");
      }
      const functions: Record<string, (value: number) => number> = {
        sin: (x) => Math.sin(toRadians(x)),
        cos: (x) => Math.cos(toRadians(x)),
        tan: (x) => {
          const radians = toRadians(x);
          if (Math.abs(Math.cos(radians)) < 1e-14) {
            throw new Error("Undefined");
          }
          return Math.tan(radians);
        },
        asin: (x) => fromRadians(Math.asin(x)),
        acos: (x) => fromRadians(Math.acos(x)),
        atan: (x) => fromRadians(Math.atan(x)),
        sqrt: Math.sqrt,
        cbrt: Math.cbrt,
        exp: Math.exp,
        pow10: (x) => Math.pow(10, x),
        pct: (x) => x / 100,
        square: (x) => x ** 2,
        cube: (x) => x ** 3,
        reciprocal: (x) => {
          if (x === 0) {
            throw new Error("Cannot divide by zero");
          }
          return 1 / x;
        },
        log: Math.log10,
        ln: Math.log,
        abs: Math.abs,
        round: Math.round,
        floor: Math.floor,
        ceil: Math.ceil,
        fact: factorial,
      };
      if (!Object.hasOwn(functions, name)) {
        throw new Error("Unknown function");
      }
      return functions[name](argument);
    }

    throw new Error("Invalid expression");
  }

  const result = parseExpression();
  if (cursor !== tokens.length) {
    throw new Error("Invalid expression");
  }
  return formatResult(result);
}

export function closeOpenParentheses(source: string) {
  let depth = 0;
  for (const character of source) {
    if (character === "(") {
      depth += 1;
    }
    if (character === ")") {
      depth -= 1;
    }
    if (depth < 0) {
      throw new Error("Invalid parentheses");
    }
  }
  return source + ")".repeat(depth);
}

function factorial(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 170) {
    throw new Error("Factorial requires an integer from 0 to 170");
  }
  let result = 1;
  for (let number = 2; number <= value; number += 1) {
    result *= number;
  }
  return result;
}
