import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { getEnv } from "../../config/env";
import type { Mailer, MailMessage } from "./mailer";

export class SmtpMailer implements Mailer {
  /**
   * One transporter per process, created on demand. The Nodemailer docs are
   * explicit that creating one per message wastes a TLS handshake. `pool` is
   * off on purpose: the API also runs serverless through `api/[...all].ts`,
   * where a persistent connection dies with the function.
   */
  private transporter: Transporter<SMTPTransport.SentMessageInfo> | null = null;

  private getTransporter(): Transporter<SMTPTransport.SentMessageInfo> {
    if (!this.transporter) {
      const env = getEnv();
      this.transporter = nodemailer.createTransport({
        host: env.MAIL_HOST,
        port: env.MAIL_PORT,
        secure: env.MAIL_PORT === 465,
        requireTLS: env.MAIL_PORT !== 465,
        auth:
          env.MAIL_USER && env.MAIL_PASSWORD
            ? { user: env.MAIL_USER, pass: env.MAIL_PASSWORD }
            : undefined,
      });
    }
    return this.transporter;
  }

  async send(message: MailMessage): Promise<void> {
    const info = await this.getTransporter().sendMail({
      from: getEnv().MAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    if (info.accepted.length === 0 || info.rejected.length > 0) {
      throw new Error(
        `Destinatário recusado pelo servidor SMTP: ${info.response}`,
      );
    }
  }
}

