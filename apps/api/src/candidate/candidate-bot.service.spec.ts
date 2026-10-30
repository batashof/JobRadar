import type { ConfigService } from '@nestjs/config';

import type { BotCallbackContext, BotMessageContext } from '../bot/bot.service';
import { events } from '../db/schema';
import { CandidateBotService } from './candidate-bot.service';
import type { CandidateProfileRow } from './candidate.service';

const llmReply = JSON.stringify({
  role: 'Frontend Developer',
  grade: 'senior',
  years: 8,
  skills: [{ name: 'React', weight: 'core' }],
  english: 'B2',
  location: null,
  salaryUsd: null,
  evaluation: { strengths: ['Strong React'], gaps: ['No tests'], suggestions: ['Add Jest'] },
});

const storedProfile: CandidateProfileRow = {
  userId: 'user-1',
  resumeId: 'resume-1',
  source: 'llm',
  promptVersion: 1,
  role: 'Frontend Developer',
  grade: 'senior',
  years: 8,
  skills: [{ name: 'React', weight: 'core' }],
  english: 'B2',
  location: null,
  salaryUsd: null,
  evaluation: null,
  feedbackWeights: { skills: {}, companies: {} },
  confirmedAt: null,
  analyzedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

function setup(options: { role?: 'owner' | 'user'; analyses?: number; llm?: 'ok' | 'fail' } = {}) {
  const writes: { table: unknown; values: unknown }[] = [];
  const db = {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        writes.push({ table, values });
        return Promise.resolve();
      },
    }),
  };
  const bot = {
    registerDocumentHandler: jest.fn(),
    registerDialog: jest.fn(),
    registerCallback: jest.fn(),
    registerCommand: jest.fn(),
    downloadFile: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
    sendToUser: jest.fn().mockResolvedValue('1'),
    reportError: jest.fn().mockResolvedValue(undefined),
  };
  const dialogs = { open: jest.fn(), close: jest.fn() };
  const llm = {
    complete:
      options.llm === 'fail'
        ? jest.fn().mockRejectedValue(new Error('all providers failed'))
        : jest.fn().mockResolvedValue({ text: llmReply, provider: 'groq', model: 'm' }),
  };
  const resumes = {
    upload: jest.fn().mockResolvedValue({ id: 'resume-1' }),
    getActive: jest
      .fn()
      .mockResolvedValue({
        id: 'resume-1',
        filename: 'cv.pdf',
        extractedText: 'Senior Frontend, React, TypeScript',
        uploadedAt: new Date('2026-10-16T08:00:00Z'),
      }),
  };
  const profiles = {
    get: jest.fn().mockResolvedValue(storedProfile),
    replace: jest.fn(),
    update: jest.fn(),
    confirm: jest.fn(),
    analysesInWindow: jest.fn().mockResolvedValue(options.analyses ?? 0),
  };
  const service = new CandidateBotService(
    db as never,
    bot as never,
    dialogs as never,
    llm as never,
    resumes as never,
    profiles as never,
    { get: () => undefined } as unknown as ConfigService,
  );
  const ctx: BotMessageContext = { userId: 'user-1', chatId: '555', language: 'ru', role: options.role ?? 'user' };
  return { service, bot, dialogs, llm, resumes, profiles, writes, ctx };
}

const pdf = { fileId: 'F1', fileName: 'cv.pdf', mimeType: 'application/pdf', fileSize: 1000 };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const sent = (bot: { sendToUser: jest.Mock }) => bot.sendToUser.mock.calls.map((c) => c[1] as string);

describe('CandidateBotService — upload', () => {
  it('registers the document handler, the profile dialog and the p: buttons', () => {
    const { service, bot } = setup();
    service.onModuleInit();
    expect(bot.registerDocumentHandler).toHaveBeenCalled();
    expect(bot.registerDialog).toHaveBeenCalledWith('profile', expect.any(Function));
    expect(bot.registerCallback).toHaveBeenCalledWith('p', expect.any(Function));
    expect(bot.registerCommand).toHaveBeenCalledWith('resume', expect.any(Function));
    expect(bot.registerCommand).toHaveBeenCalledWith('setup', expect.any(Function));
    expect(bot.registerCommand).toHaveBeenCalledWith('noresume', expect.any(Function));
  });

  it('refuses a file that is not a PDF, and one over 5 MB, without downloading', async () => {
    const { service, bot, ctx } = setup();
    await service.onDocument(ctx, { ...pdf, fileName: 'cv.docx', mimeType: 'application/msword' });
    await service.onDocument(ctx, { ...pdf, fileSize: 6 * 1024 * 1024 });
    expect(bot.downloadFile).not.toHaveBeenCalled();
    expect(sent(bot)).toEqual([expect.stringContaining('PDF'), expect.stringContaining('5 МБ')]);
  });

  it('stops a user who used the three analyses of the window', async () => {
    const { service, bot, ctx } = setup({ analyses: 3 });
    await service.onDocument(ctx, pdf);
    expect(bot.downloadFile).not.toHaveBeenCalled();
    expect(sent(bot)[0]).toContain('все 3 анализа');
  });

  it('reports a failed download to the owner and asks the user to resend (v2.6.0)', async () => {
    const { service, bot, ctx } = setup();
    bot.downloadFile.mockRejectedValueOnce(new Error('file is too big'));
    await service.onDocument(ctx, pdf);
    await settle();
    expect(bot.reportError).toHaveBeenCalledWith('resume download', expect.any(Error), 'user-1');
    expect(sent(bot).at(-1)).toContain('Не удалось скачать файл');
  });

  it('never limits the owner', async () => {
    const { service, bot, ctx } = setup({ role: 'owner', analyses: 10 });
    await service.onDocument(ctx, pdf);
    await settle();
    expect(bot.downloadFile).toHaveBeenCalled();
  });

  it('stores the resume, analyses it on privacy-safe providers only, then shows the review and the card', async () => {
    const { service, bot, llm, resumes, profiles, writes, ctx } = setup();
    await service.onDocument(ctx, pdf);
    await settle();

    expect(resumes.upload).toHaveBeenCalledWith('user-1', 'cv.pdf', expect.any(Buffer));
    expect(llm.complete).toHaveBeenCalledWith(expect.objectContaining({ providers: ['groq'] }));
    expect(profiles.replace).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ source: 'llm', grade: 'senior', english: 'B2', resumeId: 'resume-1' }),
    );
    expect(writes.map((w) => (w.values as { name: string }).name)).toEqual(['resume_uploaded', 'resume_analyzed']);
    expect(writes.every((w) => w.table === events)).toBe(true);

    const messages = sent(bot);
    expect(messages[0]).toContain('Читаю резюме');
    expect(messages[1]).toContain('Разбор резюме');
    expect(messages[2]).toContain('Твой профиль');
    expect(bot.sendToUser.mock.calls[2][2].keyboard[0][0].callbackData).toBe('p:ok');
  });

  it('corrects the model from the resume text: stated years, a skill it left out (prompt v2)', async () => {
    const { service, llm, resumes, profiles, ctx } = setup();
    llm.complete.mockResolvedValue({ text: JSON.stringify({ ...JSON.parse(llmReply), years: 7 }), provider: 'groq' });
    resumes.getActive.mockResolvedValue({
      id: 'resume-1',
      filename: 'cv.pdf',
      extractedText: '8+ years. Skills: JavaScript, React. JavaScript apps, JavaScript tooling.',
    });
    await service.onDocument(ctx, pdf);
    await settle();
    expect(profiles.replace).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        years: 8,
        promptVersion: 2,
        skills: [
          { name: 'React', weight: 'core' },
          { name: 'JavaScript', weight: 'core' },
        ],
      }),
    );
  });

  it('lets the owner use the full provider chain', async () => {
    const { service, llm, ctx } = setup({ role: 'owner' });
    await service.onDocument(ctx, pdf);
    await settle();
    expect(llm.complete).toHaveBeenCalledWith(expect.objectContaining({ providers: undefined }));
  });

  it('falls back to a profile from the resume words when every provider fails', async () => {
    const { service, bot, profiles, ctx } = setup({ llm: 'fail' });
    await service.onDocument(ctx, pdf);
    await settle();

    expect(profiles.replace).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ source: 'fallback', role: 'Frontend Developer', evaluation: null }),
    );
    const messages = sent(bot);
    expect(messages.some((m) => m.includes('Разбор резюме'))).toBe(false);
    expect(messages.at(-1)).toContain('AI-анализ сейчас недоступен');
  });

  it('says so when the PDF has no text layer', async () => {
    const { service, bot, resumes, llm, ctx } = setup();
    resumes.getActive.mockResolvedValue({ id: 'resume-1', filename: 'scan.pdf', extractedText: '  ' });
    await service.onDocument(ctx, pdf);
    await settle();
    expect(llm.complete).not.toHaveBeenCalled();
    expect(sent(bot).at(-1)).toContain('скан');
  });
});

describe('CandidateBotService — confirmation and edits', () => {
  const press = (ctx: BotMessageContext, parts: string[]): BotCallbackContext => ({
    ...ctx,
    messageId: 7,
    parts,
  });

  it('confirms the profile and records it', async () => {
    const { service, profiles, writes, ctx } = setup();
    const result = await service.onCallback(press(ctx, ['p', 'ok']));
    expect(profiles.confirm).toHaveBeenCalledWith('user-1');
    expect(writes[0]?.values).toMatchObject({ name: 'profile_confirmed' });
    expect(result.editText).toContain('Профиль сохранён');
    expect(result.editKeyboard).toBeNull();
  });

  it('opens the grade picker, then stores the pick and redraws the card', async () => {
    const { service, profiles, ctx } = setup();
    const picker = await service.onCallback(press(ctx, ['p', 'g']));
    expect(picker.editKeyboard?.flat().map((b) => b.callbackData)).toContain('p:g:lead');

    const card = await service.onCallback(press(ctx, ['p', 'g', 'lead']));
    expect(profiles.update).toHaveBeenCalledWith('user-1', { grade: 'lead' });
    expect(card.editText).toContain('Твой профиль');
  });

  it('ignores a value that is not on the list', async () => {
    const { service, profiles, ctx } = setup();
    await service.onCallback(press(ctx, ['p', 'e', 'Z9']));
    expect(profiles.update).not.toHaveBeenCalled();
  });

  it('asks for skills as text and stores the typed answer', async () => {
    const { service, dialogs, profiles, bot, ctx } = setup();
    await service.onCallback(press(ctx, ['p', 's']));
    expect(dialogs.open).toHaveBeenCalledWith('555', expect.objectContaining({ flow: 'profile', step: 'skills' }));

    await service.onSkillsText(ctx, 'Vue, Nuxt, Pinia');
    expect(profiles.update).toHaveBeenCalledWith('user-1', {
      skills: [
        { name: 'Vue', weight: 'core' },
        { name: 'Nuxt', weight: 'core' },
        { name: 'Pinia', weight: 'core' },
      ],
    });
    expect(dialogs.close).toHaveBeenCalledWith('555');
    expect(sent(bot).at(-1)).toContain('Твой профиль');
  });

  it('shows the current skills on edit and adds one with +', async () => {
    const { service, profiles, bot, ctx } = setup();
    await service.onCallback(press(ctx, ['p', 's']));
    expect(sent(bot)[0]).toContain('Сейчас: <code>React</code>');

    await service.onSkillsText(ctx, '+JavaScript');
    expect(profiles.update).toHaveBeenCalledWith('user-1', {
      skills: [
        { name: 'React', weight: 'core' },
        { name: 'JavaScript', weight: 'core' },
      ],
    });
  });

  it('asks for years as text, stores a number and redraws the card', async () => {
    const { service, dialogs, profiles, bot, ctx } = setup();
    await service.onCallback(press(ctx, ['p', 'y']));
    expect(dialogs.open).toHaveBeenCalledWith('555', expect.objectContaining({ flow: 'profile', step: 'years' }));
    expect(sent(bot)[0]).toContain('Сколько лет');

    await service.onYearsText(ctx, 'eight');
    expect(profiles.update).not.toHaveBeenCalled();
    expect(sent(bot).at(-1)).toContain('цифрами');

    await service.onYearsText(ctx, '8+');
    expect(profiles.update).toHaveBeenCalledWith('user-1', { years: 8 });
    expect(dialogs.close).toHaveBeenCalledWith('555');
    expect(sent(bot).at(-1)).toContain('Твой профиль');
  });

  it('routes a typed answer of the years step to the years handler', async () => {
    const { service, bot, profiles, ctx } = setup();
    service.onModuleInit();
    const handler = bot.registerDialog.mock.calls[0][1];
    await handler(ctx, '9', { step: 'years' });
    expect(profiles.update).toHaveBeenCalledWith('user-1', { years: 9 });
  });

  it('keeps the dialog open when the answer has no skills', async () => {
    const { service, dialogs, profiles, bot, ctx } = setup();
    await service.onSkillsText(ctx, ' , ');
    expect(profiles.update).not.toHaveBeenCalled();
    expect(dialogs.close).not.toHaveBeenCalled();
    expect(sent(bot)[0]).toContain('Не нашёл навыков');
  });

  it('refuses a re-analysis past the limit', async () => {
    const { service, llm, ctx } = setup({ analyses: 3 });
    const result = await service.onCallback(press(ctx, ['p', 'retry']));
    expect(result.alert).toContain('все 3 анализа');
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('answers a press without a profile', async () => {
    const { service, profiles, ctx } = setup();
    profiles.get.mockResolvedValue(null);
    expect(await service.onCallback(press(ctx, ['p', 'ok']))).toEqual({
      alert: 'Сначала пришли резюме в PDF или задай профиль вручную: /noresume.',
    });
  });
});

describe('CandidateBotService — /resume and /setup (roadmap 5.9)', () => {
  const press = (parts: string[]): BotCallbackContext => ({
    userId: 'user-1',
    chatId: '555',
    messageId: 7,
    parts,
    language: 'ru',
    role: 'user',
  });

  it('shows the uploaded resume, how to replace it and the analysis limit', async () => {
    const { service, bot, ctx } = setup();
    await service.showResume(ctx);
    const [, text, options] = bot.sendToUser.mock.calls[0];
    expect(text).toContain('<b>cv.pdf</b>, загружено 2026-10-16');
    expect(text).toContain('Чтобы заменить, пришли сюда новый PDF');
    expect(text).toContain('до 3 за');
    expect(options.keyboard[0].map((b: { callbackData: string }) => b.callbackData)).toEqual(['p:card', 'p:setup']);
  });

  it('says where the paperclip is when there is no resume yet, even without a profile', async () => {
    const { service, bot, resumes, profiles } = setup();
    resumes.getActive.mockResolvedValue(null);
    profiles.get.mockResolvedValue(null);

    await expect(service.onCallback(press(['p', 'res']))).resolves.toEqual({});

    const [, text, options] = bot.sendToUser.mock.calls[0];
    expect(text).toContain('Резюме ещё не загружено');
    expect(text).toContain('📎');
    expect(text).toContain('✍️ Без резюме');
    const data = options.keyboard.map((row: { callbackData: string }[]) => row.map((b) => b.callbackData));
    expect(data).toEqual([['p:man'], ['p:setup']]);
  });

  it('walks a brand-new account through setup from step one', async () => {
    const { service, bot, resumes, profiles, ctx } = setup();
    resumes.getActive.mockResolvedValue(null);
    profiles.get.mockResolvedValue(null);

    await service.showSetup(ctx);

    const [, text, options] = bot.sendToUser.mock.calls[0];
    expect(text).toContain('1. ⬜ Резюме: пришли его сюда файлом PDF');
    expect(text).toContain('Первые шаги в JobRadar');
    expect(text).toContain('2. ⬜ Профиль: появится после резюме');
    const data = options.keyboard.flat().map((b: { callbackData: string }) => b.callbackData);
    expect(data).toEqual(['p:res', 'p:man', 's:open:flt', 's:menu']);
  });

  it('ticks the done steps and offers the first send once the profile is confirmed', async () => {
    const { service, bot, profiles } = setup();
    profiles.get.mockResolvedValue({ ...storedProfile, confirmedAt: new Date() });

    await expect(service.onCallback(press(['p', 'setup']))).resolves.toEqual({});

    const [, text, options] = bot.sendToUser.mock.calls[0];
    expect(text).toContain('1. ✅ Резюме: cv.pdf');
    expect(text).toContain('2. ✅ Профиль подтверждён');
    const data = options.keyboard.flat().map((b: { callbackData: string }) => b.callbackData);
    expect(data).toContain('p:card');
    expect(data.at(-1)).toBe('d:n');
  });
});

describe('CandidateBotService — without a resume (ADR-034)', () => {
  const press = (ctx: BotMessageContext, parts: string[]): BotCallbackContext => ({ ...ctx, messageId: 7, parts });
  const manualProfile: CandidateProfileRow = {
    ...storedProfile,
    resumeId: null,
    source: 'manual',
    promptVersion: 0,
    role: null,
    grade: null,
    years: null,
    skills: [],
    english: null,
  };

  it('starts with an empty manual profile and the role step, no file and no LLM', async () => {
    const { service, bot, llm, profiles, writes, ctx } = setup();
    profiles.get.mockResolvedValue(null);

    await service.startManual(ctx);

    expect(profiles.replace).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ source: 'manual', resumeId: null, promptVersion: 0, skills: [], evaluation: null }),
    );
    expect(llm.complete).not.toHaveBeenCalled();
    expect(writes[0]?.values).toMatchObject({ name: 'profile_manual_started' });
    const [, text, options] = bot.sendToUser.mock.calls[0];
    expect(text).toContain('Шаг 1 из 4');
    const data = options.keyboard.flat().map((b: { callbackData: string }) => b.callbackData);
    expect(data).toContain('p:wr:frontend');
    expect(data).not.toContain('p:card');
  });

  it('asks before replacing a profile read from a resume', async () => {
    const { service, bot, profiles, ctx } = setup();

    await service.startManual(ctx);

    expect(profiles.replace).not.toHaveBeenCalled();
    const [, text, options] = bot.sendToUser.mock.calls[0];
    expect(text).toContain('собран из резюме');
    expect(options.keyboard.flat().map((b: { callbackData: string }) => b.callbackData)).toEqual(['p:man:y', 'p:card']);

    const result = await service.onCallback(press(ctx, ['p', 'man', 'y']));
    expect(profiles.replace).toHaveBeenCalledWith('user-1', expect.objectContaining({ source: 'manual' }));
    expect(result).toEqual({ editKeyboard: null });
  });

  it('starts over at once when the current profile is already manual', async () => {
    const { service, profiles, ctx } = setup();
    profiles.get.mockResolvedValue(manualProfile);
    await service.onCallback(press(ctx, ['p', 'man']));
    expect(profiles.replace).toHaveBeenCalled();
  });

  it('walks role → grade → skills → English → the card', async () => {
    const { service, bot, dialogs, profiles, ctx } = setup();
    profiles.get.mockResolvedValue(manualProfile);

    const grade = await service.onCallback(press(ctx, ['p', 'wr', 'frontend']));
    expect(profiles.update).toHaveBeenCalledWith('user-1', { role: 'Frontend Developer' });
    expect(grade.editText).toContain('Шаг 2 из 4');
    expect(grade.editKeyboard?.flat().map((b) => b.callbackData)).toContain('p:wg:senior');

    const skills = await service.onCallback(press(ctx, ['p', 'wg', 'senior']));
    expect(profiles.update).toHaveBeenCalledWith('user-1', { grade: 'senior' });
    expect(dialogs.open).toHaveBeenCalledWith('555', expect.objectContaining({ flow: 'profile', step: 'wizard-skills' }));
    expect(skills).toEqual({ editText: expect.stringContaining('Шаг 3 из 4'), editKeyboard: null });

    await service.onSkillsText(ctx, 'React, TypeScript', 'wizard-skills');
    expect(dialogs.close).toHaveBeenCalledWith('555');
    const [, englishText, englishOptions] = bot.sendToUser.mock.calls.at(-1)!;
    expect(englishText).toContain('Шаг 4 из 4');
    const english = englishOptions.keyboard.flat().map((b: { callbackData: string }) => b.callbackData);
    expect(english).toEqual(expect.arrayContaining(['p:we:B2', 'p:we:-']));

    profiles.get.mockResolvedValue({
      ...manualProfile,
      role: 'Frontend Developer',
      grade: 'senior',
      skills: [{ name: 'React', weight: 'core' }],
      english: 'B2',
    });
    const card = await service.onCallback(press(ctx, ['p', 'we', 'B2']));
    expect(profiles.update).toHaveBeenCalledWith('user-1', { english: 'B2' });
    expect(card.editText).toContain('Твой профиль');
    expect(card.editText).toContain('Задан вручную, без резюме');
    const buttons = card.editKeyboard!.flat().map((b) => b.callbackData);
    expect(buttons[0]).toBe('p:ok');
    // Nothing to analyse again without a resume.
    expect(buttons).not.toContain('p:retry');
  });

  it('lets English be skipped, and ignores a role or grade off the list', async () => {
    const { service, profiles, ctx } = setup();
    profiles.get.mockResolvedValue(manualProfile);

    expect(await service.onCallback(press(ctx, ['p', 'wr', 'astronaut']))).toEqual({});
    expect(await service.onCallback(press(ctx, ['p', 'wg', 'guru']))).toEqual({});
    expect(profiles.update).not.toHaveBeenCalled();

    const card = await service.onCallback(press(ctx, ['p', 'we', '-']));
    expect(profiles.update).not.toHaveBeenCalled();
    expect(card.editText).toContain('Твой профиль');
  });

  it('does not re-analyse a manual profile', async () => {
    const { service, llm, profiles, ctx } = setup();
    profiles.get.mockResolvedValue(manualProfile);
    expect(await service.onCallback(press(ctx, ['p', 'retry']))).toEqual({});
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('marks the resume step done in /setup for a manual profile', async () => {
    const { service, bot, resumes, profiles, ctx } = setup();
    resumes.getActive.mockResolvedValue(null);
    profiles.get.mockResolvedValue({ ...manualProfile, confirmedAt: new Date() });

    await service.showSetup(ctx);

    const [, text, options] = bot.sendToUser.mock.calls[0];
    expect(text).toContain('1. ✅ Резюме: не нужно, профиль задан вручную');
    expect(text).toContain('2. ✅ Профиль подтверждён');
    expect(options.keyboard.flat().map((b: { callbackData: string }) => b.callbackData)).not.toContain('p:man');
  });
});
