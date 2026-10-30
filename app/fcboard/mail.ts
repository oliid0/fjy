import { registerPlugin } from "@capacitor/core";
export type MailAccount = {
  id: string;
  address: string;
  username: string;
  host: string;
  port: number;
  security: "tls" | "starttls" | "none";
  secret?: string;
  hasSecret?: boolean;
  imapHost?: string;
  imapPort?: number;
  imapSecurity?: "tls" | "starttls" | "none";
  sentFolder?: string;
};
export const Mail = registerPlugin<{
  list(): Promise<{ accounts: MailAccount[] }>;
  save(options: { account: MailAccount }): Promise<MailAccount>;
  remove(options: { id: string }): Promise<void>;
  send(options: {
    request: string;
    id: string;
    to: string;
    subject: string;
    body: string;
    pages: string[];
    format: "pdf" | "png";
    title?: string;
  }): Promise<{
    sent: boolean;
    archived: boolean;
    messageId: string;
    warning?: string;
  }>;
}>("FcboardMail");
