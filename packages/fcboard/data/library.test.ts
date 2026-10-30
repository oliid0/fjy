import { validateLibraryUrl } from "./library";

describe("validateLibraryUrl", () => {
  it("should validate hostname & pathname", () => {
    // valid hostnames
    // -------------------------------------------------------------------------
    expect(validateLibraryUrl("https://www.fcboard.com", ["fcboard.com"])).toBe(
      true,
    );
    expect(validateLibraryUrl("https://fcboard.com", ["fcboard.com"])).toBe(
      true,
    );
    expect(
      validateLibraryUrl("https://library.fcboard.com", ["fcboard.com"]),
    ).toBe(true);
    expect(
      validateLibraryUrl("https://library.fcboard.com", [
        "library.fcboard.com",
      ]),
    ).toBe(true);
    expect(validateLibraryUrl("https://fcboard.com/", ["fcboard.com/"])).toBe(
      true,
    );
    expect(validateLibraryUrl("https://fcboard.com", ["fcboard.com/"])).toBe(
      true,
    );
    expect(validateLibraryUrl("https://fcboard.com/", ["fcboard.com"])).toBe(
      true,
    );

    // valid pathnames
    // -------------------------------------------------------------------------
    expect(
      validateLibraryUrl("https://fcboard.com/path", ["fcboard.com"]),
    ).toBe(true);
    expect(
      validateLibraryUrl("https://fcboard.com/path/", ["fcboard.com"]),
    ).toBe(true);
    expect(
      validateLibraryUrl("https://fcboard.com/specific/path", [
        "fcboard.com/specific/path",
      ]),
    ).toBe(true);
    expect(
      validateLibraryUrl("https://fcboard.com/specific/path/", [
        "fcboard.com/specific/path",
      ]),
    ).toBe(true);
    expect(
      validateLibraryUrl("https://fcboard.com/specific/path", [
        "fcboard.com/specific/path/",
      ]),
    ).toBe(true);
    expect(
      validateLibraryUrl("https://fcboard.com/specific/path/other", [
        "fcboard.com/specific/path",
      ]),
    ).toBe(true);

    // invalid hostnames
    // -------------------------------------------------------------------------
    expect(() =>
      validateLibraryUrl("https://xexcalidraw.com", ["fcboard.com"]),
    ).toThrow();
    expect(() =>
      validateLibraryUrl("https://x-fcboard.com", ["fcboard.com"]),
    ).toThrow();
    expect(() =>
      validateLibraryUrl("https://fcboard.comx", ["fcboard.com"]),
    ).toThrow();
    expect(() =>
      validateLibraryUrl("https://fcboard.comx", ["fcboard.com"]),
    ).toThrow();
    expect(() =>
      validateLibraryUrl("https://fcboard.com.mx", ["fcboard.com"]),
    ).toThrow();
    // protocol must be https
    expect(() =>
      validateLibraryUrl("http://fcboard.com.mx", ["fcboard.com"]),
    ).toThrow();

    // invalid pathnames
    // -------------------------------------------------------------------------
    expect(() =>
      validateLibraryUrl("https://fcboard.com/specific/other/path", [
        "fcboard.com/specific/path",
      ]),
    ).toThrow();
    expect(() =>
      validateLibraryUrl("https://fcboard.com/specific/paths", [
        "fcboard.com/specific/path",
      ]),
    ).toThrow();
    expect(() =>
      validateLibraryUrl("https://fcboard.com/specific/path-s", [
        "fcboard.com/specific/path",
      ]),
    ).toThrow();
    expect(() =>
      validateLibraryUrl("https://fcboard.com/some/specific/path", [
        "fcboard.com/specific/path",
      ]),
    ).toThrow();
  });
});
