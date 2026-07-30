import type { Mailer, MailMessage } from "./mailer";

/**
 * Development driver: prints the message instead of sending it. The plain-text
 * body already carries the link, so it can be copied straight from the console.
 */
export class ConsoleMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    console.info(
      [
        "",
        "──────────── [mail:console] ────────────",
        `Para:     ${message.to}`,
        `Assunto:  ${message.subject}`,
        "",
        message.text,
        "────────────────────────────────────────",
        "",
      ].join("\n"),
    );
  }
}
