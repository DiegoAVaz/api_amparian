import type { MailMessage } from "../mailer";

export type PasswordResetEmailInput = {
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
};

const BRAND_DARK = "#064e3b";
const BRAND_TEAL = "#0d9488";
const TEXT = "#1f2937";
const MUTED = "#6b7280";
const BORDER = "#e5e7eb";
const SURFACE = "#f3f4f6";

const CARD_WIDTH = 560;
const FALLBACK_FIRST_NAME = "voluntário";

/**
 * User-controlled content is interpolated into the e-mail HTML; unescaped, a
 * name containing `<` breaks the layout and becomes an injection vector.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escaping cannot neutralise a dangerous scheme, so anything that is not
 * http(s) is dropped rather than rendered as a link. Unreachable while the
 * caller builds the URL from `APP_WEB_URL`, which `env.ts` already pins.
 */
function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : "";
}

function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : FALLBACK_FIRST_NAME;
}

/** 90 -> "1 hora e 30 minutos"; feeds the expiry notice. */
function formatExpiration(minutes: number): string {
  if (!Number.isFinite(minutes)) return "tempo limitado";

  const safeMinutes = Math.max(1, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const rest = safeMinutes % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(hours === 1 ? "1 hora" : `${hours} horas`);
  if (rest > 0) parts.push(rest === 1 ? "1 minuto" : `${rest} minutos`);

  return parts.join(" e ");
}

export function renderPasswordResetEmail(
  input: PasswordResetEmailInput,
): Omit<MailMessage, "to"> {
  const greeting = escapeHtml(firstName(input.name));
  const rawUrl = safeUrl(input.resetUrl);
  const url = escapeHtml(rawUrl);
  const validity = formatExpiration(input.expiresInMinutes);

  const subject = "Redefinição de senha — Amparian";

  const text = [
    `Olá, ${firstName(input.name)}!`,
    "",
    "Recebemos um pedido para redefinir a senha da sua conta no Amparian.",
    "Acesse o endereço abaixo para criar uma nova senha:",
    "",
    rawUrl,
    "",
    `Este link vale por ${validity} e pode ser usado uma única vez.`,
    "",
    "Se você não pediu a redefinição, ignore esta mensagem: sua senha atual",
    "continua valendo e nenhuma alteração foi feita na sua conta.",
    "",
    "— Equipe Amparian",
  ].join("\n");

  const html = `<!doctype html>
<html lang="pt-BR" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${subject}</title>
    <!--[if mso]>
      <xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
    <![endif]-->
  </head>
  <body style="margin:0;padding:0;background-color:${SURFACE};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      Crie uma nova senha para sua conta no Amparian. O link vale por ${validity}.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${SURFACE};padding:24px 12px;">
      <tr>
        <td align="center">
          <!--[if mso]><table role="presentation" width="${CARD_WIDTH}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${CARD_WIDTH}px;background-color:#ffffff;border:1px solid ${BORDER};border-radius:16px;font-family:Arial,Helvetica,sans-serif;">
            <tr>
              <td style="padding:28px 32px 20px 32px;border-bottom:1px solid ${BORDER};">
                <span style="font-size:22px;font-weight:bold;color:${BRAND_DARK};letter-spacing:-0.2px;">Amparian</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 8px 32px;">
                <h1 style="margin:0 0 16px 0;font-size:20px;line-height:28px;color:${TEXT};">Olá, ${greeting}!</h1>
                <p style="margin:0 0 12px 0;font-size:15px;line-height:24px;color:${TEXT};">
                  Recebemos um pedido para redefinir a senha da sua conta no Amparian.
                  Clique no botão abaixo para criar uma nova senha.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:16px 32px 8px 32px;">
                <!--[if mso]>
                  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="50%" stroke="f" fillcolor="${BRAND_DARK}">
                    <w:anchorlock/>
                    <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">Criar nova senha</center>
                  </v:roundrect>
                <![endif]-->
                <!--[if !mso]><!-- -->
                <a href="${url}" style="display:inline-block;padding:14px 28px;background-color:${BRAND_DARK};color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;border-radius:9999px;">Criar nova senha</a>
                <!--<![endif]-->
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 0 32px;">
                <p style="margin:0 0 8px 0;font-size:13px;line-height:20px;color:${MUTED};">
                  Se o botão não funcionar, copie e cole este endereço no navegador:
                </p>
                <p style="margin:0 0 20px 0;font-size:13px;line-height:20px;word-break:break-all;word-wrap:break-word;">
                  <a href="${url}" style="color:${BRAND_TEAL};text-decoration:underline;">${url}</a>
                </p>
                <p style="margin:0 0 20px 0;font-size:13px;line-height:20px;color:${MUTED};">
                  Este link vale por <strong style="color:${TEXT};">${validity}</strong> e pode ser usado uma única vez.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${SURFACE};border-radius:10px;">
                  <tr>
                    <td style="padding:14px 16px;font-size:13px;line-height:20px;color:${MUTED};">
                      Não pediu a redefinição? Ignore esta mensagem. Sua senha atual
                      continua valendo e nenhuma alteração foi feita na sua conta.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 24px 32px;border-top:1px solid ${BORDER};">
                <p style="margin:0;font-size:12px;line-height:18px;color:${MUTED};">
                  Amparian — conectando voluntários e organizações.<br />
                  Esta é uma mensagem automática, não responda a este e-mail.
                </p>
              </td>
            </tr>
          </table>
          <!--[if mso]></td></tr></table><![endif]-->
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}

