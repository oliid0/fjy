const loading = vi.hoisted(() => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  return { gate, release, started: false };
});

vi.mock("./locales/de-DE.json", async () => {
  loading.started = true;
  await loading.gate;
  return vi.importActual("./locales/de-DE.json");
});

it("keeps the latest chosen language when an earlier catalog loads late", async () => {
  const { setLanguage, getLanguage, defaultLang, t } = await import("./i18n");
  const german = setLanguage({ code: "de-DE", label: "Deutsch" });
  try {
    await vi.waitFor(() => expect(loading.started).toBe(true));
    await setLanguage({ code: "fr-FR", label: "Français" });
    expect(t("fcboard.pen")).toBe("Stylo");
    loading.release();
    await german;
    expect(getLanguage().code).toBe("fr-FR");
    expect(document.documentElement.lang).toBe("fr-FR");
    expect(t("fcboard.pen")).toBe("Stylo");
  } finally {
    loading.release();
    await german;
    await setLanguage(defaultLang);
  }
});
