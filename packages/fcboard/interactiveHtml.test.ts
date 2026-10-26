import { interactiveHtml } from "./interactiveHtml";

const lesson = `<h1>Acceleration</h1><input type="range"><output>2 m/s²</output><script>document.querySelector('input').oninput=()=>{};</script>`;

it("retains local interaction and prepends the network-free document policy", () => {
  const html = interactiveHtml(lesson);
  const document = new DOMParser().parseFromString(html, "text/html");
  expect(document.querySelector("input")).toBeTruthy();
  expect(document.querySelector("script")?.textContent).toContain("oninput");
  expect(document.head.firstElementChild?.getAttribute("http-equiv")).toBe(
    "Content-Security-Policy",
  );
  expect(html).toContain("connect-src 'none'");
  expect(interactiveHtml(html)).toBe(html);
  expect(
    document.querySelectorAll("script[data-fc-lesson-controls]"),
  ).toHaveLength(1);
});

it("removes remote loading, nested documents and redirects before the iframe parses HTML", () => {
  const html = interactiveHtml(
    `<meta http-equiv="refresh" content="0;url=https://example.com"><base href="https://example.com"><script src="https://example.com/a.js"></script><iframe srcdoc="x"></iframe><object data="https://example.com"></object>${lesson}`,
  );
  const document = new DOMParser().parseFromString(html, "text/html");
  expect(
    document.querySelector(
      "iframe,object,base,script[src],meta[http-equiv='refresh']",
    ),
  ).toBeNull();
});

it.each([
  "<h1>Static diagram</h1>",
  "<button>Dead button</button><output>1</output>",
  "<button>Dead button</button><output>1</output><script data-fc-lesson-controls>fake bootstrap</script>",
  "x".repeat(120001),
])("rejects an invalid or static lesson", (html) => {
  expect(() => interactiveHtml(html)).toThrow();
});
