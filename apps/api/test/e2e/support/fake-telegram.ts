/**
 * A stand-in for api.telegram.org: replaces the global `fetch` for that host
 * only, records every Bot API call the app makes, and rejects payloads the real
 * Telegram would reject (over-long text, broken HTML, oversized button data).
 * The app swallows send failures into warn logs, so a rejected call is also
 * kept in `violations` for the tests to assert on; in production the user
 * would simply have seen nothing.
 */

const TELEGRAM_HOST = 'api.telegram.org';
/** Telegram's limit on a message's text after entity parsing. */
export const MAX_MESSAGE_LENGTH = 4096;
/** Telegram's limit on `callback_data`, in bytes. */
export const MAX_CALLBACK_DATA_BYTES = 64;
/** The tags Telegram's HTML parse mode accepts. */
const ALLOWED_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'a', 'code', 'pre',
  'span', 'tg-spoiler', 'blockquote', 'tg-emoji',
]);

export interface WireButton {
  text?: string;
  callback_data?: string;
  url?: string;
}

export interface BotCall {
  method: string;
  body: Record<string, unknown>;
}

/** A message the bot sent (sendMessage) or rewrote (editMessageText). */
export interface SentMessage {
  method: 'sendMessage' | 'editMessageText';
  chatId: string;
  messageId: number;
  text: string;
  buttons: WireButton[];
}

export interface Violation {
  method: string;
  reason: string;
  body: Record<string, unknown>;
}

/** Plain text as the user sees it: tags gone, entities decoded. */
export function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

/**
 * The checks Telegram applies to `parse_mode: HTML`: only known tags, every
 * tag closed in order, and `&` only as an entity. Returns the first problem.
 */
export function htmlProblem(html: string): string | null {
  const stack: string[] = [];
  const tag = /<(\/?)([a-zA-Z-]+)([^>]*)>|<|&(?!(?:amp|lt|gt|quot|#\d+);)/g;
  for (const match of html.matchAll(tag)) {
    const [whole, closing, name] = match;
    if (whole === '<') return `unescaped "<" at ${match.index}`;
    if (whole === '&') return `unescaped "&" at ${match.index}`;
    const lower = (name ?? '').toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) return `unsupported tag <${lower}>`;
    if (closing) {
      if (stack.pop() !== lower) return `unexpected </${lower}>`;
    } else {
      stack.push(lower);
    }
  }
  return stack.length > 0 ? `unclosed <${stack[stack.length - 1]}>` : null;
}

function keyboardProblem(markup: unknown): string | null {
  if (markup === undefined) return null;
  const rows = (markup as { inline_keyboard?: WireButton[][] }).inline_keyboard;
  if (!Array.isArray(rows)) return 'reply_markup without inline_keyboard';
  for (const button of rows.flat()) {
    if (!button.text) return 'button without text';
    const actions = [button.callback_data, button.url].filter((v) => v !== undefined);
    if (actions.length !== 1) return `button "${button.text}" needs exactly one action`;
    if (button.callback_data !== undefined) {
      const bytes = Buffer.byteLength(button.callback_data);
      if (bytes === 0 || bytes > MAX_CALLBACK_DATA_BYTES) {
        return `callback_data "${button.callback_data}" is ${bytes} bytes`;
      }
    }
    if (button.url !== undefined && !/^(https?|tg):\/\//.test(button.url)) {
      return `button url "${button.url}" is not http(s) or tg`;
    }
  }
  return null;
}

/** Why Telegram would refuse this call, or null when it would accept it. */
export function callProblem(method: string, body: Record<string, unknown>): string | null {
  if (method !== 'sendMessage' && method !== 'editMessageText') {
    return method === 'editMessageReplyMarkup' ? keyboardProblem(body.reply_markup) : null;
  }
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) return 'empty text';
  if (body.parse_mode === 'HTML') {
    const problem = htmlProblem(text);
    if (problem) return `can't parse entities: ${problem}`;
  }
  const length = (body.parse_mode === 'HTML' ? visibleText(text) : text).length;
  if (length > MAX_MESSAGE_LENGTH) return `message is too long (${length})`;
  return keyboardProblem(body.reply_markup);
}

export class FakeTelegram {
  readonly calls: BotCall[] = [];
  readonly violations: Violation[] = [];
  /** file_id → bytes served by getFile + the file endpoint. */
  private readonly files = new Map<string, Buffer>();
  private nextMessageId = 1000;
  private realFetch: typeof fetch | null = null;

  install(): void {
    this.realFetch = globalThis.fetch;
    const real = this.realFetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (url.hostname !== TELEGRAM_HOST) return real(input, init);
      return this.handle(url, init);
    }) as typeof fetch;
  }

  uninstall(): void {
    if (this.realFetch) globalThis.fetch = this.realFetch;
    this.realFetch = null;
  }

  addFile(fileId: string, bytes: Buffer): void {
    this.files.set(fileId, bytes);
  }

  /** Forgets what happened so far; the next assertions see only new calls. */
  reset(): void {
    this.calls.length = 0;
    this.violations.length = 0;
  }

  /** Messages sent or rewritten in one chat, oldest first. */
  messagesTo(chatId: string | number): SentMessage[] {
    return this.calls
      .filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText')
      .filter((c) => String(c.body.chat_id) === String(chatId))
      .map((c) => ({
        method: c.method as SentMessage['method'],
        chatId: String(c.body.chat_id),
        messageId: Number(c.body.message_id ?? c.body.__message_id),
        text: visibleText(String(c.body.text ?? '')),
        buttons: ((c.body.reply_markup as { inline_keyboard?: WireButton[][] } | undefined)
          ?.inline_keyboard ?? []).flat(),
      }));
  }

  callsOf(method: string): BotCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  private async handle(url: URL, init?: RequestInit): Promise<Response> {
    // /file/bot<token>/<path>: the second half of a download.
    const file = url.pathname.match(/^\/file\/bot[^/]+\/(.+)$/);
    if (file) {
      const bytes = this.files.get(decodeURIComponent(file[1] ?? ''));
      return bytes ? new Response(new Uint8Array(bytes)) : new Response('not found', { status: 404 });
    }

    const method = url.pathname.split('/').pop() ?? '';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const problem = callProblem(method, body);
    if (problem) {
      this.violations.push({ method, reason: problem, body });
      return json({ ok: false, error_code: 400, description: `Bad Request: ${problem}` });
    }

    switch (method) {
      case 'sendMessage': {
        const messageId = this.nextMessageId++;
        this.calls.push({ method, body: { ...body, __message_id: messageId } });
        return json({ ok: true, result: { message_id: messageId, chat: { id: Number(body.chat_id) } } });
      }
      case 'getMe':
        this.calls.push({ method, body });
        return json({ ok: true, result: { id: 1, is_bot: true, username: 'JobRadarTestBot' } });
      case 'getFile': {
        this.calls.push({ method, body });
        const id = String(body.file_id);
        const bytes = this.files.get(id);
        if (!bytes) return json({ ok: false, error_code: 400, description: 'Bad Request: invalid file_id' });
        return json({ ok: true, result: { file_id: id, file_path: id, file_size: bytes.length } });
      }
      default:
        // answerCallbackQuery, editMessageText, editMessageReplyMarkup,
        // setMyCommands, setWebhook: Telegram answers `true`.
        this.calls.push({ method, body });
        return json({ ok: true, result: true });
    }
  }
}

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
}
