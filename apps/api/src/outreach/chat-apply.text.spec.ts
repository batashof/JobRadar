import {
  applyText,
  confirmKeyboard,
  renderEmailDraft,
  renderLinkApply,
  renderTelegramApply,
  telegramContactUrl,
} from './chat-apply.text';

describe('applyText', () => {
  it('interpolates variables', () => {
    expect(applyText('ru', 'draftTitle', { title: 'Frontend' })).toBe('Отклик на «Frontend»');
  });

  it('falls back to English for an unknown language', () => {
    expect(applyText('de' as never, 'send')).toBe('Send');
  });
});

describe('renderEmailDraft', () => {
  const draft = {
    recipient: 'hr@acme.test',
    subject: 'Senior Frontend Engineer',
    body: 'Hello,\n\nI would like to apply.',
  };

  it('shows exactly what will be sent', () => {
    const text = renderEmailDraft('ru', draft, 'Senior Frontend');
    expect(text).toContain('hr@acme.test');
    expect(text).toContain('Senior Frontend Engineer');
    // <pre> preserves the body's line breaks and makes it copyable in one tap.
    expect(text).toContain('<pre>Hello,\n\nI would like to apply.</pre>');
  });

  it('escapes a body the model wrote with angle brackets', () => {
    const text = renderEmailDraft('ru', { ...draft, body: '<b>hi</b> & bye' }, 'T');
    expect(text).toContain('&lt;b&gt;hi&lt;/b&gt; &amp; bye');
  });

  it('escapes a scraped vacancy title', () => {
    expect(renderEmailDraft('ru', draft, '<i>Dev</i>')).toContain('&lt;i&gt;Dev&lt;/i&gt;');
  });
});

describe('confirmKeyboard', () => {
  it('offers send and cancel against the draft id', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    expect(confirmKeyboard('ru', id)).toEqual([
      [
        { text: 'Отправить', callbackData: `a:s:${id}` },
        { text: 'Отмена', callbackData: `a:x:${id}` },
      ],
    ]);
  });

  it('stays inside the 64-byte callback limit', () => {
    for (const button of confirmKeyboard('ru', '11111111-2222-3333-4444-555555555555').flat()) {
      expect(Buffer.byteLength(button.callbackData ?? '')).toBeLessThanOrEqual(64);
    }
  });
});

describe('renderTelegramApply', () => {
  it('names the contact and gives a copyable letter', () => {
    const text = renderTelegramApply('ru', '@hr_acme', 'Здравствуйте!');
    expect(text).toContain('@hr_acme');
    expect(text).toContain('<pre>Здравствуйте!</pre>');
  });
});

describe('renderLinkApply', () => {
  it('explains that the application goes through the site', () => {
    const text = renderLinkApply('ru', 'Letter');
    expect(text).toContain('через сайт');
    expect(text).toContain('<pre>Letter</pre>');
  });
});

describe('telegramContactUrl', () => {
  it('builds a link from a handle, with or without the @', () => {
    expect(telegramContactUrl('@hr_acme')).toBe('https://t.me/hr_acme');
    expect(telegramContactUrl('hr_acme')).toBe('https://t.me/hr_acme');
    expect(telegramContactUrl('  @hr_acme  ')).toBe('https://t.me/hr_acme');
  });

  it('passes an existing t.me link through', () => {
    expect(telegramContactUrl('https://t.me/hr_acme')).toBe('https://t.me/hr_acme');
    expect(telegramContactUrl('https://telegram.me/hr_acme')).toBe('https://telegram.me/hr_acme');
  });

  it('gives no button rather than a broken one', () => {
    // Scraped contacts are messy; a dead button is worse than none.
    for (const bad of ['', 'hr', 'резюме сюда', '+7 999 000 00 00', 'mail@acme.test', '@a b']) {
      expect(telegramContactUrl(bad)).toBeNull();
    }
  });
});
