import es from "@fcboard/fcboard/locales/es-ES.json";
import en from "@fcboard/fcboard/locales/en.json";
import { JSDOM, VirtualConsole } from "jsdom";

import calculator from "./calculator.html?raw";

it("runs the copied offline calculator's actual buttons, keyboard and scientific parser without storage or CDNs", () => {
  const errors = [];
  const console = new VirtualConsole();
  console.on("jsdomError", (error) => errors.push(error.message));
  // about:blank is deliberately opaque, as is the production allow-scripts iframe.
  const dom = new JSDOM(
    calculator.replace(
      "__FCBOARD_CALCULATOR_I18N__",
      JSON.stringify({ language: "en", strings: en.fcboard.calculatorUi }),
    ),
    {
      runScripts: "dangerously",
      pretendToBeVisual: true,
      virtualConsole: console,
      beforeParse(window) {
        window.matchMedia = () => ({ matches: false });
      },
    },
  );
  try {
    const { document } = dom.window;
    const press = (key) =>
      document.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key, bubbles: true }),
      );
    for (const key of ["9", "+", "9"]) {
      press(key);
    }
    expect(document.getElementById("input-display").textContent).toBe("9+9");
    expect(document.getElementById("result-display").textContent).toBe("18");
    press("Enter");
    expect(document.getElementById("history-display").textContent).toBe(
      "9+9 =",
    );
    expect(document.getElementById("result-display").textContent).toBe("18");
    press("Escape");
    for (const key of ["2", "+", "3", "*", "4", "Enter"]) {
      press(key);
    }
    expect(document.getElementById("result-display").textContent).toBe("14");
    document.getElementById("btn-scientific").click();
    expect(document.getElementById("mobile-scientific-drawer")).not.toHaveClass(
      "hidden",
    );
    expect(dom.window.evaluate("sin(30)")).toBe("0.5");
    expect(dom.window.evaluate("sqrt(81)+fact(4)")).toBe("33");
    press("Escape");
    press("9");
    press("2");
    press("Backspace");
    press("Enter");
    expect(document.getElementById("result-display").textContent).toBe("9");
    expect(document.querySelectorAll("script[src],link[href]")).toHaveLength(0);
    expect(document.getElementById("result-display")).toHaveAttribute(
      "aria-live",
    );
    expect(errors).toEqual([]);
  } finally {
    dom.window.close();
  }
});

it("fills independently resized object bounds without scaling a fixed calculator", () => {
  const dom = new JSDOM(calculator);
  try {
    expect(calculator).not.toContain("fitCalculator");
    expect(calculator).not.toContain("width: 180px !important");
    const styles = dom.window.document.querySelector("style").textContent;
    expect(styles).toContain("grid-template-rows: repeat(5, minmax(0, 1fr))");
    expect(styles).toContain("width: 100% !important");
    expect(styles).toContain("height: 100% !important");
  } finally {
    dom.window.close();
  }
});

it("changes actual calculator labels and errors without clearing the current expression or scientific mode", () => {
  const dom = new JSDOM(
    calculator.replace(
      "__FCBOARD_CALCULATOR_I18N__",
      JSON.stringify({ language: "es-ES", strings: es.fcboard.calculatorUi }),
    ),
    {
      runScripts: "dangerously",
      pretendToBeVisual: true,
      beforeParse(window) {
        window.matchMedia = () => ({ matches: false });
      },
    },
  );
  try {
    const { document } = dom.window;
    expect(document.documentElement.lang).toBe("es-ES");
    expect(document.getElementById("btn-basic").textContent).toBe(
      es.fcboard.calculatorUi.basic,
    );
    expect(
      document.getElementById("calculator-close").getAttribute("aria-label"),
    ).toBe(es.fcboard.calculatorUi.close_calculator);
    document.getElementById("btn-scientific").click();
    for (const key of ["9", "+", "2"]) {
      document.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key, bubbles: true }),
      );
    }
    dom.window.dispatchEvent(
      new dom.window.MessageEvent("message", {
        source: dom.window,
        data: {
          channel: "fc-calculator-language",
          localization: { language: "en", strings: en.fcboard.calculatorUi },
        },
      }),
    );
    expect(document.documentElement.lang).toBe("en");
    expect(document.getElementById("btn-basic").textContent).toBe(
      en.fcboard.calculatorUi.basic,
    );
    expect(document.getElementById("input-display").textContent).toBe("9+2");
    expect(document.getElementById("result-display").textContent).toBe("11");
    expect(document.getElementById("mobile-scientific-drawer")).not.toHaveClass(
      "hidden",
    );
    dom.window.clearCalculator();
    dom.window.clearCalculator();
    for (const key of ["1", "/", "0", "Enter"]) {
      document.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key, bubbles: true }),
      );
    }
    expect(document.getElementById("result-display").textContent).toBe(
      en.fcboard.calculatorUi.error,
    );
  } finally {
    dom.window.close();
  }
});
