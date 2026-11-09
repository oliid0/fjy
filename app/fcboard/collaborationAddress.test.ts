import { collaborationAddress } from "./collaborationAddress";

it("resolves a real collaboration code against the configured server and preserves explicit host links", () => {
  const code = "0123456789abcdef0123456789abcdef";
  expect(collaborationAddress(code, "https://board.example/")).toBe(
    `https://board.example/#lan=${code}`,
  );
  expect(
    collaborationAddress(
      `http://192.168.1.2:8090/#lan=${code}`,
      "https://board.example/",
    ),
  ).toBe(`http://192.168.1.2:8090/#lan=${code}`);
});
it.each([
  "123456",
  ["java", "script:alert(1)"].join(""),
  "https://board.example/#lan=123",
  "https://user:secret@board.example/#lan=0123456789abcdef0123456789abcdef",
  "https://board.example/other/#lan=0123456789abcdef0123456789abcdef",
])("rejects invalid joining input %s", (input) => {
  expect(() => collaborationAddress(input, "https://board.example/")).toThrow();
});
