import { StrictMode } from "react";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { t } from "@fcboard/fcboard/i18n";

import { render } from "./test/render";
import { MailComposer } from "./MailComposer";
import { Mail } from "./mail";
import { classroomCommands, executeBoardCommand } from "./commands";
import { mailProviders } from "./mailForm";

import type { MailAccount } from "./mail";

vi.mock("./mail", () => ({
  Mail: { list: vi.fn(), save: vi.fn(), remove: vi.fn(), send: vi.fn() },
}));
const account: MailAccount = {
  id: "teacher",
  address: "teacher@example.test",
  username: "teacher@example.test",
  host: "smtp.example.test",
  port: 465,
  security: "tls",
  hasSecret: true,
};
const image = "data:image/png;base64,cGFnZQ==";
const compose = () =>
  fireEvent.click(screen.getByRole("button", { name: account.address }));
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const ready = async () =>
  waitFor(() =>
    expect(screen.getByRole("button", { name: account.address })).toBeEnabled(),
  );
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLInputElement.prototype, "getBoundingClientRect").mockReturnValue(
    {
      x: 0,
      y: 100,
      left: 0,
      top: 100,
      right: 300,
      bottom: 130,
      width: 300,
      height: 30,
      toJSON: () => ({}),
    },
  );
  vi.mocked(Mail.list).mockResolvedValue({ accounts: [account] });
  vi.mocked(Mail.save).mockImplementation(async ({ account: input }) => ({
    ...input,
    id: "saved",
    hasSecret: true,
  }));
  vi.mocked(Mail.remove).mockResolvedValue(undefined);
  vi.mocked(Mail.send).mockResolvedValue({
    sent: true,
    archived: false,
    messageId: "message",
  });
});
afterEach(() => vi.restoreAllMocks());
const setup = () => {
  const prepare = vi.fn().mockResolvedValue([image]);
  const close = vi.fn();
  const sent = vi.fn();
  return {
    ...render(
      <MailComposer preparePages={prepare} onClose={close} onSent={sent} />,
    ),
    prepare,
    close,
    sent,
  };
};

it("uses the original six providers and four core fields, validates before saving, and returns to the saved account card", async () => {
  vi.mocked(Mail.list).mockResolvedValue({ accounts: [] });
  setup();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: t("fcboard.mailbox.add_sender") }),
    ).toBeEnabled(),
  );
  expect(
    screen.getByRole("button", { name: t("fcboard.mailbox.no_sender") }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.mailbox.add_sender") }),
  );
  expect(
    screen.getByRole("heading", { name: t("fcboard.mailbox.provider_title") }),
  ).toBeVisible();
  for (let index = 0; index < mailProviders.length; index++) {
    fireEvent.click(
      screen.getByRole("button", {
        name: (
          classroomCommands.read("mail") as { providers: { name: string }[] }
        ).providers[index].name,
      }),
    );
    expect(screen.getByLabelText(t("fcboard.mailbox.smtp_server"))).toHaveValue(
      mailProviders[index].host,
    );
    expect(screen.getByLabelText(t("fcboard.mailbox.port"))).toHaveValue(465);
    expect(
      screen.getByLabelText(t("fcboard.mailbox.username")),
    ).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: t("fcboard.back") }));
  }
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.mailbox.provider_qq") }),
  );
  fireEvent.click(screen.getByRole("button", { name: t("buttons.save") }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    t("fcboard.mailbox.invalid_settings"),
  );
  expect(Mail.save).not.toHaveBeenCalled();
  change(t("fcboard.mailbox.sender"), " teacher@qq.com ");
  change(t("fcboard.mailbox.authorization_code"), "test-authorization");
  fireEvent.click(screen.getByRole("button", { name: t("buttons.save") }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "teacher@qq.com" }),
    ).toBeEnabled(),
  );
  expect(Mail.save).toHaveBeenCalledWith({
    account: expect.objectContaining({
      address: "teacher@qq.com",
      host: "smtp.qq.com",
      port: 465,
      security: "tls",
      secret: "test-authorization",
    }),
  });
  expect(JSON.stringify(classroomCommands.read("mail"))).not.toContain(
    "test-authorization",
  );
  expect(
    (classroomCommands.read("mail") as { draft: object }).draft,
  ).not.toHaveProperty("secret");
});

it("completes the original suffixes by keyboard and pointer without replacing earlier recipients, and returns to the correct layer", async () => {
  setup();
  await ready();
  compose();
  const input = screen.getByRole("combobox", {
    name: t("fcboard.mailbox.recipient"),
  });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "student" } });
  expect(screen.getAllByRole("option")).toHaveLength(13);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input).toHaveValue("student@163.com");
  fireEvent.change(input, { target: { value: "student@163.com; another@g" } });
  const option = screen.getByRole("option", { name: "another@gmail.com" });
  fireEvent.pointerDown(option);
  fireEvent.click(option);
  expect(input).toHaveValue("student@163.com; another@gmail.com");
  fireEvent.click(screen.getByRole("button", { name: t("fcboard.back") }));
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.mailbox.exit_sender") }),
  );
  compose();
  fireEvent.click(screen.getByRole("button", { name: t("buttons.cancel") }));
  expect(
    screen.getByRole("heading", { name: t("fcboard.mailbox.provider_title") }),
  ).toBeVisible();
});

it("uses the source's port-driven TLS default and saves real explicit STARTTLS/IMAP settings from the advanced controls", async () => {
  vi.mocked(Mail.list).mockResolvedValue({ accounts: [] });
  setup();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: t("fcboard.mailbox.add_sender") }),
    ).toBeEnabled(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.mailbox.add_sender") }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.mailbox.provider_163") }),
  );
  change(t("fcboard.mailbox.sender"), "teacher@163.com");
  change(t("fcboard.mailbox.authorization_code"), "test-authorization");
  change(t("fcboard.mailbox.port"), "25");
  expect(
    (classroomCommands.read("mail") as { draft: MailAccount }).draft.security,
  ).toBe("none");
  fireEvent.click(screen.getByText(t("fcboard.mailbox.advanced")));
  fireEvent.mouseDown(
    screen.getByRole("combobox", { name: t("fcboard.mailbox.security") }),
  );
  fireEvent.click(screen.getByRole("option", { name: "STARTTLS" }));
  change(t("fcboard.mailbox.port"), "587");
  change(t("fcboard.mailbox.imap_server"), "imap.163.com");
  fireEvent.click(screen.getByRole("button", { name: t("buttons.save") }));
  await waitFor(() => expect(Mail.save).toHaveBeenCalledTimes(1));
  expect(Mail.save).toHaveBeenCalledWith({
    account: expect.objectContaining({
      port: 587,
      security: "starttls",
      imapHost: "imap.163.com",
      imapPort: 993,
      imapSecurity: "tls",
    }),
  });
});

it("confirms account removal separately, preserves it on cancel/failure, and lets Escape dismiss only the confirmation", async () => {
  const { close } = setup();
  await ready();
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.mailbox.exit_sender") }),
  );
  const open = () =>
    fireEvent.click(
      screen.getByRole("button", {
        name: `${t("fcboard.mailbox.remove_account")}: ${account.address}`,
      }),
    );
  open();
  expect(Mail.remove).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(close).not.toHaveBeenCalled();
  open();
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: t("buttons.cancel"),
    }),
  );
  expect(Mail.remove).not.toHaveBeenCalled();
  vi.mocked(Mail.remove).mockRejectedValueOnce(
    new Error("Storage unavailable"),
  );
  open();
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: t("buttons.confirm"),
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Storage unavailable"),
  );
  expect(
    (classroomCommands.read("mail") as { accounts: unknown[] }).accounts,
  ).toHaveLength(1);
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: t("buttons.confirm"),
    }),
  );
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(
    (classroomCommands.read("mail") as { accounts: unknown[] }).accounts,
  ).toHaveLength(0);
});

it("validates all recipients before exporting, preserves the draft on failure, and uses the same request when retrying delivery", async () => {
  const { prepare, sent } = setup();
  await ready();
  compose();
  change(t("fcboard.mailbox.recipient"), "wrong; student@example.test");
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.mailbox.send") }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    t("fcboard.mailbox.invalid_address"),
  );
  expect(prepare).not.toHaveBeenCalled();
  expect(Mail.send).not.toHaveBeenCalled();
  change(
    t("fcboard.mailbox.recipient"),
    "student@example.test; another@example.test",
  );
  change(t("fcboard.mailbox.subject"), "Newton");
  change(t("fcboard.mailbox.body"), "F=ma");
  vi.mocked(Mail.send).mockRejectedValueOnce(new Error("SMTP unavailable"));
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.mailbox.send") }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("SMTP unavailable"),
  );
  const request = vi.mocked(Mail.send).mock.calls[0][0].request;
  expect(sent).not.toHaveBeenCalled();
  expect(screen.getByLabelText(t("fcboard.mailbox.subject"))).toHaveValue(
    "Newton",
  );
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.mailbox.send") }),
  );
  await waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
  expect(Mail.send).toHaveBeenLastCalledWith(
    expect.objectContaining({
      request,
      to: "student@example.test;another@example.test",
      subject: "Newton",
      body: "F=ma",
      format: "pdf",
      title: t("fcboard.mailbox.pdf_title"),
      pages: [image],
    }),
  );
});

it("lets AI use the visible forms and reports actual SMTP errors without returning authorization codes", async () => {
  setup();
  await ready();
  await act(async () => {
    await classroomCommands.execute({
      name: "mail.action",
      args: { action: "providers" },
    });
  });
  await act(async () => {
    await classroomCommands.execute({
      name: "mail.action",
      args: { action: "provider", index: 5 },
    });
  });
  await act(async () => {
    await classroomCommands.execute({
      name: "mail.configure",
      args: {
        account: {
          address: "teacher@example.test",
          secret: "test-secret",
          host: "smtp.example.test",
          port: 587,
          security: "starttls",
          imapHost: "imap.example.test",
          imapPort: 993,
          sentFolder: "Sent",
        },
      },
    });
  });
  expect(screen.getByLabelText(t("fcboard.mailbox.smtp_server"))).toHaveValue(
    "smtp.example.test",
  );
  expect(JSON.stringify(classroomCommands.read("mail"))).not.toContain(
    "test-secret",
  );
  vi.mocked(Mail.save).mockRejectedValueOnce(
    new Error("SMTP authentication failed"),
  );
  await act(async () => {
    await expect(
      classroomCommands.execute({
        name: "mail.action",
        args: { action: "save" },
      }),
    ).rejects.toThrow("SMTP authentication failed");
  });
  expect(
    screen.getByLabelText(t("fcboard.mailbox.authorization_code")),
  ).toHaveValue("test-secret");
  await act(async () => {
    await classroomCommands.execute({
      name: "mail.action",
      args: { action: "save" },
    });
  });
  expect(Mail.save).toHaveBeenLastCalledWith({
    account: expect.objectContaining({
      security: "starttls",
      port: 587,
      imapHost: "imap.example.test",
    }),
  });
  expect(classroomCommands.isPublic("mail.action")).toBe(true);
  expect(classroomCommands.isPublic("mail.configure")).toBe(true);
});

it("cancels an AI send during export and never dispatches the late pages", async () => {
  let finish!: (pages: string[]) => void;
  const prepare = vi.fn().mockImplementation(
    () =>
      new Promise<string[]>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(
    <MailComposer preparePages={prepare} onClose={vi.fn()} />,
  );
  await ready();
  compose();
  await act(async () => {
    await classroomCommands.execute({
      name: "mail.configure",
      args: { to: "student@example.test", subject: "Newton" },
    });
  });
  const controller = new AbortController();
  let operation!: Promise<unknown>;
  await act(async () => {
    operation = executeBoardCommand(
      { name: "mail.action", args: { action: "send" } },
      controller.signal,
    ).catch((error) => error);
  });
  expect(prepare).toHaveBeenCalledTimes(1);
  controller.abort();
  expect(await operation).toBeInstanceOf(DOMException);
  await act(async () => {
    finish([image]);
  });
  expect(Mail.send).not.toHaveBeenCalled();
  view.unmount();
  expect(classroomCommands.has("mail.action")).toBe(false);
});

it("recovers loading failures without pretending the mailbox list is empty and reports AI retry failure", async () => {
  vi.mocked(Mail.list).mockRejectedValueOnce(new Error("Keystore unavailable"));
  setup();
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Keystore unavailable"),
  );
  expect(
    screen.getByRole("button", { name: t("fcboard.mailbox.add_sender") }),
  ).toBeDisabled();
  vi.mocked(Mail.list).mockRejectedValueOnce(new Error("Still unavailable"));
  await act(async () => {
    await expect(
      classroomCommands.execute({
        name: "mail.action",
        args: { action: "retry" },
      }),
    ).rejects.toThrow("Still unavailable");
  });
  fireEvent.click(
    screen.getByRole("button", { name: t("fcboard.mailbox.retry") }),
  );
  await ready();
});

it("loads its real account again after the strict lifecycle aborts an earlier mount", async () => {
  render(
    <StrictMode>
      <MailComposer preparePages={vi.fn()} onClose={vi.fn()} />
    </StrictMode>,
  );
  await ready();
  expect(screen.queryByRole("alert")).toBeNull();
});
