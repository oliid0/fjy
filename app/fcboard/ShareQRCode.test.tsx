import { t } from "@fcboard/fcboard/i18n";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";

import { render } from "./test/render";
import { ShareQRCode, useShareProtection } from "./ShareQRCode";

vi.mock("../share/QRCode", () => ({
  QRCode: ({ value }: { value: string }) => (
    <div data-testid="qr" data-value={value} />
  ),
}));

const Panel = ({
  onPasswordChange,
}: {
  onPasswordChange: (password: string) => Promise<void>;
}) => {
  const protection = useShareProtection(onPasswordChange);
  const { reset } = protection;
  useEffect(() => {
    reset();
  }, [reset]);
  return <ShareQRCode url="http://board.test/share" protection={protection} />;
};

it("starts with protection off and updates the existing share only after enabling or completing four digits", async () => {
  const update = vi.fn().mockResolvedValue(undefined);
  render(<Panel onPasswordChange={update} />);
  const toggle = screen.getByRole("switch", {
    name: t("fcboard.qr_password_protection"),
  });
  expect(toggle).not.toBeChecked();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(update).not.toHaveBeenCalled();
  expect(screen.getByTestId("qr")).toHaveAttribute(
    "data-value",
    "http://board.test/share",
  );

  fireEvent.click(toggle);
  const input = screen.getByRole("textbox", {
    name: t("fcboard.qr_my_password"),
  });
  expect((input as HTMLInputElement).value).toMatch(/^\d{4}$/);
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(update).toHaveBeenCalledWith((input as HTMLInputElement).value);
  fireEvent.change(input, { target: { value: "012" } });
  expect(update).toHaveBeenCalledTimes(1);
  fireEvent.change(input, { target: { value: "0123" } });
  await waitFor(() => expect(update).toHaveBeenLastCalledWith("0123"));
  await waitFor(() => expect(toggle).toBeEnabled());
  fireEvent.click(toggle);
  await waitFor(() => expect(update).toHaveBeenLastCalledWith(""));
  expect(toggle).not.toBeChecked();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByTestId("qr")).toHaveAttribute(
    "data-value",
    "http://board.test/share",
  );
});

it("keeps the last applied state when the server rejects a switch or password update", async () => {
  const update = vi.fn().mockRejectedValueOnce(new Error("分享已结束"));
  render(<Panel onPasswordChange={update} />);
  const toggle = screen.getByRole("switch");
  fireEvent.click(toggle);
  expect(await screen.findByRole("alert")).toHaveTextContent("分享已结束");
  expect(toggle).not.toBeChecked();
  expect(screen.queryByRole("textbox")).toBeNull();

  update.mockResolvedValue(undefined);
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toBeEnabled());
  const input = screen.getByRole("textbox");
  const previous = (input as HTMLInputElement).value;
  update.mockRejectedValueOnce(new Error("更新失败"));
  fireEvent.change(input, {
    target: { value: previous === "2345" ? "2346" : "2345" },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("更新失败");
  expect(toggle).toBeChecked();
  expect(input).toHaveValue(previous);
});
