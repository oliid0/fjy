import { t } from "@fcboard/fcboard/i18n";

import {
  localMathIntent,
  selectionMathIntent,
  selectionRequest,
  selectionAIAction,
} from "./intent";

describe("local mathematical voice commands", () => {
  it("distinguishes explicit selected requests from ordinary headings", () => {
    for (const text of [
      "牛顿定律是什么？",
      "讲解牛顿定律",
      "录制这节课",
      "帮我画一个受力图",
    ]) {
      expect(selectionRequest(text)).toBe(true);
    }
    for (const text of ["课堂笔记", "画布", t("fcboard.pen"), "牛顿定律"]) {
      expect(selectionRequest(text)).toBe(false);
    }
  });
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
  it("interprets selected math directly while leaving prose and completed answers alone", () => {
    for (const expression of [
      "1+1=",
      "sqrt(-1)",
      "diff(x^3,x)",
      "integrate(sin(x),x)",
    ]) {
      expect(selectionMathIntent(expression)?.action).toBe("calculate");
    }
    expect(selectionMathIntent("f(x)=a*x+1")).toEqual({
      action: "plot",
      expression: "a*x+1",
      surface: false,
    });
    expect(selectionMathIntent("f(x,y)=sin(x*y)")?.action).toBe("plot");
    expect(selectionMathIntent("fx=y")?.action).toBe("axes");
    expect(selectionMathIntent("f(x)=y")?.action).toBe("axes");
    for (const text of [
      "课堂笔记",
      "chapter-one",
      "2",
      "1+1=2",
      "f(x)=unknown(x)",
    ]) {
      expect(selectionMathIntent(text)).toBeNull();
    }
  });
});

it("routes the single AI entry without calculating or generating images during classification", () => {
  for (const value of [
    "1+1=",
    "5!",
    "7%3",
    "det([1,2;3,4])",
    "\\frac{1}{2}",
    "integrate(x,x)",
    "x^2-4=0",
  ]) {
    expect(selectionAIAction(value)).toBe("calculate");
  }
  for (const value of [
    "y=x^2",
    "y>2*x+1",
    "f(x,y)=sin(x*y)",
    "x^2",
    "fx=y",
    "f(x)=unknown(x)",
  ]) {
    expect(selectionAIAction(value)).toBe("image");
  }
  for (const value of [
    "讲解牛顿定律",
    "牛顿第一定律是什么？",
    "chapter-one",
    "bonjour",
  ]) {
    expect(selectionAIAction(value)).toBe("question");
  }
});
