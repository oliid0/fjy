import { localMathIntent } from "./intent";

describe("local mathematical voice commands", () => {
  it("handles explicit functions, Mandarin operators, complex numbers and calculus", () => {
    expect(localMathIntent("帮我画 y 等于 x 加一的函数图像")).toEqual({
      action: "plot",
      expression: "x+1",
      surface: false,
    });
    expect(localMathIntent("画 z=sin(x*y)")).toEqual({
      action: "plot",
      expression: "sin(x*y)",
      surface: true,
    });
    expect(localMathIntent("帮我计算 sqrt(-1)")).toEqual({
      action: "calculate",
      expression: "sqrt(-1)",
    });
    expect(localMathIntent("计算 diff(x^3,x)")).toEqual({
      action: "calculate",
      expression: "diff(x^3,x)",
    });
    expect(localMathIntent("计算一加一")).toEqual({
      action: "calculate",
      expression: "1+1",
    });
  });
  it("leaves ambiguous or unsupported expressions to AI instead of guessing", () => {
    expect(localMathIntent("帮我计算一下")).toBeNull();
    expect(localMathIntent("计算十二加一")).toBeNull();
    expect(localMathIntent("画 y=unknown(x)")).toBeNull();
    expect(localMathIntent("帮我总结")).toBeNull();
  });
});
