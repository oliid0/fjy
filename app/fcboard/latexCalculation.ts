import "../../packages/fcboard/vendor/vega/compatibility.js";

// WebView 95 needs structuredClone before the compute engine evaluates.
// eslint-disable-next-line import/order
import { ComputeEngine } from "@cortex-js/compute-engine";

/** Only imported in the terminable calculation worker, never in the ink path. */
export const calculateLatex = (input: string): string => {
  if (!input.trim() || input.length > 2000 || /:=/.test(input)) {
    throw new Error("Invalid mathematical expression");
  }
  const engine = new ComputeEngine({ precision: 32 });
  return engine.withTimeLimit(1800, () => {
    const expression = engine.parse(input);
    let count = 0;
    const inspect = (value: unknown, depth = 0) => {
      if (++count > 500 || depth > 40) {
        throw new Error("Mathematical expression is too large");
      }
      if (Array.isArray(value)) {
        if (
          /^(Assign|Declare|Set|Assume|Forget|Loop|While|If|Return|Break|Continue|Evaluate|Apply|Parse|Error)$/.test(
            String(value[0]),
          )
        ) {
          throw new Error("Unsupported calculation operation");
        }
        value.slice(1).forEach((child) => inspect(child, depth + 1));
      }
    };
    inspect(expression.json);
    if (!expression.isValid || expression.unknowns.length) {
      throw new Error("Incomplete or ambiguous mathematical expression");
    }
    const result = expression.evaluate();
    const finite = (
      value: NonNullable<ReturnType<typeof engine.parse>>,
    ): boolean => {
      const json = value.json;
      return Array.isArray(json) && json[0] === "List"
        ? json.length > 1 &&
            json.slice(1).every((cell) => finite(engine.box(cell)))
        : value.isFinite === true;
    };
    // Unknown functions can parse successfully. They must produce a finite
    // mathematical value before an answer may replace any source ink.
    const answer = finite(result) ? result : result.N();
    const text = answer.toString();
    if (!answer.isValid || !finite(answer) || !text || text.length > 4000) {
      throw new Error("This expression has no available finite result");
    }
    return text;
  });
};
