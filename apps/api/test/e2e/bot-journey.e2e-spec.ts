import { eq, sql } from 'drizzle-orm';

import { OWNER_COMMANDS, PUBLIC_COMMANDS } from '../../src/bot/command-menu';
import { botMessage } from '../../src/bot/messages';
import { candidateProfiles, digestItems, digestSettings, sources, telegramAccounts, users, vacancies } from '../../src/db/schema';
import { DigestSendService, INSTANT_SETTLE_MINUTES } from '../../src/digest/digest-send.service';
import { ChatUser, type E2eApp, eventsNamed, startApp, waitFor } from './support/harness';
import { textPdf } from './support/pdf';

/**
 * The path a tester walks, end to end through the real app: sign up, upload a
 * resume, confirm the profile, get vacancies, open every menu command, leave
 * feedback, delete the account. Telegram is faked at the HTTP level, so every
 * message is also checked against what the real Bot API would reject.
 */

const OWNER_CHAT = 9_000_001;
const RESUME = textPdf([
  'Jane Tester',
  'Senior Frontend Engineer',
  'Minsk, Belarus. Open to remote work.',
  'Experience: 8 years building web applications with React, TypeScript, Next.js and Redux.',
  'Skills: React, TypeScript, JavaScript, Next.js, Redux Toolkit, TanStack Query, Tailwind CSS, Jest, Cypress.',
  'Senior Frontend Engineer at Acme SaaS, 2021-2026: led the React and TypeScript frontend.',
  'Frontend Developer at Web Studio, 2018-2021: Next.js storefronts, testing with Jest.',
]);

let e2e: E2eApp;

beforeAll(async () => {
  e2e = await startApp();
  // The author's account, so owner alerts and /feedback have somewhere to go.
  const [owner] = await e2e.db
    .insert(users)
    .values({ telegramUserId: String(OWNER_CHAT), role: 'owner', language: 'en' })
    .returning({ id: users.id });
  await e2e.db.insert(telegramAccounts).values({ userId: owner!.id, chatId: String(OWNER_CHAT), linkedAt: new Date() });
});

afterAll(async () => {
  await e2e?.close();
});

afterEach(() => {
  // Whatever a test did, Telegram must have accepted every call.
  expect(e2e.telegram.violations).toEqual([]);
});

async function seedVacancies(): Promise<void> {
  const [telegram] = await e2e.db.select({ id: sources.id }).from(sources).where(eq(sources.slug, 'dou'));
  const now = new Date();
  await e2e.db.insert(vacancies).values([
    {
      sourceId: telegram!.id,
      externalId: 'e2e-frontend',
      url: 'https://jobs.dou.ua/companies/acme/vacancies/1/',
      title: 'Senior Frontend Engineer (React, TypeScript)',
      companyRaw: 'Acme',
      companyNormalized: 'acme',
      description:
        'We are hiring a Senior Frontend Engineer. Stack: React, TypeScript, Next.js, Redux Toolkit, ' +
        'TanStack Query, Jest. Fully remote, B2B contract. ' +
        // Markup characters and a posting longer than one Telegram message:
        // the card must be escaped and split, or Telegram rejects it.
        'Our R&D <team> ships "fast" & safe. '.repeat(250),
      workFormat: 'remote',
      seniority: 'senior',
      salaryMin: 4000,
      salaryMax: 5500,
      salaryCurrency: 'USD',
      location: 'Remote',
      publishedAt: now,
      ingestedAt: now,
    },
    {
      sourceId: telegram!.id,
      externalId: 'e2e-accountant',
      url: 'https://jobs.dou.ua/companies/acme/vacancies/2/',
      title: 'Chief Accountant',
      companyRaw: 'Acme',
      companyNormalized: 'acme',
      description: 'Accounting, tax reports, 1C. Office in Kyiv.',
      workFormat: 'onsite',
      location: 'Kyiv',
      publishedAt: now,
      ingestedAt: now,
    },
  ]);
}

describe('webhook', () => {
  it('refuses an update without the secret header and accepts one with it', async () => {
    const update = { update_id: 1, message: { text: '/help', chat: { id: 1, type: 'private' }, from: { id: 1 } } };
    expect(await e2e.post(update, null)).toBe(401);
    expect(await e2e.post(update, 'wrong-secret')).toBe(401);
    expect(await e2e.post(update)).toBe(200);
  });

  it('answers 200 to an update it does not understand, so Telegram does not retry it', async () => {
    expect(await e2e.post({ update_id: 2 })).toBe(200);
    expect(await e2e.post({ update_id: 3, message: { text: 'hi', chat: { id: 5, type: 'group' } } })).toBe(200);
  });

  it('tells a stranger to press /start before anything else', async () => {
    const stranger = new ChatUser(e2e, 7_000_001, 'en');
    await stranger.say('hello');
    expect(stranger.last()?.text).toBe(botMessage('en', 'text.noAccount'));
  });
});

describe('a new tester, from /start to the first vacancy', () => {
  let user: ChatUser;
  let userId: string;

  beforeAll(() => {
    user = new ChatUser(e2e, 7_100_001, 'en', 'jane_tester');
  });

  it('signs up with a tagged /start link', async () => {
    await user.say('/start dou_chat');
    expect(user.last()?.text).toBe(botMessage('en', 'start.welcome'));

    const [row] = await e2e.db.select().from(users).where(eq(users.telegramUserId, String(user.id)));
    expect(row).toMatchObject({ role: 'user', language: 'en' });
    userId = row!.id;
    const starts = await eventsNamed(e2e.db, 'start');
    expect(starts.at(-1)).toMatchObject({ user_id: userId, props: { language: 'en', source: 'dou_chat' } });
  });

  it('does not create a second account on a repeated /start', async () => {
    await user.say('/start');
    expect(user.last()?.text).toBe(botMessage('en', 'link.already'));
    const { rows } = await e2e.db.execute(sql`select count(*)::int as n from users where telegram_user_id = ${String(user.id)}`);
    expect(rows[0]).toEqual({ n: 1 });
  });

  it('asks for a resume when there is nothing to match on yet', async () => {
    e2e.telegram.reset();
    await user.say('/digest');
    await waitFor(() => user.messages().length > 0, 'a reply to /digest');
    expect(user.messages()).toHaveLength(1);
  });

  it('refuses a file that is not a PDF', async () => {
    e2e.telegram.reset();
    await user.sendDocument('e2e-doc-txt', 'resume.docx', Buffer.from('not a pdf'), 'application/msword');
    expect(user.messages()).toHaveLength(1);
  });

  it('reads an uploaded PDF resume and shows the profile built from it', async () => {
    e2e.telegram.reset();
    await user.sendDocument('e2e-resume', 'jane-cv.pdf', RESUME);

    // The analysis runs after the webhook answered; its card carries the confirm button.
    const card = await waitFor(
      () => user.messages().find((m) => m.buttons.some((b) => b.callback_data === 'p:ok')),
      'the profile card',
    );
    expect(card.text).toMatch(/frontend/i);
    expect(card.text).toMatch(/react/i);
    expect(e2e.telegram.callsOf('getFile')).toHaveLength(1);

    const [profile] = await e2e.db.select().from(candidateProfiles).where(eq(candidateProfiles.userId, userId));
    expect(profile).toMatchObject({ source: 'fallback', confirmedAt: null });
    expect(profile!.skills.map((skill) => skill.name)).toEqual(expect.arrayContaining(['React', 'TypeScript']));
  });

  it('confirms the profile with the button', async () => {
    const card = user.messages().find((m) => m.buttons.some((b) => b.callback_data === 'p:ok'))!;
    e2e.telegram.reset();
    await user.press(card, 'p:ok');

    expect(e2e.telegram.callsOf('answerCallbackQuery')).toHaveLength(1);
    const edit = e2e.telegram.callsOf('editMessageText')[0];
    expect(edit?.body.message_id).toBe(card.messageId);
    const [profile] = await e2e.db.select().from(candidateProfiles).where(eq(candidateProfiles.userId, userId));
    expect(profile!.confirmedAt).toBeInstanceOf(Date);
  });

  it('sends the matching vacancy on /digest and leaves the unrelated one out', async () => {
    await seedVacancies();
    e2e.telegram.reset();
    await user.say('/digest');

    await user.waitForMessage(/Senior Frontend Engineer/);
    // The long posting arrives in parts; the Apply button rides on the last one.
    const card = await waitFor(() => user.messages().find((m) => m.buttons.some((b) => b.url)), 'the Apply button');
    expect(card.text).toContain('R&D <team> ships "fast" & safe.');
    const apply = card.buttons.find((b) => b.url);
    expect(apply?.url).toBe('https://jobs.dou.ua/companies/acme/vacancies/1/');
    await waitFor(async () => {
      const rows = await e2e.db.select().from(digestItems).where(eq(digestItems.userId, userId));
      return rows.length === 1;
    }, 'the digest item row');
    expect(user.messages().some((m) => /Accountant/.test(m.text))).toBe(false);
  });

  it('sends nothing twice: a second /digest says there is nothing new', async () => {
    e2e.telegram.reset();
    await user.say('/digest');
    await waitFor(() => user.messages().length > 0, 'a reply to the second /digest');
    expect(user.messages().some((m) => /Senior Frontend Engineer/.test(m.text))).toBe(false);
  });

  it('pushes a new matching vacancy on the scheduled run (instant mode)', async () => {
    const [dou] = await e2e.db.select({ id: sources.id }).from(sources).where(eq(sources.slug, 'dou'));
    const now = Date.now();
    // Equal quiet-hour bounds mean never quiet, whatever time CI runs at; the
    // watermark sits before the new vacancy, which is past the settle delay.
    await e2e.db
      .update(digestSettings)
      .set({ quietStart: '00:00', quietEnd: '00:00', judgedThrough: new Date(now - 60 * 60_000).toISOString() })
      .where(eq(digestSettings.userId, userId));
    await e2e.db.insert(vacancies).values({
      sourceId: dou!.id,
      externalId: 'e2e-frontend-2',
      url: 'https://jobs.dou.ua/companies/beta/vacancies/3/',
      title: 'Senior React Developer',
      companyRaw: 'Beta',
      companyNormalized: 'beta',
      description: 'React, TypeScript, Next.js. Remote across Europe.',
      workFormat: 'remote',
      seniority: 'senior',
      location: 'Remote',
      publishedAt: new Date(now - 20 * 60_000),
      ingestedAt: new Date(now - (INSTANT_SETTLE_MINUTES + 10) * 60_000),
    });
    e2e.telegram.reset();

    const result = await e2e.app.get(DigestSendService).run(new Date(now));

    expect(result.instant).toBeGreaterThanOrEqual(1);
    await user.waitForMessage(/Senior React Developer/);
    const [settings] = await e2e.db.select().from(digestSettings).where(eq(digestSettings.userId, userId));
    expect(new Date(settings!.judgedThrough!).getTime()).toBeGreaterThan(now - 60 * 60_000);
  });

  it('answers every command in the menu without an error', async () => {
    const errorsBefore = (await eventsNamed(e2e.db, 'error')).length;
    const skip = new Set(['start', 'delete', 'stop']);
    for (const [command] of PUBLIC_COMMANDS) {
      if (skip.has(command)) continue;
      e2e.telegram.reset();
      await user.say(`/${command}`);
      await waitFor(() => user.messages().length > 0, `a reply to /${command}`);
      expect(user.messages().every((m) => m.text !== botMessage('en', 'unknown'))).toBe(true);
    }
    expect(await eventsNamed(e2e.db, 'error')).toHaveLength(errorsBefore);
  });

  it('refuses the author tools to a regular user', async () => {
    for (const [command] of OWNER_COMMANDS) {
      e2e.telegram.reset();
      await user.say(`/${command}`);
      const reply = await waitFor(() => user.messages()[0], `a reply to /${command}`);
      // Each tool says it is the author's, or (/testmode) pretends not to exist.
      expect(reply.text).toMatch(/author only|only to the author|Unknown command/);
      expect(reply.buttons).toEqual([]);
    }
  });

  it('forwards /feedback to the author', async () => {
    e2e.telegram.reset();
    await user.say('/feedback The location filter is great');
    const owner = new ChatUser(e2e, OWNER_CHAT, 'en');
    await owner.waitForMessage(/The location filter is great/);
    expect(user.messages()).toHaveLength(1);
    const feedback = await eventsNamed(e2e.db, 'feedback');
    expect(feedback.at(-1)).toMatchObject({ user_id: userId, props: { length: 28 } });
  });

  it('opens /settings and /filters with working buttons', async () => {
    for (const command of ['settings', 'filters']) {
      e2e.telegram.reset();
      await user.say(`/${command}`);
      const screen = await waitFor(() => user.messages().find((m) => m.buttons.length > 0), `the /${command} screen`);
      const button = screen.buttons.find((b) => b.callback_data)!;
      e2e.telegram.reset();
      await user.press(screen, button.callback_data!);
      expect(e2e.telegram.callsOf('answerCallbackQuery')).toHaveLength(1);
      expect(e2e.telegram.callsOf('answerCallbackQuery')[0]?.body.text).not.toBe(botMessage('en', 'callback.failed'));
    }
  });

  it('deletes the account and everything in it after a confirmation', async () => {
    e2e.telegram.reset();
    await user.say('/delete');
    const prompt = user.last()!;
    expect(prompt.text).toBe(botMessage('en', 'delete.confirm'));
    await user.press(prompt, 'u:del:y');

    expect(user.last()?.text).toBe(botMessage('en', 'delete.done'));
    expect(await e2e.db.select().from(users).where(eq(users.id, userId))).toEqual([]);
    expect(await e2e.db.select().from(candidateProfiles).where(eq(candidateProfiles.userId, userId))).toEqual([]);
  });
});

describe('a Russian-speaking tester', () => {
  it('gets the Russian interface from the Telegram client language', async () => {
    const user = new ChatUser(e2e, 7_200_001, 'ru');
    await user.say('/start');
    expect(user.last()?.text).toBe(botMessage('ru', 'start.welcome'));
    await user.say('/help');
    expect(user.last()?.text).toBe(botMessage('ru', 'help'));
  });
});

describe('error alerts', () => {
  it('a failing update reaches the author and is counted, while the webhook still answers 200', async () => {
    const user = new ChatUser(e2e, 7_300_001, 'en');
    await user.say('/start');
    // Break the next query of the resume screen by dropping the table it reads.
    await e2e.db.execute(sql`alter table resumes rename to resumes_e2e_broken`);
    try {
      e2e.telegram.reset();
      await user.say('/resume');
      const owner = new ChatUser(e2e, OWNER_CHAT, 'en');
      await owner.waitForMessage(/Bot error: \/resume/);
      const errors = await eventsNamed(e2e.db, 'error');
      expect(errors.at(-1)?.props).toMatchObject({ where: '/resume' });
    } finally {
      await e2e.db.execute(sql`alter table resumes_e2e_broken rename to resumes`);
    }
  });
});

describe('the author walks the new-user flow with /testmode', () => {
  it('signs up a fresh account on the first /start, and comes back after /delete', async () => {
    const owner = new ChatUser(e2e, OWNER_CHAT, 'en');
    const [ownerRow] = await e2e.db.select().from(users).where(eq(users.role, 'owner'));

    e2e.telegram.reset();
    await owner.say('/testmode');
    await owner.press(owner.last()!, 'u:test:y');
    expect(owner.last()?.text).toBe(botMessage('en', 'testmode.on'));

    // The first /start is the test sign-up, not the way back.
    e2e.telegram.reset();
    await owner.say('/start');
    expect(owner.last()?.text).toBe(botMessage('en', 'start.welcome'));
    const [testAccount] = await e2e.db.select().from(users).where(eq(users.telegramUserId, String(OWNER_CHAT)));
    expect(testAccount).toMatchObject({ role: 'user' });
    expect(testAccount!.id).not.toBe(ownerRow!.id);

    // A test account is an ordinary user: the author tools are refused.
    e2e.telegram.reset();
    await owner.say('/stats');
    await owner.waitForMessage(/author only/);

    e2e.telegram.reset();
    await owner.say('/delete');
    await owner.press(owner.last()!, 'u:del:y');
    await owner.say('/start');
    expect(owner.last()?.text).toBe(botMessage('en', 'testmode.off'));
    const [back] = await e2e.db.select().from(users).where(eq(users.telegramUserId, String(OWNER_CHAT)));
    expect(back).toMatchObject({ id: ownerRow!.id, role: 'owner' });
  });
});
