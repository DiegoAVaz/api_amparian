import { getEnv } from "../../config/env";
import { ConsoleMailer } from "./console.mailer";
import type { Mailer } from "./mailer";
import { SmtpMailer } from "./smtp.mailer";

export type { Mailer, MailMessage } from "./mailer";
export { renderPasswordResetEmail } from "./templates/password-reset.template";

let cached: Mailer | null = null;

export function createMailer(): Mailer {
  if (!cached) {
    cached =
      getEnv().MAIL_DRIVER === "smtp" ? new SmtpMailer() : new ConsoleMailer();
  }
  return cached;
}

