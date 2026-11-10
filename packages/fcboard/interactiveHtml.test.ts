import { interactiveHtml } from "./interactiveHtml";
import { resourceFrame } from "./tests/resourceFrame";

const lesson = `<h1>Acceleration</h1><input type="range"><svg viewBox="0 0 400 100"><rect width="40" height="40" /></svg><output>2 m/s²</output><script>document.querySelector('input').oninput=()=>{};</script>`;

it("preserves an authored HTML theme instead of overriding it with lesson defaults", () => {
  const source = `<html><head><style>body{background:rgb(10,20,30);color:rgb(240,220,180);font-family:Georgia}</style></head><body>${lesson}</body></html>`;
  const html = interactiveHtml(source);
  expect(interactiveHtml(html)).toBe(html);
  const frame = resourceFrame({
    id: "styled-lesson",
    surface: "whiteboard",
    html,
  });
  try {
    const style = frame.window.getComputedStyle(frame.window.document.body);
    expect(style.backgroundColor).toBe("rgb(10, 20, 30)");
    expect(style.color).toBe("rgb(240, 220, 180)");
    expect(style.fontFamily).toContain("Georgia");
  } finally {
    frame.dispose();
    vi.unstubAllGlobals();
  }
});

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
  '<h1>匀速运动</h1><svg viewBox="0 0 400 100"><circle cy="50" r="10"><animate attributeName="cx" from="20" to="380" dur="4s" repeatCount="indefinite" /></circle></svg>',
  '<style>@keyframes travel{to{transform:translateX(300px)}}circle{animation:travel 4s linear infinite}</style><h1>匀速运动</h1><svg viewBox="0 0 400 100"><circle cx="20" cy="50" r="10" /></svg>',
  '<style>@keyframes travel{to{transform:translateX(300px)}}.car{width:40px;height:20px;background:teal;animation:travel 4s linear infinite}</style><h1>匀速运动</h1><div class="car"></div>',
])(
  "retains a self-contained graphical animation without requiring authored JavaScript",
  (source) => {
    const html = interactiveHtml(source);
    expect(html).toContain("匀速运动");
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain(source.includes(".car") ? 'class="car"' : "<svg");
    expect(interactiveHtml(html)).toBe(html);
  },
);

it("accepts a visual explanation without inventing a mandatory interaction", () => {
  const source =
    '<h1>平衡力</h1><svg viewBox="0 0 200 100"><rect x="80" y="30" width="40" height="40"/><path d="M20 50H80M120 50H180" stroke="teal"/></svg>';
  expect(interactiveHtml(source)).toContain('<rect x="80"');
});

it.each([
  "<h1>Static diagram</h1>",
  "<button>Dead button</button><output>1</output>",
  "<input><output>2</output><script>document.querySelector('input').oninput=()=>{};</script>",
  `<form>${lesson}</form>`,
  "<button>Dead button</button><output>1</output><script data-fc-lesson-controls>fake bootstrap</script>",
  "x".repeat(120001),
])("rejects an invalid or static lesson", (html) => {
  expect(() => interactiveHtml(html)).toThrow();
});
