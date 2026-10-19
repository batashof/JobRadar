import { callProblem, htmlProblem, MAX_MESSAGE_LENGTH, visibleText } from './support/fake-telegram';

/** The fake must reject what the real Bot API rejects, or the scenarios prove nothing. */
describe('FakeTelegram validation', () => {
  it('accepts Telegram HTML and decodes it to what the user sees', () => {
    const html = '<b>Senior</b> <a href="https://x.dev/?a=1&amp;b=2">R&amp;D</a> &lt;team&gt; &quot;q&quot;';
    expect(htmlProblem(html)).toBeNull();
    expect(visibleText(html)).toBe('Senior R&D <team> "q"');
  });

  it.each([
    ['R&D', 'unescaped "&"'],
    ['a < b', 'unescaped "<"'],
    ['<div>x</div>', 'unsupported tag <div>'],
    ['<b><i>x</b></i>', 'unexpected </b>'],
    ['<b>x', 'unclosed <b>'],
  ])('rejects %s', (html, problem) => {
    expect(htmlProblem(html)).toContain(problem);
  });

  it('rejects an over-long message, counting visible characters only', () => {
    const atLimit = `<b>${'x'.repeat(MAX_MESSAGE_LENGTH)}</b>`;
    expect(callProblem('sendMessage', { text: atLimit, parse_mode: 'HTML' })).toBeNull();
    expect(callProblem('sendMessage', { text: `${atLimit}y`, parse_mode: 'HTML' })).toMatch(/too long/);
  });

  it('rejects broken buttons', () => {
    const send = (button: Record<string, string>) =>
      callProblem('sendMessage', { text: 'hi', reply_markup: { inline_keyboard: [[button]] } });
    expect(send({ text: 'ok', callback_data: 'd:n' })).toBeNull();
    expect(send({ text: 'long', callback_data: 'x'.repeat(65) })).toMatch(/65 bytes/);
    expect(send({ text: 'both', callback_data: 'a', url: 'https://x.dev' })).toMatch(/exactly one action/);
    expect(send({ text: '', callback_data: 'a' })).toMatch(/without text/);
    expect(send({ text: 'link', url: 'javascript:alert(1)' })).toMatch(/not http/);
  });
});
