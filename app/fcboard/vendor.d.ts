declare module "nerdamer/all" {
  type Expression = { toString(): string };
  const nerdamer: {
    (expression: string, substitutions?: Record<string, string>): Expression;
    solveEquations(
      expression: string | string[],
      variable?: string | string[],
    ): Expression[] | [string, number | string][];
  };
  export default nerdamer;
}
