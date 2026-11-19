import fontkit from "@pdf-lib/fontkit";
import fs from "node:fs";
import path from "node:path";
import {
  PDFDocument,
  type Color,
  type PDFFont,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSpacing,
} from "pdf-lib";
import QRCode from "qrcode";
import {
  internalServerError,
  unprocessableEntity,
} from "../../utils/http-error";
import {
  buildCertificateParagraph,
  formatLongDate,
  formatVerificationCode,
  type CertificateTextData,
} from "./certificate-text";
import { VERIFICATION_CODE_PATTERN } from "./verification-code";


const PAGE_W = 1123;
const PAGE_H = 794;
const A4_LANDSCAPE: [number, number] = [841.89, 595.28];
const PX = A4_LANDSCAPE[0] / PAGE_W;

const CONTENT_LEFT = 36 + 64;
const CONTENT_RIGHT = PAGE_W - 36 - 64;
const CONTENT_TOP = 36 + 40;
const CONTENT_BOTTOM = PAGE_H - 36 - 32;
const CENTER_X = PAGE_W / 2;

const TEAL = rgb(0x06 / 255, 0x4e / 255, 0x3b / 255);
const SHIELD_INNER = rgb(0x0d / 255, 0x94 / 255, 0x88 / 255);
const KICKER = rgb(0x0f / 255, 0x76 / 255, 0x6e / 255);
const INK = rgb(0x17 / 255, 0x17 / 255, 0x17 / 255);
const MUTED = rgb(0x4b / 255, 0x55 / 255, 0x63 / 255);

// Altura de linha "normal" da Inter, a que o navegador usa quando o CSS não fixa `line-height`.
const NORMAL_LINE = 1.21;

const SHIELD_OUTER_PATH =
  "M18 3L5 8.5V17C5 24.18 10.64 30.9 18 33C25.36 30.9 31 24.18 31 17V8.5L18 3Z";
const SHIELD_INNER_PATH =
  "M18 6L8 10.8V17C8 23.12 12.56 28.78 18 30.6C23.44 28.78 28 23.12 28 17V10.8L18 6Z";

// ---------------------------------------------------------------------------------------------
// Fontes
// ---------------------------------------------------------------------------------------------

// Inter estática, versionada em assets/fonts (licença SIL OFL 1.1 em OFL.txt). Estática, e não a
// variável que o front usa, porque o fontkit embute só a instância padrão de uma fonte variável.
// O caminho sobe três níveis a partir deste arquivo — vale igual para src/ (tsx) e dist/ (tsc). Na
// Vercel a pasta entra no deploy por `includeFiles`, em vercel.json.
const FONT_DIR = path.resolve(__dirname, "../../../assets/fonts");
const FONT_FILES = {
  regular: "Inter-Regular.ttf",
  semibold: "Inter-SemiBold.ttf",
  bold: "Inter-Bold.ttf",
  extrabold: "Inter-ExtraBold.ttf",
} as const;
type Weight = keyof typeof FONT_FILES;
type Fonts = Record<Weight, PDFFont>;

let fontBytes: Record<Weight, Buffer> | null = null;

// Lidas uma vez por processo: são ~1,6 MB, e cada certificado só precisa embuti-las.
function loadFontBytes(): Record<Weight, Buffer> {
  if (!fontBytes) {
    fontBytes = Object.fromEntries(
      Object.entries(FONT_FILES).map(([weight, file]) => [
        weight,
        fs.readFileSync(path.join(FONT_DIR, file)),
      ]),
    ) as Record<Weight, Buffer>;
  }
  return fontBytes;
}

async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  const bytes = loadFontBytes();
  const entries = await Promise.all(
    (Object.keys(FONT_FILES) as Weight[]).map(async (weight) => {
      // `subset` embute só os glifos usados (o PDF fica com dezenas de KB, não 1,6 MB).
      // `customName` fixa o nome da fonte no PDF; sem ele o pdf-lib sorteia um sufixo, e o mesmo
      // certificado não sairia idêntico byte a byte ao ser regenerado (RC-05).
      const font = await doc.embedFont(bytes[weight], {
        subset: true,
        customName: `Inter-${weight}`,
      });
      return [weight, font] as const;
    }),
  );
  return Object.fromEntries(entries) as Fonts;
}

let printable: Set<number> | null = null;

// Os caracteres que a Inter desenha (latino com acentos, grego, cirílico). As quatro espessuras
// têm o mesmo conjunto, então basta ler uma.
function printableCodePoints(): Set<number> {
  if (!printable) {
    printable = new Set(fontkit.create(loadFontBytes().regular).characterSet);
  }
  return printable;
}

/**
 * Recusa o nome do participante que perderia alguma letra ou número ao ser impresso.
 *
 * Emoji e símbolos são decoração e saem do PDF em silêncio ("Ana 🌱 Souza" vira "Ana Souza"). Mas
 * uma LETRA que a Inter não tem — coreano, chinês, árabe, devanágari — deixaria o nome errado num
 * documento oficial ("Kim 김민준" sairia "Kim"). Nesse caso, nenhum certificado é emitido: a
 * pessoa ajusta o nome no perfil, por exemplo com a grafia latina (decisão de 17/11/2026).
 *
 * Exportada para o caso de uso de emissão chamar ANTES de gravar a linha do certificado — um nome
 * recusado não pode deixar para trás um certificado sem PDF.
 */
export function assertPrintableParticipantName(name: string): void {
  const supported = printableCodePoints();
  const normalized = name.normalize("NFC");
  const losesLetter = [...normalized].some(
    (char) =>
      /[\p{L}\p{N}]/u.test(char) && !supported.has(char.codePointAt(0)!),
  );
  const hasLetter = [...normalized].some(
    (char) => /\p{L}/u.test(char) && supported.has(char.codePointAt(0)!),
  );
  if (losesLetter || !hasLetter) {
    throw unprocessableEntity(
      "CERTIFICATE_NAME_UNPRINTABLE",
      "Seu nome tem caracteres que o certificado não consegue imprimir. Ajuste o nome no seu perfil (por exemplo, com a grafia em letras latinas) e tente de novo.",
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Texto: limpeza, medida e quebra de linha
// ---------------------------------------------------------------------------------------------

/**
 * Deixa o texto desenhável: normaliza (NFC), troca quebras e tabulações por espaço e remove o que
 * a Inter não tem (emoji, ideogramas), que sairia como um quadrado vazio no papel.
 */
function sanitize(text: string, supported: Set<number>): string {
  const normalized = text.normalize("NFC").replace(/\s+/g, " ").trim();
  let out = "";
  for (const char of normalized) {
    const code = char.codePointAt(0)!;
    if (char === " " || supported.has(code)) out += char;
  }
  return out.replace(/ {2,}/g, " ").trim();
}

/**
 * Se o PDF imprime a linha "Responsável: {pessoa}" no rodapé. "Promovida por" é a organização
 * pública ou, sem ela, o próprio nome do organizador: quando é a organização, a linha nomeia a
 * pessoa; quando já é a pessoa, repetir seria ruído. Um nome que some por inteiro na limpeza também
 * esconde a linha, em vez de imprimir "Responsável:" sozinho.
 *
 * Exportada porque a verificação pública (RC-08) mostra essa linha só quando ela está no papel: as
 * duas decisões saem desta mesma regra, sobre o texto já limpo.
 */
export function printsResponsiblePerson(
  organizerName: string,
  organizerPersonName: string,
): boolean {
  const supported = printableCodePoints();
  const person = sanitize(organizerPersonName, supported);
  return person.length > 0 && person !== sanitize(organizerName, supported);
}

type Piece = { text: string; font: PDFFont; color: Color };
type Word = { pieces: Piece[]; width: number };
type Line = { words: Word[]; width: number };

function pieceWidth(piece: Piece, size: number): number {
  return piece.font.widthOfTextAtSize(piece.text, size);
}

function wordWidth(pieces: Piece[], size: number): number {
  return pieces.reduce((sum, piece) => sum + pieceWidth(piece, size), 0);
}

/** Quebra os trechos em palavras. Uma palavra pode misturar fontes: "**Título**," é uma só. */
function toWords(pieces: Piece[], size: number): Word[] {
  const words: Word[] = [];
  let current: Piece[] = [];
  const flush = () => {
    if (current.length)
      words.push({ pieces: current, width: wordWidth(current, size) });
    current = [];
  };
  for (const piece of pieces) {
    piece.text.split(/( )/).forEach((part) => {
      if (part === " ") flush();
      else if (part) current.push({ ...piece, text: part });
    });
  }
  flush();
  return words;
}

/** Uma palavra mais larga que a linha (um título sem espaços, por exemplo) é partida por caractere. */
function splitLongWord(word: Word, size: number, maxWidth: number): Word[] {
  const out: Word[] = [];
  let pieces: Piece[] = [];
  let width = 0;
  for (const piece of word.pieces) {
    let text = "";
    for (const char of piece.text) {
      const w = piece.font.widthOfTextAtSize(char, size);
      if (width + w > maxWidth && (text || pieces.length)) {
        if (text) pieces.push({ ...piece, text });
        out.push({ pieces, width });
        pieces = [];
        text = "";
        width = 0;
      }
      text += char;
      width += w;
    }
    if (text) pieces.push({ ...piece, text });
  }
  if (pieces.length) out.push({ pieces, width });
  return out;
}

function wrap(
  words: Word[],
  size: number,
  maxWidth: number,
  spaceWidth: number,
): Line[] {
  const lines: Line[] = [];
  let line: Line = { words: [], width: 0 };
  const units = words.flatMap((word) =>
    word.width > maxWidth ? splitLongWord(word, size, maxWidth) : [word],
  );
  for (const word of units) {
    const next = line.words.length
      ? line.width + spaceWidth + word.width
      : word.width;
    if (line.words.length && next > maxWidth) {
      lines.push(line);
      line = { words: [word], width: word.width };
    } else {
      line.words.push(word);
      line.width = next;
    }
  }
  if (line.words.length) lines.push(line);
  return lines;
}

/**
 * Quebra equilibrada, o `text-wrap: balance` do mockup: a menor largura que ainda cabe no mesmo
 * número de linhas, para o nome em duas linhas não sair com uma palavra solta na segunda.
 */
function balancedWrap(
  words: Word[],
  size: number,
  maxWidth: number,
  spaceWidth: number,
): Line[] {
  const greedy = wrap(words, size, maxWidth, spaceWidth);
  if (greedy.length < 2) return greedy;
  let low = Math.max(...words.map((word) => Math.min(word.width, maxWidth)));
  let high = maxWidth;
  while (high - low > 1) {
    const mid = (low + high) / 2;
    if (wrap(words, size, mid, spaceWidth).length <= greedy.length) high = mid;
    else low = mid;
  }
  return wrap(words, size, high, spaceWidth);
}

/**
 * Corta em `maxLines` linhas, terminando a última com reticências. Só para o rodapé, e só em texto
 * patológico (perto dos 255 caracteres das colunas): sem teto, a coluna da esquerda subiria por
 * cima do parágrafo. Nada se perde no corte da organização, que sai inteira no parágrafo.
 */
function clampLines(
  lines: Line[],
  maxLines: number,
  size: number,
  maxWidth: number,
  spaceWidth: number,
): Line[] {
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  const tail = last.words[last.words.length - 1].pieces;
  const ellipsis: Piece = { ...tail[tail.length - 1], text: "…" };
  const ellipsisWidth = pieceWidth(ellipsis, size);

  const words = [...last.words];
  let width = last.width;
  while (words.length > 1 && width + ellipsisWidth > maxWidth) {
    width -= words.pop()!.width + spaceWidth;
  }
  const lastWord = words[words.length - 1];
  words[words.length - 1] = {
    pieces: [...lastWord.pieces, ellipsis],
    width: lastWord.width + ellipsisWidth,
  };
  kept[maxLines - 1] = { words, width: width + ellipsisWidth };
  return kept;
}

// ---------------------------------------------------------------------------------------------
// Desenho, em px do mockup
// ---------------------------------------------------------------------------------------------

class Canvas {
  constructor(private readonly page: PDFPage) {}

  /** Linha de texto com o topo da caixa de linha em `top` (como no CSS) e a esquerda em `x`. */
  text(
    text: string,
    opts: {
      x: number;
      top: number;
      size: number;
      font: PDFFont;
      color: Color;
      lineHeight?: number;
      letterSpacing?: number;
    },
  ): void {
    if (!text) return;
    const lineBox = opts.size * (opts.lineHeight ?? NORMAL_LINE);
    const ascent = opts.font.heightAtSize(opts.size, { descender: false });
    const full = opts.font.heightAtSize(opts.size);
    const baseline = opts.top + (lineBox - full) / 2 + ascent;

    const draw = () =>
      this.page.drawText(text, {
        x: opts.x * PX,
        y: (PAGE_H - baseline) * PX,
        size: opts.size * PX,
        font: opts.font,
        color: opts.color,
      });

    if (opts.letterSpacing) {
      this.page.pushOperators(
        pushGraphicsState(),
        setCharacterSpacing(opts.letterSpacing * PX),
      );
      draw();
      this.page.pushOperators(popGraphicsState());
    } else {
      draw();
    }
  }

  /** Linha de trechos (palavras com fontes misturadas) a partir de `x`. */
  line(
    line: Line,
    opts: {
      x: number;
      top: number;
      size: number;
      lineHeight: number;
      spaceWidth: number;
    },
  ) {
    let x = opts.x;
    line.words.forEach((word, index) => {
      if (index > 0) x += opts.spaceWidth;
      for (const piece of word.pieces) {
        this.text(piece.text, {
          x,
          top: opts.top,
          size: opts.size,
          font: piece.font,
          color: piece.color,
          lineHeight: opts.lineHeight,
        });
        x += pieceWidth(piece, opts.size);
      }
    });
  }

  rect(
    x: number,
    top: number,
    width: number,
    height: number,
    color: Color,
  ): void {
    this.page.drawRectangle({
      x: x * PX,
      y: (PAGE_H - top - height) * PX,
      width: width * PX,
      height: height * PX,
      color,
    });
  }

  /** Retângulo de cantos arredondados só com contorno, com o traço centrado na linha dada. */
  roundedBorder(
    inset: number,
    radius: number,
    stroke: number,
    color: Color,
    opacity = 1,
  ): void {
    const w = PAGE_W - inset * 2;
    const h = PAGE_H - inset * 2;
    const r = radius;
    const d =
      `M${r} 0H${w - r}Q${w} 0 ${w} ${r}V${h - r}Q${w} ${h} ${w - r} ${h}` +
      `H${r}Q0 ${h} 0 ${h - r}V${r}Q0 0 ${r} 0Z`;
    this.page.drawSvgPath(d, {
      x: inset * PX,
      y: (PAGE_H - inset) * PX,
      scale: PX,
      borderColor: color,
      borderWidth: stroke * PX,
      borderOpacity: opacity,
    });
  }

  svgPath(
    d: string,
    x: number,
    top: number,
    scale: number,
    color: Color,
  ): void {
    this.page.drawSvgPath(d, {
      x: x * PX,
      y: (PAGE_H - top) * PX,
      scale: scale * PX,
      color,
    });
  }
}

function textWidth(
  text: string,
  font: PDFFont,
  size: number,
  letterSpacing = 0,
): number {
  const chars = [...text].length;
  return (
    font.widthOfTextAtSize(text, size) + letterSpacing * Math.max(chars - 1, 0)
  );
}

// ---------------------------------------------------------------------------------------------
// Certificado
// ---------------------------------------------------------------------------------------------

export type CertificateDocumentData = CertificateTextData & {
  participantName: string;
  organizerPersonName: string;
  issuedAt: Date;
  /** Normalizado: 12 caracteres, maiúsculo, sem hífens (RC-07). */
  verificationCode: string;
  /** `APP_WEB_URL`, a base do link de verificação impresso e do QR code. */
  appWebUrl: string;
};

function assertRenderable(data: CertificateDocumentData): void {
  const dates = [data.eventStartsAt, data.issuedAt, data.eventEndsAt].filter(
    (date): date is Date => date !== null,
  );
  const valid =
    VERIFICATION_CODE_PATTERN.test(data.verificationCode) &&
    dates.every(
      (date) => date instanceof Date && !Number.isNaN(date.getTime()),
    ) &&
    (data.workloadHours === null || Number.isFinite(data.workloadHours));
  if (!valid) {
    throw internalServerError(
      "INVALID_CERTIFICATE_DATA",
      "Não foi possível gerar o arquivo do certificado",
    );
  }
}

/** Host e caminho de `APP_WEB_URL`, como vão impressos: "amparian-front.vercel.app". */
function displayHost(appWebUrl: string): string {
  const url = new URL(appWebUrl);
  return `${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * Gera o PDF do certificado (A4 paisagem, uma página), fiel à direção aprovada no dsg-1.
 *
 * Função pura sobre os dados do snapshot (RC-06): os mesmos dados geram o mesmo arquivo, byte a
 * byte. É o que permite regenerar um PDF perdido sem que ele mude (RC-05).
 */
export async function renderCertificatePdf(
  data: CertificateDocumentData,
): Promise<Buffer> {
  assertRenderable(data);
  assertPrintableParticipantName(data.participantName);

  const doc = await PDFDocument.create({ updateMetadata: false });
  const fonts = await embedFonts(doc);
  const supported = printableCodePoints();
  const clean = (text: string) => sanitize(text, supported);

  const participantName = clean(data.participantName);
  const organizerName = clean(data.organizerName);
  const organizerPersonName = clean(data.organizerPersonName);
  const eventTitle = clean(data.eventTitle);
  // Título e organização vêm do organizador, e o voluntário não tem como corrigi-los: perder um
  // emoji ali não impede a emissão. Só um texto que some por inteiro impede — "da ação , promovida
  // por" não pode ir para o papel. 422, e não 500: não é falha do sistema, e a mensagem diz ao
  // voluntário com quem falar.
  if (!eventTitle || !organizerName) {
    throw unprocessableEntity(
      "CERTIFICATE_EVENT_UNPRINTABLE",
      "O título da ação ou o nome de quem a promove tem caracteres que o certificado não consegue imprimir. Fale com o organizador da ação para ajustá-los.",
    );
  }
  const code = formatVerificationCode(data.verificationCode);
  const verifyUrl = `${data.appWebUrl.replace(/\/+$/, "")}/certificados/verificar/${code}`;

  // Metadados: datas fixas na emissão (e não "agora") para a regeneração sair idêntica.
  doc.setTitle(`Certificado de Participação — ${participantName}`);
  doc.setSubject(eventTitle);
  doc.setAuthor("Amparian");
  doc.setCreator("Amparian");
  doc.setProducer("Amparian");
  doc.setKeywords(["certificado", "voluntariado", code]);
  doc.setLanguage("pt-BR");
  doc.setCreationDate(data.issuedAt);
  doc.setModificationDate(data.issuedAt);

  const page = doc.addPage(A4_LANDSCAPE);
  const canvas = new Canvas(page);

  // Bordas: 2px teal a 28px da beirada, e 1px teal a 28% de opacidade a 36px.
  canvas.roundedBorder(29, 3, 2, TEAL);
  canvas.roundedBorder(36.5, 1.5, 1, TEAL, 0.28);

  drawHeader(canvas, fonts);

  const footnoteTop = CONTENT_BOTTOM - 12 * NORMAL_LINE;
  const footer = layoutFooter(fonts, {
    organizerName,
    organizerPersonName,
    // Decidido sobre os textos ORIGINAIS, como faz a verificação pública: limpar duas vezes nem
    // sempre dá o mesmo resultado (tirar um emoji pode juntar uma letra a um acento solto, que a
    // normalização da segunda passada funde), e as duas decisões não podem divergir.
    showPerson: printsResponsiblePerson(
      data.organizerName,
      data.organizerPersonName,
    ),
  });
  const footerBottom = footnoteTop - footer.gapToFootnote;
  const footerTop = footerBottom - footer.height;

  drawMiddle(canvas, fonts, {
    participantName,
    runs: buildCertificateParagraph({
      ...data,
      eventTitle: eventTitle,
      organizerName,
      eventLocationName: data.eventLocationName
        ? clean(data.eventLocationName)
        : null,
    }),
    top: CONTENT_TOP + 40,
    bottom: footerTop,
  });

  footer.draw(canvas, footerBottom, {
    issuedAt: formatLongDate(data.issuedAt),
    host: displayHost(data.appWebUrl),
    code,
    verifyUrl,
  });

  const footnote =
    "Emitido com base na presença registrada pelo organizador da ação. A autenticidade pode ser conferida pelo código ou pelo QR code.";
  canvas.text(footnote, {
    x: CENTER_X - textWidth(footnote, fonts.regular, 12) / 2,
    top: footnoteTop,
    size: 12,
    font: fonts.regular,
    color: MUTED,
  });

  return Buffer.from(await doc.save());
}

function drawHeader(canvas: Canvas, fonts: Fonts): void {
  const shieldScale = 40 / 36;
  canvas.svgPath(
    SHIELD_OUTER_PATH,
    CONTENT_LEFT,
    CONTENT_TOP,
    shieldScale,
    TEAL,
  );
  canvas.svgPath(
    SHIELD_INNER_PATH,
    CONTENT_LEFT,
    CONTENT_TOP,
    shieldScale,
    SHIELD_INNER,
  );

  const brandH = 22 * NORMAL_LINE;
  const taglineH = 12 * NORMAL_LINE;
  const top = CONTENT_TOP + (40 - (brandH + 2 + taglineH)) / 2;
  const x = CONTENT_LEFT + 40 + 12;
  canvas.text("Amparian", {
    x,
    top,
    size: 22,
    font: fonts.bold,
    color: TEAL,
    letterSpacing: -0.22,
  });
  canvas.text("Gestão de voluntariado", {
    x,
    top: top + brandH + 2,
    size: 12,
    font: fonts.regular,
    color: MUTED,
  });
}

type ParagraphStyle = { size: number; width: number; maxLines: number };

// Escala de tamanhos do mockup: nome 36 → 30 → 26 px (em até duas linhas); parágrafo 17 → 15 px
// quando passa de cinco linhas. Os degraus seguintes não estão no desenho — existem só para um
// texto no limite das colunas (255 caracteres em nome, título, organização e local, mesmo sem
// nenhum espaço) nunca vazar da página. O último par (nome a 14 px, parágrafo a 7 px) cabe com
// folga nesse pior caso, e um teste confere isso.
const NAME_STYLES = [
  { size: 36, maxLines: 1, lineHeight: 1.2 },
  { size: 30, maxLines: 1, lineHeight: 1.2 },
  { size: 26, maxLines: 2, lineHeight: 1.25 },
  { size: 22, maxLines: 3, lineHeight: 1.25 },
  { size: 18, maxLines: 5, lineHeight: 1.25 },
  { size: 14, maxLines: Infinity, lineHeight: 1.25 },
];
const PARAGRAPH_STYLES: ParagraphStyle[] = [
  { size: 17, width: 800, maxLines: 5 },
  { size: 15, width: 840, maxLines: 7 },
  { size: 13, width: 860, maxLines: 10 },
  { size: 11, width: 880, maxLines: 14 },
  { size: 9, width: 900, maxLines: 18 },
  { size: 7, width: 900, maxLines: Infinity },
];
const NAME_MAX_WIDTH = 820;
const PARAGRAPH_LINE_HEIGHT = 1.65;

function drawMiddle(
  canvas: Canvas,
  fonts: Fonts,
  input: {
    participantName: string;
    runs: ReturnType<typeof buildCertificateParagraph>;
    top: number;
    bottom: number;
  },
): void {
  const pieces: Piece[] = input.runs.map((run) => ({
    text: run.text,
    font: run.strong ? fonts.semibold : fonts.regular,
    color: run.strong ? TEAL : INK,
  }));

  const available = input.bottom - input.top;
  let chosen: {
    name: { size: number; lineHeight: number; lines: Line[]; space: number };
    paragraph: { size: number; lines: Line[]; space: number };
    compact: boolean;
    height: number;
  } | null = null;

  // Escolhe o maior par (nome, parágrafo) que respeita as regras de linhas E cabe na altura livre.
  outer: for (const nameStyle of NAME_STYLES) {
    const nameSpace = fonts.bold.widthOfTextAtSize(" ", nameStyle.size);
    const nameLines = balancedWrap(
      toWords(
        [{ text: input.participantName, font: fonts.bold, color: INK }],
        nameStyle.size,
      ),
      nameStyle.size,
      NAME_MAX_WIDTH,
      nameSpace,
    );
    const lastName = nameStyle === NAME_STYLES[NAME_STYLES.length - 1];
    if (nameLines.length > nameStyle.maxLines && !lastName) continue;

    for (const style of PARAGRAPH_STYLES) {
      const space = fonts.regular.widthOfTextAtSize(" ", style.size);
      const lines = wrap(
        toWords(pieces, style.size),
        style.size,
        style.width,
        space,
      );
      if (lines.length > style.maxLines) continue;

      const compact = nameStyle.size < 30 || style.size < 17;
      const height = middleHeight({
        compact,
        nameSize: nameStyle.size,
        nameLineHeight: nameStyle.lineHeight,
        nameLines: nameLines.length,
        paragraphSize: style.size,
        paragraphLines: lines.length,
      });
      const candidate = {
        name: {
          size: nameStyle.size,
          lineHeight: nameStyle.lineHeight,
          lines: nameLines,
          space: nameSpace,
        },
        paragraph: { size: style.size, lines, space },
        compact,
        height,
      };
      chosen = candidate;
      if (height <= available) break outer;
    }
  }
  // Nem o menor par coube: melhor não emitir do que imprimir texto por cima do rodapé. Com texto
  // em letras, nos limites de tamanho das colunas, não acontece (o teste do pior caso confere);
  // 255 símbolos largos da Inter (setas como "⟷") ainda podem chegar aqui.
  if (!chosen || chosen.height > available) {
    throw internalServerError(
      "CERTIFICATE_LAYOUT_OVERFLOW",
      "Não foi possível gerar o arquivo do certificado",
    );
  }

  // Centralizado na altura livre, como o `justify-content: center` do mockup.
  let y = input.top + Math.max((available - chosen.height) / 2, 0);

  const kicker = "TRABALHO VOLUNTÁRIO";
  const kickerSpacing = 13 * 0.24;
  canvas.text(kicker, {
    x: CENTER_X - textWidth(kicker, fonts.semibold, 13, kickerSpacing) / 2,
    top: y,
    size: 13,
    font: fonts.semibold,
    color: KICKER,
    letterSpacing: kickerSpacing,
  });
  y += 13 * NORMAL_LINE + 10;

  const title = "Certificado de Participação";
  const titleSpacing = 44 * -0.02;
  canvas.text(title, {
    x: CENTER_X - textWidth(title, fonts.extrabold, 44, titleSpacing) / 2,
    top: y,
    size: 44,
    font: fonts.extrabold,
    color: TEAL,
    lineHeight: 1.15,
    letterSpacing: titleSpacing,
  });
  y += 44 * 1.15 + (chosen.compact ? 30 : 36);

  const intro = "Certificamos que";
  canvas.text(intro, {
    x: CENTER_X - textWidth(intro, fonts.regular, 16) / 2,
    top: y,
    size: 16,
    font: fonts.regular,
    color: MUTED,
  });
  y += 16 * NORMAL_LINE + 8;

  for (const line of chosen.name.lines) {
    canvas.line(line, {
      x: CENTER_X - line.width / 2,
      top: y,
      size: chosen.name.size,
      lineHeight: chosen.name.lineHeight,
      spaceWidth: chosen.name.space,
    });
    y += chosen.name.size * chosen.name.lineHeight;
  }
  y += chosen.compact ? 14 : 16;

  canvas.rect(CENTER_X - 60, y, 120, 2, SHIELD_INNER);
  y += 2 + (chosen.compact ? 18 : 22);

  for (const line of chosen.paragraph.lines) {
    canvas.line(line, {
      x: CENTER_X - line.width / 2,
      top: y,
      size: chosen.paragraph.size,
      lineHeight: PARAGRAPH_LINE_HEIGHT,
      spaceWidth: chosen.paragraph.space,
    });
    y += chosen.paragraph.size * PARAGRAPH_LINE_HEIGHT;
  }
}

function middleHeight(m: {
  compact: boolean;
  nameSize: number;
  nameLineHeight: number;
  nameLines: number;
  paragraphSize: number;
  paragraphLines: number;
}): number {
  return (
    13 * NORMAL_LINE +
    10 +
    44 * 1.15 +
    (m.compact ? 30 : 36) +
    16 * NORMAL_LINE +
    8 +
    m.nameSize * m.nameLineHeight * m.nameLines +
    (m.compact ? 14 : 16) +
    2 +
    (m.compact ? 18 : 22) +
    m.paragraphSize * PARAGRAPH_LINE_HEIGHT * m.paragraphLines
  );
}

/**
 * Rodapé em três colunas alinhadas pela base (o `align-items: flex-end` do mockup): responsável à
 * esquerda, emissão no centro, verificação com QR code à direita.
 */
function layoutFooter(
  fonts: Fonts,
  input: {
    organizerName: string;
    organizerPersonName: string;
    /** Se imprime a linha "Responsável:" — regra em `printsResponsiblePerson`. */
    showPerson: boolean;
  },
) {
  const { showPerson } = input;

  // Organização em uma linha a 15 px numa coluna de 280; se não couber, 14 px em até três linhas
  // numa coluna de 300 (mockup "textos no limite"); depois disso, 12 px em até quatro, com
  // reticências além disso.
  const orgOptions = [
    { size: 15, width: 280, maxLines: 1, lineHeight: NORMAL_LINE },
    { size: 14, width: 300, maxLines: 3, lineHeight: 1.35 },
    { size: 12, width: 300, maxLines: 4, lineHeight: 1.35 },
  ];
  let org = {
    size: 15,
    width: 280,
    lineHeight: NORMAL_LINE,
    lines: [] as Line[],
    space: 0,
  };
  for (const option of orgOptions) {
    const space = fonts.semibold.widthOfTextAtSize(" ", option.size);
    const lines = wrap(
      toWords(
        [{ text: input.organizerName, font: fonts.semibold, color: INK }],
        option.size,
      ),
      option.size,
      option.width,
      space,
    );
    org = {
      ...option,
      lines: clampLines(
        lines,
        option.maxLines,
        option.size,
        option.width,
        space,
      ),
      space,
    };
    if (lines.length <= option.maxLines) break;
  }

  const personText = `Responsável: ${input.organizerPersonName}`;
  const personSpace = fonts.regular.widthOfTextAtSize(" ", 13);
  const personLines = showPerson
    ? clampLines(
        wrap(
          toWords(
            [{ text: personText, font: fonts.regular, color: MUTED }],
            13,
          ),
          13,
          org.width,
          personSpace,
        ),
        2,
        13,
        org.width,
        personSpace,
      )
    : [];

  const orgH = org.lines.length * org.size * org.lineHeight;
  const personH = personLines.length * 13 * NORMAL_LINE;
  // gap 4 entre itens; o traço tem margin-top 6 (além do gap) e 1px.
  const leftH =
    orgH + (showPerson ? 4 + personH : 0) + 4 + 6 + 1 + 4 + 12 * NORMAL_LINE;
  const centerH = 13 * NORMAL_LINE + 4 + 12 * NORMAL_LINE + 2;
  const qrSize = 92;
  const rightTextH = 12 * NORMAL_LINE * 3 + 13 * NORMAL_LINE + 3 * 3;
  const height = Math.max(leftH, centerH, qrSize, rightTextH);
  const gapToFootnote = org.lines.length > 1 ? 16 : 18;

  function draw(
    canvas: Canvas,
    bottom: number,
    content: {
      issuedAt: string;
      host: string;
      code: string;
      verifyUrl: string;
    },
  ): void {
    // Esquerda
    let y = bottom - leftH;
    for (const line of org.lines) {
      canvas.line(line, {
        x: CONTENT_LEFT,
        top: y,
        size: org.size,
        lineHeight: org.lineHeight,
        spaceWidth: org.space,
      });
      y += org.size * org.lineHeight;
    }
    if (showPerson) {
      y += 4;
      for (const line of personLines) {
        canvas.line(line, {
          x: CONTENT_LEFT,
          top: y,
          size: 13,
          lineHeight: NORMAL_LINE,
          spaceWidth: personSpace,
        });
        y += 13 * NORMAL_LINE;
      }
    }
    y += 4 + 6;
    canvas.rect(CONTENT_LEFT, y, org.width, 1, INK);
    y += 1 + 4;
    canvas.text("Organizador(a) responsável", {
      x: CONTENT_LEFT,
      top: y,
      size: 12,
      font: fonts.regular,
      color: MUTED,
    });

    // Centro
    const issued = `Emitido em ${content.issuedAt}`;
    let cy = bottom - centerH;
    canvas.text(issued, {
      x: CENTER_X - textWidth(issued, fonts.regular, 13) / 2,
      top: cy,
      size: 13,
      font: fonts.regular,
      color: INK,
    });
    cy += 13 * NORMAL_LINE + 4;
    const platform = "pela plataforma Amparian";
    canvas.text(platform, {
      x: CENTER_X - textWidth(platform, fonts.regular, 12) / 2,
      top: cy,
      size: 12,
      font: fonts.regular,
      color: MUTED,
    });

    // Direita: QR code encostado na margem, textos alinhados à direita e centralizados na altura
    // do QR (o `align-items: center` da coluna).
    const qrLeft = CONTENT_RIGHT - qrSize;
    const qrTop = bottom - qrSize;
    drawQrCode(canvas, content.verifyUrl, qrLeft, qrTop, qrSize);

    const textRight = qrLeft - 14;
    let ry = qrTop + (qrSize - rightTextH) / 2;
    const rightLines: Array<{
      text: string;
      font: PDFFont;
      size: number;
      color: Color;
      spacing?: number;
    }> = [
      {
        text: "Verifique a autenticidade",
        font: fonts.semibold,
        size: 12,
        color: TEAL,
      },
      { text: content.host, font: fonts.regular, size: 12, color: MUTED },
      {
        text: "/certificados/verificar",
        font: fonts.regular,
        size: 12,
        color: MUTED,
      },
      {
        text: content.code,
        font: fonts.semibold,
        size: 13,
        color: INK,
        spacing: 13 * 0.08,
      },
    ];
    for (const line of rightLines) {
      canvas.text(line.text, {
        x: textRight - textWidth(line.text, line.font, line.size, line.spacing),
        top: ry,
        size: line.size,
        font: line.font,
        color: line.color,
        letterSpacing: line.spacing,
      });
      ry += line.size * NORMAL_LINE + 3;
    }
  }

  return { height, gapToFootnote, draw };
}

/**
 * QR code vetorial, desenhado módulo a módulo (sem imagem): nítido em qualquer zoom e impressão.
 * Correção de erro "M" (15%): aguenta um papel amassado ou um carimbo por cima sem engordar o
 * código a ponto de os módulos ficarem pequenos demais em 92 px.
 */
function drawQrCode(
  canvas: Canvas,
  url: string,
  left: number,
  top: number,
  size: number,
): void {
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const module = size / n;

  canvas.rect(left, top, size, size, rgb(1, 1, 1));

  // Um só caminho com as faixas horizontais de módulos escuros: menos operações no PDF, e sem as
  // emendas finas que módulos desenhados um a um deixam em alguns leitores.
  let d = "";
  for (let row = 0; row < n; row++) {
    let col = 0;
    while (col < n) {
      if (!qr.modules.get(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < n && qr.modules.get(row, col)) col++;
      d += `M${start * module} ${row * module}h${(col - start) * module}v${module}h${-(col - start) * module}z`;
    }
  }
  canvas.svgPath(d, left, top, 1, TEAL);
}
