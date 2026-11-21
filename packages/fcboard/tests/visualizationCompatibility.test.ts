import { runInNewContext } from "node:vm";

import compatibility from "../vendor/vega/compatibility.js?raw";

it("clones Vega-Lite structures on WebView 95, including cycles, maps, sets and dates", () => {
  expect(
    runInNewContext(
      `${compatibility}
    const original = {date:new Date(1000),values:new Set([1,2]),map:new Map([['x',3]]),missing:undefined,negative:-0};
    original.self=original;
    const copy=structuredClone(original);
    copy.values.add(3);
    [copy!==original,copy.self===copy,copy.date.getTime()===1000,copy.map.get('x')===3,original.values.size===2,'missing' in copy,Object.is(copy.negative,-0)].every(Boolean);
  `,
      { structuredClone: undefined },
    ),
  ).toBe(true);
});

it("preserves a browser's native structuredClone and refuses unserializable functions", () => {
  const native = vi.fn();
  const context = { structuredClone: native };
  runInNewContext(compatibility, context);
  expect(context.structuredClone).toBe(native);
  expect(() =>
    runInNewContext(
      `${compatibility};structuredClone({callback:function(){}})`,
      { structuredClone: undefined },
    ),
  ).toThrow("unable to serialize function");
});
