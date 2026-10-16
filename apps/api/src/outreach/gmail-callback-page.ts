export type GmailCallbackOutcome = 'connected' | 'denied' | 'error';

const BOT_URL = 'https://t.me/JobRadarAppBot';

const MESSAGES: Record<GmailCallbackOutcome, string> = {
  connected: 'Gmail connected. / Gmail подключён.',
  denied: 'Gmail was not connected: access was not granted. / Gmail не подключён: доступ не выдан.',
  error: 'Gmail could not be connected. Try /gmail again. / Не удалось подключить Gmail. Попробуйте /gmail ещё раз.',
};

/** The page Google's OAuth callback answers with: the outcome and a link back to the bot. */
export function gmailCallbackPage(outcome: GmailCallbackOutcome): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>JobRadar · Gmail</title></head>' +
    '<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem">' +
    `<p>${MESSAGES[outcome]}</p>` +
    `<p><a href="${BOT_URL}">← Telegram</a></p>` +
    '</body></html>'
  );
}
