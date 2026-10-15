declare module "nerdamer/all" {
  const nerdamer: (expression: string) => {toString(): string};
  export default nerdamer;
}
