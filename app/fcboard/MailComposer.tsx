import { useCallback, useEffect, useId, useRef, useState } from "react";
import { MaterialSelect } from "@fcboard/fcboard/components/MaterialSelect";
import Popper from "@mui/material/Popper";
import { t, useI18n } from "@fcboard/fcboard/i18n";

import type { fcboard } from "@fcboard/fcboard/locales/en.json";

import type { TranslationKeys } from "@fcboard/fcboard/i18n";

import { Mail } from "./mail";
import { MaterialPanel } from "./MaterialPanel";
import { TransientMessage } from "./TransientMessage";
import { classroomCommands } from "./commands";
import {
  emailSuggestions,
  mailProviders,
  publicMailAccount,
  validMailAccount,
  validMailRecipients,
} from "./mailForm";
import emptyMailIcon from "./factory-share-icons/empty-mail.svg";
import existingMailIcon from "./factory-share-icons/existing-mail.svg";
import backIcon from "./factory-share-icons/mail-back.svg";
import closeIcon from "./factory-setting-icons/close.svg";
import "./MailComposer.scss";

import type { MailAccount } from "./mail";

const text = (key: keyof typeof fcboard.mailbox) =>
  t(`fcboard.mailbox.${key}` as TranslationKeys);
const emptyAccount: MailAccount = {
  id: "",
  address: "",
  username: "",
  secret: "",
  host: "",
  port: 465,
  security: "tls",
  imapHost: "",
  imapPort: 993,
  imapSecurity: "tls",
  sentFolder: "Sent",
};
type View = "accounts" | "providers" | "edit" | "compose";

export const MailComposer = ({
  preparePages,
  onClose,
  onSent,
}: {
  preparePages: (signal: AbortSignal) => Promise<string[]>;
  onClose: () => void;
  onSent?: (warning?: string) => void;
}) => {
  useI18n();
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [view, setView] = useState<View>("accounts");
  const [account, setAccount] = useState<MailAccount>(emptyAccount);
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [format, setFormat] = useState<"pdf" | "png">("pdf");
  const [advanced, setAdvanced] = useState(false);
  const [deleting, setDeleting] = useState<MailAccount>();
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [candidate, setCandidate] = useState(0);
  const securityOverride = useRef(false);
  const composeFrom = useRef<"accounts" | "providers">("accounts");
  const pending = useRef<AbortController | undefined>(undefined);
  const delivery = useRef<{ key: string; id: string } | undefined>(undefined);
  const alive = useRef(true);
  const receiver = useRef<HTMLInputElement>(null);
  const listId = useId();
  const primary =
    accounts.find((item) => item.id === account.id) || accounts.at(-1);
  const suggestions = suggestionsOpen ? emailSuggestions(to) : [];
  const title = text(
    view === "accounts"
      ? "title"
      : view === "providers"
      ? "provider_title"
      : view === "edit"
      ? "settings_title"
      : "compose_title",
  );

  const run = useCallback(
    async (
      operation: (signal: AbortSignal) => Promise<unknown>,
      report = false,
      source?: AbortSignal,
    ) => {
      source?.throwIfAborted();
      if (pending.current && !pending.current.signal.aborted) {
        if (report) {
          throw new Error(t("fcboard.processing"));
        }
        return;
      }
      const task = new AbortController();
      const abort = () => task.abort(source?.reason);
      source?.addEventListener("abort", abort, { once: true });
      pending.current = task;
      setBusy(true);
      setError("");
      setStatus("");
      try {
        return await operation(task.signal);
      } catch (failure) {
        if (alive.current && !task.signal.aborted) {
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
        }
        if (report) {
          throw failure;
        }
      } finally {
        source?.removeEventListener("abort", abort);
        if (pending.current === task) {
          pending.current = undefined;
          if (alive.current) {
            setBusy(false);
          }
        }
      }
    },
    [],
  );
  const load = useCallback(
    (report = false, source?: AbortSignal) =>
      run(
        async (signal) => {
          try {
            const result = await Mail.list();
            signal.throwIfAborted();
            setAccounts(result.accounts.map(publicMailAccount));
            setLoadFailed(false);
          } catch (failure) {
            if (!signal.aborted) {
              setLoadFailed(true);
            }
            throw failure;
          }
        },
        report,
        source,
      ),
    [run],
  );
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      pending.current?.abort();
    };
  }, [load]);

  const changeView = (next: View) => {
    setError("");
    setStatus("");
    setSuggestionsOpen(false);
    setView(next);
  };
  const back = () =>
    changeView(
      view === "compose"
        ? composeFrom.current
        : view === "edit"
        ? "providers"
        : "accounts",
    );
  const chooseProvider = (index: number) => {
    const provider = mailProviders[index];
    if (!provider) {
      throw new Error(text("invalid_settings"));
    }
    setAccount({ ...emptyAccount, host: provider.host });
    securityOverride.current = false;
    setAdvanced(false);
    changeView("edit");
  };
  const compose = (id: string) => {
    const next = accounts.find((item) => item.id === id);
    if (!next) {
      throw new Error(text("no_sender"));
    }
    composeFrom.current = view === "providers" ? "providers" : "accounts";
    setAccount(next);
    setAdvanced(false);
    changeView("compose");
  };
  const save = (report = false, source?: AbortSignal) =>
    run(
      async (signal) => {
        if (view !== "edit" || !validMailAccount(account)) {
          throw new Error(text("invalid_settings"));
        }
        const next = {
          ...account,
          address: account.address.trim(),
          host: account.host.trim(),
          username: account.username.trim(),
          secret: account.secret?.trim(),
        };
        const saved = publicMailAccount(await Mail.save({ account: next }));
        signal.throwIfAborted();
        setAccounts((previous) => [
          ...previous.filter((item) => item.id !== saved.id),
          saved,
        ]);
        setAccount(saved);
        changeView("accounts");
        setStatus(text("account_verified"));
        return { id: saved.id, saved: true };
      },
      report,
      source,
    );
  const remove = (report = false, source?: AbortSignal) =>
    run(
      async (signal) => {
        if (!deleting) {
          throw new Error(text("no_sender"));
        }
        await Mail.remove({ id: deleting.id });
        signal.throwIfAborted();
        setAccounts((previous) =>
          previous.filter((item) => item.id !== deleting.id),
        );
        if (account.id === deleting.id) {
          setAccount(emptyAccount);
        }
        setDeleting(undefined);
        return { id: deleting.id, removed: true };
      },
      report,
      source,
    );
  const send = (report = false, source?: AbortSignal) =>
    run(
      async (signal) => {
        if (
          view !== "compose" ||
          !accounts.some((item) => item.id === account.id)
        ) {
          throw new Error(text("no_sender"));
        }
        if (!validMailRecipients(to)) {
          throw new Error(text("invalid_address"));
        }
        const target = to
          .split(";")
          .map((item) => item.trim())
          .join(";");
        const key = JSON.stringify([
          account.id,
          target,
          subject.trim(),
          body.trim(),
          format,
        ]);
        if (delivery.current?.key !== key) {
          delivery.current = { key, id: crypto.randomUUID() };
        }
        const pages = await preparePages(signal);
        signal.throwIfAborted();
        const result = await Mail.send({
          request: delivery.current.id,
          id: account.id,
          to: target,
          subject: subject.trim(),
          body: body.trim(),
          pages,
          format,
          title: text("pdf_title"),
        });
        signal.throwIfAborted();
        if (!result.sent) {
          throw new Error(text("not_accepted"));
        }
        delivery.current = undefined;
        setStatus(
          result.warning
            ? text("sent_copy_failed").replace("{{error}}", result.warning)
            : text("sent"),
        );
        onSent?.(result.warning);
        return result;
      },
      report,
      source,
    );
  const chooseSuggestion = (index: number) => {
    const item = suggestions[index];
    if (!item) {
      return;
    }
    setTo(item.value);
    setSuggestionsOpen(false);
    receiver.current?.focus();
  };

  // Native controls and AI tools share the exact same operations and report real failures.
  useEffect(() => {
    const read = () => ({
      view,
      busy: !!pending.current,
      error,
      ready: !loadFailed,
      advanced,
      selected: account.id || primary?.id,
      accounts: accounts.map(publicMailAccount),
      draft: publicMailAccount(account),
      message: { to, subject, body, format },
      deleting: deleting?.id,
      providers: mailProviders.map((provider, index) => ({
        index,
        host: provider.host,
        name: text(provider.key),
      })),
    });
    const stops = [
      classroomCommands.context("mail", read),
      classroomCommands.register(
        "mail.action",
        "Operate the open internal mailbox. args.action=read|back|providers|provider|compose|edit|delete|confirmDelete|cancelDelete|advanced|save|send|close|retry. provider requires args.index (0..5); compose/edit/delete require an actual account id; advanced takes args.enabled. Delete opens the visible confirmation first. Save verifies SMTP and persists; send exports the selected pages and returns actual provider acceptance. Read never exposes authorization codes.",
        async (args) => {
          const source =
            args.signal instanceof AbortSignal ? args.signal : undefined;
          source?.throwIfAborted();
          const action = String(args.action || "read");
          if (action === "read") {
            return read();
          }
          if (action === "close") {
            onClose();
            return { closed: true };
          }
          if (pending.current) {
            throw new Error(t("fcboard.processing"));
          }
          if (loadFailed && action !== "retry") {
            throw new Error(error || text("invalid_settings"));
          }
          if (deleting && !["confirmDelete", "cancelDelete"].includes(action)) {
            throw new Error(text("confirm_remove"));
          }
          if (action === "save") {
            return save(true, source);
          }
          if (action === "send") {
            return send(true, source);
          }
          if (action === "confirmDelete") {
            return remove(true, source);
          }
          if (action === "retry") {
            return load(true, source);
          }
          if (action === "back") {
            back();
          } else if (action === "providers") {
            changeView("providers");
          } else if (action === "provider") {
            if (!Number.isInteger(args.index)) {
              throw new Error(text("invalid_settings"));
            }
            chooseProvider(args.index as number);
          } else if (["compose", "edit", "delete"].includes(action)) {
            const target = accounts.find((item) => item.id === args.id);
            if (!target) {
              throw new Error(text("no_sender"));
            }
            if (action === "compose") {
              compose(target.id);
            } else if (action === "delete") {
              setError("");
              setDeleting(target);
            } else {
              setAccount(target);
              setAdvanced(false);
              securityOverride.current = true;
              changeView("edit");
            }
          } else if (action === "cancelDelete") {
            setDeleting(undefined);
            setError("");
          } else if (
            action === "advanced" &&
            ["edit", "compose"].includes(view) &&
            typeof args.enabled === "boolean"
          ) {
            setAdvanced(args.enabled);
          } else {
            throw new Error(text("invalid_settings"));
          }
          return { action };
        },
      ),
      classroomCommands.register(
        "mail.configure",
        "Edit the currently visible mail draft. On compose: args.to, subject, body, format=pdf|png. On sender settings: args.account may contain address, username, secret, host, port, security=tls|starttls|none, imapHost, imapPort, imapSecurity, sentFolder. Reads and results redact secrets. Save/send separately with mail.action after configuring.",
        (args) => {
          if (pending.current || deleting) {
            throw new Error(t("fcboard.processing"));
          }
          if (view === "compose") {
            const limits = { to: 4000, subject: 1000, body: 100000 } as const;
            if (
              !Object.keys(args).length ||
              Object.entries(args).some(([key, value]) =>
                key === "format"
                  ? !["pdf", "png"].includes(String(value))
                  : !(key in limits) ||
                    typeof value !== "string" ||
                    value.length > limits[key as keyof typeof limits],
              )
            ) {
              throw new Error(text("invalid_settings"));
            }
            if (args.to !== undefined) {
              setTo(args.to as string);
            }
            if (args.subject !== undefined) {
              setSubject(args.subject as string);
            }
            if (args.body !== undefined) {
              setBody(args.body as string);
            }
            if (args.format !== undefined) {
              setFormat(args.format as "pdf" | "png");
            }
          } else if (view === "edit") {
            const patch = args.account;
            if (
              !patch ||
              typeof patch !== "object" ||
              Array.isArray(patch) ||
              Object.keys(args).some((key) => key !== "account")
            ) {
              throw new Error(text("invalid_settings"));
            }
            const values = patch as Record<string, unknown>;
            const keys = [
              "address",
              "username",
              "secret",
              "host",
              "port",
              "security",
              "imapHost",
              "imapPort",
              "imapSecurity",
              "sentFolder",
            ];
            if (
              !Object.keys(values).length ||
              Object.entries(values).some(
                ([key, value]) =>
                  !keys.includes(key) ||
                  (key === "port" || key === "imapPort"
                    ? typeof value !== "number" ||
                      !Number.isInteger(value) ||
                      value < 1 ||
                      value > 65535
                    : key === "security" || key === "imapSecurity"
                    ? !["tls", "starttls", "none"].includes(String(value))
                    : typeof value !== "string" || value.length > 4000),
              )
            ) {
              throw new Error(text("invalid_settings"));
            }
            if (values.security !== undefined) {
              securityOverride.current = true;
            }
            setAccount(
              (previous) =>
                ({
                  ...previous,
                  ...values,
                  ...(values.port !== undefined && !securityOverride.current
                    ? { security: values.port === 465 ? "tls" : "none" }
                    : {}),
                } as MailAccount),
            );
          } else {
            throw new Error(text("invalid_settings"));
          }
          return { updated: true };
        },
      ),
    ];
    classroomCommands.changed("mail");
    return () => stops.forEach((stop) => stop());
  });

  const field = (
    key: "address" | "secret" | "host" | "username" | "imapHost" | "sentFolder",
    title: string,
    type = "text",
  ) => (
    <label>
      <span>{title}</span>
      <input
        aria-label={title}
        type={type}
        value={account[key] || ""}
        autoComplete={type === "password" ? "new-password" : "off"}
        onChange={(event) =>
          setAccount({ ...account, [key]: event.target.value })
        }
      />
    </label>
  );
  const port = (imap = false) => (
    <label>
      <span>{text(imap ? "imap_port" : "port")}</span>
      <input
        aria-label={text(imap ? "imap_port" : "port")}
        type="number"
        min={1}
        max={65535}
        value={
          Number.isFinite(imap ? account.imapPort : account.port)
            ? imap
              ? account.imapPort
              : account.port
            : ""
        }
        onChange={(event) => {
          const value = event.target.valueAsNumber;
          setAccount({
            ...account,
            ...(imap
              ? { imapPort: value }
              : {
                  port: value,
                  security: securityOverride.current
                    ? account.security
                    : value === 465
                    ? "tls"
                    : "none",
                }),
          });
        }}
      />
    </label>
  );
  const security = (imap = false) => (
    <label>
      <span>{text(imap ? "imap_security" : "security")}</span>
      <MaterialSelect
        aria-label={text(imap ? "imap_security" : "security")}
        value={(imap ? account.imapSecurity : account.security) || "tls"}
        onChange={(event) => {
          if (!imap) {
            securityOverride.current = true;
          }
          setAccount({
            ...account,
            [imap ? "imapSecurity" : "security"]: event.target.value,
          });
        }}
      >
        <option value="tls">SSL/TLS</option>
        <option value="starttls">STARTTLS</option>
        <option value="none">{text("no_encryption")}</option>
      </MaterialSelect>
    </label>
  );
  return (
    <div
      className={`fc-mail-composer fc-mail-composer--${view}`}
      aria-busy={busy}
    >
      <header className="fc-mail-header">
        {view !== "accounts" && (
          <button
            type="button"
            className="fc-mail-back"
            aria-label={t("fcboard.back")}
            disabled={busy}
            onClick={back}
          >
            <img src={backIcon} alt="" />
          </button>
        )}
        <h2>{title}</h2>
        <button
          type="button"
          className="fc-mail-close"
          aria-label={t("fcboard.close_sharing")}
          onClick={onClose}
        >
          <img src={closeIcon} alt="" />
        </button>
      </header>
      <main className="fc-mail-content">
        {view === "accounts" && (
          <div className="fc-mail-account-page">
            <button
              type="button"
              className="fc-mail-card"
              disabled={!primary || busy || loadFailed}
              onClick={() => primary && compose(primary.id)}
            >
              <img
                src={primary ? existingMailIcon : emptyMailIcon}
                alt=""
                width="44"
                height="44"
              />
              <span>{primary?.address || text("no_sender")}</span>
            </button>
            <button
              type="button"
              className={primary ? "fc-mail-account-switch" : "fc-primary"}
              disabled={busy || loadFailed}
              onClick={() => changeView("providers")}
            >
              {text(primary ? "exit_sender" : "add_sender")}
            </button>
            {loadFailed && (
              <button type="button" disabled={busy} onClick={() => void load()}>
                {text("retry")}
              </button>
            )}
          </div>
        )}
        {view === "providers" && (
          <div className="fc-mail-providers">
            {mailProviders.map((provider, index) => (
              <button
                key={provider.key}
                type="button"
                disabled={busy}
                onClick={() => chooseProvider(index)}
              >
                {text(provider.key)}
              </button>
            ))}
            {accounts.map((item) => (
              <div className="fc-mail-provider-account" key={item.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => compose(item.id)}
                >
                  {item.address}
                </button>
                <button
                  type="button"
                  aria-label={`${text("remove_account")}: ${item.address}`}
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setDeleting(item);
                  }}
                >
                  <img src={closeIcon} alt="" />
                </button>
              </div>
            ))}
          </div>
        )}
        {view === "edit" && (
          <form
            className="fc-mail-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={busy}>
              {field("address", text("sender"), "email")}
              {field("secret", text("authorization_code"), "password")}
              {field("host", text("smtp_server"))}
              {port()}
              <details
                className="fc-mail-advanced"
                open={advanced}
                onToggle={(event) => setAdvanced(event.currentTarget.open)}
              >
                <summary>{text("advanced")}</summary>
                {field("username", text("username"))}
                {security()}
                {field("imapHost", text("imap_server"))}
                {port(true)}
                {security(true)}
                {field("sentFolder", text("sent_folder"))}
              </details>
              <footer>
                <button type="button" onClick={back}>
                  {t("buttons.cancel")}
                </button>
                <button type="submit" className="fc-primary">
                  {t("buttons.save")}
                </button>
              </footer>
            </fieldset>
          </form>
        )}
        {view === "compose" && (
          <form
            className="fc-mail-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <fieldset disabled={busy}>
              <label>
                <span>
                  {text("subject")}
                  <small>{text("optional")}</small>
                </span>
                <input
                  aria-label={text("subject")}
                  maxLength={1000}
                  value={subject}
                  placeholder={text("input_hint")}
                  onChange={(event) => setSubject(event.target.value)}
                />
              </label>
              <label>
                <span>
                  {text("body")}
                  <small>{text("optional")}</small>
                </span>
                <textarea
                  aria-label={text("body")}
                  maxLength={100000}
                  rows={1}
                  value={body}
                  placeholder={text("input_hint")}
                  onChange={(event) => setBody(event.target.value)}
                />
              </label>
              <label>
                <span>
                  {text("recipient")}
                  <small>{text("required")}</small>
                  <small>{text("multiple_hint")}</small>
                </span>
                <input
                  ref={receiver}
                  maxLength={4000}
                  aria-label={text("recipient")}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={!!suggestions.length}
                  aria-controls={suggestions.length ? listId : undefined}
                  aria-activedescendant={
                    suggestions.length ? `${listId}-${candidate}` : undefined
                  }
                  inputMode="email"
                  autoComplete="off"
                  value={to}
                  placeholder={text("input_hint")}
                  onChange={(event) => {
                    setTo(event.target.value);
                    setCandidate(0);
                    setSuggestionsOpen(true);
                  }}
                  onFocus={() => setSuggestionsOpen(true)}
                  onBlur={() => setSuggestionsOpen(false)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && suggestions.length) {
                      event.preventDefault();
                      event.stopPropagation();
                      setSuggestionsOpen(false);
                    } else if (
                      suggestions.length &&
                      (event.key === "ArrowDown" || event.key === "ArrowUp")
                    ) {
                      event.preventDefault();
                      setCandidate(
                        (value) =>
                          (value +
                            (event.key === "ArrowDown"
                              ? 1
                              : suggestions.length - 1)) %
                          suggestions.length,
                      );
                    } else if (event.key === "Enter" && suggestions.length) {
                      event.preventDefault();
                      chooseSuggestion(candidate);
                    }
                  }}
                />
              </label>
              {suggestions.length > 0 && (
                <Popper
                  open
                  anchorEl={receiver.current}
                  disablePortal
                  placement="bottom-start"
                  popperOptions={{ strategy: "fixed" }}
                  modifiers={[
                    { name: "preventOverflow", options: { padding: 12 } },
                  ]}
                  sx={{
                    zIndex: 1301,
                    width:
                      receiver.current?.getBoundingClientRect().width || 200,
                  }}
                >
                  <div
                    className="fc-mail-suggestions"
                    role="listbox"
                    id={listId}
                    aria-label={text("recipient")}
                  >
                    {suggestions.map((item, index) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={candidate === index}
                        id={`${listId}-${index}`}
                        key={item.value}
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => chooseSuggestion(index)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </Popper>
              )}
              <details
                className="fc-mail-advanced"
                open={advanced}
                onToggle={(event) => setAdvanced(event.currentTarget.open)}
              >
                <summary>{text("advanced")}</summary>
                <label>
                  <span>{text("attachment_format")}</span>
                  <MaterialSelect
                    aria-label={text("attachment_format")}
                    value={format}
                    onChange={(event) =>
                      setFormat(event.target.value as "pdf" | "png")
                    }
                  >
                    <option value="pdf">PDF</option>
                    <option value="png">PNG</option>
                  </MaterialSelect>
                </label>
              </details>
              <footer>
                <button type="button" onClick={back}>
                  {t("buttons.cancel")}
                </button>
                <button type="submit" className="fc-primary">
                  {text("send")}
                </button>
              </footer>
            </fieldset>
          </form>
        )}
        {busy && (
          <p className="fc-mail-feedback" role="status">
            {t("fcboard.processing")}
          </p>
        )}
        {!deleting && error && (
          <p className="fc-mail-feedback" role="alert">
            {error}
          </p>
        )}
        <TransientMessage message={status} className="fc-mail-feedback" />
      </main>
      {deleting && (
        <MaterialPanel
          centered
          onDismiss={() => {
            if (!busy) {
              setDeleting(undefined);
              setError("");
            }
          }}
          className="fc-mail-delete"
          role="alertdialog"
          aria-label={text("confirm_remove")}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              if (!busy) {
                setDeleting(undefined);
                setError("");
              }
            }
          }}
        >
          <p>{text("confirm_remove")}</p>
          {error && <p role="alert">{error}</p>}
          <footer>
            <button
              type="button"
              className="fc-primary"
              disabled={busy}
              autoFocus
              onClick={() => void remove()}
            >
              {t("buttons.confirm")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDeleting(undefined);
                setError("");
              }}
            >
              {t("buttons.cancel")}
            </button>
          </footer>
        </MaterialPanel>
      )}
    </div>
  );
};
