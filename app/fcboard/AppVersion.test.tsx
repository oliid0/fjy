import { Capacitor } from "@capacitor/core";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { t } from "@excalidraw/excalidraw/i18n";

import { render } from "./test/render";
import { AppVersion } from "./AppVersion";
import { Classroom } from "./native";

vi.mock("./native", () => ({
  Classroom: { getAppVersion: vi.fn(), openDebugSettings: vi.fn() },
}));

afterEach(() => vi.restoreAllMocks());

it("shows the installed version and opens system debug settings only on the third quick tap", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  vi.mocked(Classroom.getAppVersion).mockResolvedValue({
    name: "1.3",
    code: 4,
  });
  vi.mocked(Classroom.openDebugSettings).mockResolvedValue({ enabled: true });
  render(<AppVersion />);
  const button = await screen.findByRole("button", {
    name: `${t("stats.version")} 1.3 (4)`,
  });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(Classroom.openDebugSettings).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() =>
    expect(Classroom.openDebugSettings).toHaveBeenCalledTimes(1),
  );
});

it("expires old taps and exposes a real system settings failure", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  vi.mocked(Classroom.getAppVersion).mockResolvedValue({
    name: "1.3",
    code: 4,
  });
  vi.mocked(Classroom.openDebugSettings)
    .mockReset()
    .mockRejectedValue(new Error("Unavailable"));
  let now = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  render(<AppVersion />);
  const button = await screen.findByRole("button", {
    name: `${t("stats.version")} 1.3 (4)`,
  });
  fireEvent.click(button);
  now += 2100;
  fireEvent.click(button);
  fireEvent.click(button);
  expect(Classroom.openDebugSettings).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");
});
