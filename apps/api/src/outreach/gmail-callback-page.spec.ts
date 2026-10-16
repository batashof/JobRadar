import { gmailCallbackPage } from './gmail-callback-page';

describe('gmailCallbackPage', () => {
  it.each([
    ['connected', 'Gmail connected'],
    ['denied', 'access was not granted'],
    ['error', 'Try /gmail again'],
  ] as const)('reports %s and links back to the bot', (outcome, text) => {
    const page = gmailCallbackPage(outcome);
    expect(page).toContain(text);
    expect(page).toContain('href="https://t.me/JobRadarAppBot"');
  });
});
