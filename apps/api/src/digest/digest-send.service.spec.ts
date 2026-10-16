import { SQL } from "drizzle-orm";
import type { BotCallbackContext } from "../bot/bot.service";
import {
  candidateProfiles,
  digestItems,
  digestSettings,
  hiddenVacancies,
  profileMatches,
  resumes,
  vacancies,
  vacancyRecipients,
} from "../db/schema";
import {
  DigestSendService,
  INSTANT_SETTLE_MINUTES,
  ownerOnlySource,
  profileTerms,
} from "./digest-send.service";

/**
 * Fake drizzle: a query is keyed by the table its `from()` names, so the join
 * chain can be ignored; reads come from a per-table queue and writes are
 * recorded. Everything resolves lazily so one `from()` consumes one response.
 */
function makeDb(defaults: [unknown, unknown[]][] = []) {
  const queues = new Map<unknown, unknown[][]>();
  /** What a table answers once its queue is empty. */
  const fallback = new Map<unknown, unknown[]>(defaults);
  const writes: { kind: string; table: unknown; values?: unknown }[] = [];
  /** Every `where()` argument of a read, by the table its `from()` names. */
  const wheres: { table: unknown; condition: unknown }[] = [];

  const chain = () => {
    let table: unknown;
    let rows: unknown[] | undefined;
    const resolve = () => (rows ??= queues.get(table)?.shift() ?? fallback.get(table) ?? []);
    const proxy: Record<string, unknown> = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (
              ok: (r: unknown[]) => unknown,
              err?: (e: unknown) => unknown,
            ) => Promise.resolve(resolve()).then(ok, err);
          }
          return (arg: unknown) => {
            if (prop === "from" && table === undefined) table = arg;
            if (prop === "where") wheres.push({ table, condition: arg });
            return proxy;
          };
        },
      },
    );
    return proxy;
  };

  const db = {
    select: () => chain(),
    selectDistinctOn: () => chain(),
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        onConflictDoNothing: () => {
          writes.push({ kind: "insert", table, values });
          const done = Promise.resolve();
          return Object.assign(done, {
            returning: () => Promise.resolve([values]),
          });
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: () => {
          writes.push({ kind: "update", table, values });
          return Promise.resolve();
        },
      }),
    }),
  };

  return {
    db: db as never,
    writes,
    wheres,
    queue: (table: unknown, ...responses: unknown[][]) =>
      queues.set(table, responses),
  };
}

/**
 * Whether a drizzle condition embeds `needle`. Walks SQL chunks only: the
 * fake's subqueries are proxies and must not be rendered.
 */
function containsSql(node: unknown, needle: unknown, seen = new Set<unknown>()): boolean {
  if (node === needle) return true;
  if (!(node instanceof SQL) || seen.has(node)) return false;
  seen.add(node);
  return node.queryChunks.some((chunk) => containsSql(chunk, needle, seen));
}

const makeBot = () => ({
  isConfigured: () => true,
  sendToUser: jest.fn().mockResolvedValue("900"),
  registerCallback: jest.fn(),
  registerCommand: jest.fn(),
});

/**
 * The owner's stored candidate profile. It is never confirmed: the owner did
 * not go through the bot's dialog, and the formula takes it anyway (ADR-029).
 */
const ownerProfile = {
  role: "Frontend Developer",
  grade: "senior",
  skills: [
    { name: "React", weight: "core" },
    { name: "TypeScript", weight: "core" },
  ],
  weights: { skills: {}, companies: {} },
  confirmedAt: null,
};

/** A fake DB where every candidate-profile read finds the owner's profile. */
const ownerDb = () => makeDb([[candidateProfiles, [ownerProfile]]]);

/**
 * Formula scores against `ownerProfile`: the default row is a perfect match
 * (100), React alone scores 86, a Go backend role 25.
 */
const PARTIAL = { description: "React" };
const OFF_STACK = { title: "Senior Backend Engineer", description: "Go, Kafka" };

/** The owner, with no /settings preferences — the path every pre-5.3 test is about. */
const ownerDefaults = {
  role: "owner",
  workFormats: [],
  employmentTypes: [],
  minSalaryUsd: null,
  mutedSources: [],
};

const settingsRow = (over: Record<string, unknown> = {}) => ({
  userId: "user-1",
  maxItems: 10,
  minScore: 60,
  timezone: "UTC",
  language: "ru",
  ...ownerDefaults,
  ...over,
});

/** One row as the candidate query returns it: no rules score, that is a separate read. */
const vacancyRow = (over: Record<string, unknown> = {}) => ({
  id: "vac-1",
  title: "Senior Frontend Engineer",
  company: "Acme",
  description: "React, TypeScript",
  location: "Remote",
  seniority: "senior",
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  url: "https://acme.test/1",
  publishedAt: new Date("2026-08-10T00:00:00Z"),
  resumeScore: null,
  // Raw weighted sum as Postgres computes it for the ordering; 0 = the résumé
  // and the posting have no word in common.
  lexScore: 0,
  ...over,
});

/** What `ruleScores()` reads: best profile-match score per vacancy. */
const ruleRow = (vacancyId: string, score: number) => ({ vacancyId, score });

const makeApplications = () => ({
  markApplied: jest.fn().mockResolvedValue({
    item: { id: "app-1", stage: "applied", vacancy: { url: "https://acme.test/1" } },
    outcome: "created",
  }),
});

const service = (
  db: never,
  bot: ReturnType<typeof makeBot>,
  applications: ReturnType<typeof makeApplications> = makeApplications(),
) => new DigestSendService(db, bot as never, applications as never);

describe("DigestSendService.sendNow", () => {
  it("says so plainly when there is nothing to send", async () => {
    const { db, queue, writes } = ownerDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, []);
    const bot = makeBot();

    await expect(service(db, bot).sendNow("user-1")).resolves.toBe(0);

    expect(bot.sendToUser).toHaveBeenCalledTimes(1);
    expect(bot.sendToUser.mock.calls[0][1]).toContain("Сегодня ничего стоящего");
    expect(writes).toHaveLength(0);
  });

  it("scores the owner by the formula and sends a card per pick (ADR-029)", async () => {
    const { db, queue, writes } = ownerDb();
    queue(digestSettings, [settingsRow({ language: "en" })]);
    queue(vacancies, [vacancyRow({ id: "fit" }), vacancyRow({ id: "backend", ...OFF_STACK })]);
    // A rules score no longer decides anything: the formula reads the posting.
    queue(profileMatches, [ruleRow("backend", 0.99)]);
    const bot = makeBot();

    await expect(
      service(db, bot).sendNow("user-1", new Date("2026-08-10T12:00:00Z")),
    ).resolves.toBe(1);

    // Header + one card; the off-stack role is below the floor and never sent.
    expect(bot.sendToUser).toHaveBeenCalledTimes(2);
    expect(bot.sendToUser.mock.calls[1][1]).toContain("100%");
    expect(bot.sendToUser.mock.calls[1][1]).toContain("Matched: React, TypeScript");
    expect(writes[0]?.values).toMatchObject({ vacancyId: "fit", score: 100 });
  });

  it("falls back to the resume's terms when the owner has no stored profile", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow()]);
    queue(resumes, [{ id: "res-1", text: "Senior Frontend Developer. React, TypeScript" }]);
    queue(vacancies, [vacancyRow({ id: "fit" }), vacancyRow({ id: "backend", ...OFF_STACK })]);
    const bot = makeBot();

    await expect(service(db, bot).sendNow("user-1")).resolves.toBe(1);
    expect(writes[0]?.values).toMatchObject({ vacancyId: "fit" });
  });

  it("sends nothing to an owner with neither a profile nor a resume", async () => {
    const { db, queue } = makeDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, [vacancyRow()]);
    const bot = makeBot();

    await expect(service(db, bot).sendNow("user-1")).resolves.toBe(0);
    expect(bot.sendToUser).not.toHaveBeenCalled();
  });

  it("sends a long posting as several messages, with the buttons on the last", async () => {
    const { db, queue, writes } = ownerDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, [vacancyRow({ description: `React, TypeScript ${"слово ".repeat(1000)}` })]);
    const bot = makeBot();
    bot.sendToUser
      .mockResolvedValueOnce("900")
      .mockResolvedValueOnce("901")
      .mockResolvedValue("902");

    await expect(service(db, bot).sendNow("user-1")).resolves.toBe(1);

    // Header + two card parts: the posting does not fit one Telegram message.
    expect(bot.sendToUser).toHaveBeenCalledTimes(3);
    expect(bot.sendToUser.mock.calls[1][2].keyboard).toBeUndefined();
    expect(bot.sendToUser.mock.calls[2][2].keyboard).toBeDefined();
    // The remembered message is the one carrying the buttons — callbacks come
    // back to edit exactly that one.
    expect(writes[0]?.values).toMatchObject({
      vacancyId: "vac-1",
      messageId: "902",
    });
  });

  it("records a sent vacancy even when Telegram refused it, so it never returns", async () => {
    const { db, queue, writes } = ownerDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, [vacancyRow()]);
    const bot = makeBot();
    bot.sendToUser.mockResolvedValue(null);

    await service(db, bot).sendNow("user-1");

    expect(writes.filter((w) => w.table === digestItems)).toHaveLength(1);
  });

  it("respects the per-send cap, best first", async () => {
    const { db, queue, writes } = ownerDb();
    queue(digestSettings, [settingsRow({ maxItems: 2, minScore: 0 })]);
    queue(vacancies, [
      vacancyRow({ id: "weak", ...OFF_STACK }),
      vacancyRow({ id: "partial", ...PARTIAL }),
      vacancyRow({ id: "best" }),
    ]);
    const bot = makeBot();

    await expect(service(db, bot).sendNow("user-1")).resolves.toBe(2);
    const sent = writes
      .filter((w) => w.table === digestItems)
      .map((w) => (w.values as { vacancyId: string }).vacancyId);
    expect(sent).toEqual(["best", "partial"]);
  });

  it("sends every match above the floor when there is no cap (ADR-022)", async () => {
    const { db, queue, writes } = ownerDb();
    queue(digestSettings, [settingsRow({ maxItems: null, minScore: 0 })]);
    const ids = Array.from({ length: 40 }, (_, i) => `v${i}`);
    queue(vacancies, ids.map((id) => vacancyRow({ id })));
    const bot = makeBot();

    await expect(service(db, bot).sendNow("user-1")).resolves.toBe(40);
    expect(writes.filter((w) => w.table === digestItems)).toHaveLength(40);
  });

  it("does nothing for a user with no settings row", async () => {
    const { db, queue } = ownerDb();
    queue(digestSettings, []);
    const bot = makeBot();

    await expect(service(db, bot).sendNow("user-1")).resolves.toBe(0);
    expect(bot.sendToUser).not.toHaveBeenCalled();
  });
});

describe("DigestSendService.run", () => {
  const scheduled = (over: Record<string, unknown> = {}) => ({
    userId: "user-1",
    enabled: true,
    sendTimes: ["09:00"],
    maxItems: 10,
    minScore: 60,
    lastSentKey: null,
    timezone: "UTC",
    language: "ru",
    ...ownerDefaults,
    ...over,
  });

  it("does nothing before a slot comes round", async () => {
    const { db, queue, writes } = ownerDb();
    queue(digestSettings, [scheduled()]);
    const bot = makeBot();

    await expect(
      service(db, bot).run(new Date("2026-08-11T08:00:00Z")),
    ).resolves.toMatchObject({ sent: 0, skipped: 0 });
    expect(bot.sendToUser).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it("sends the due slot and consumes it exactly once", async () => {
    const { db, queue, writes } = ownerDb();
    queue(digestSettings, [scheduled()]);
    queue(vacancies, []);
    const bot = makeBot();

    const result = await service(db, bot).run(
      new Date("2026-08-11T09:01:00Z"),
    );

    expect(result).toMatchObject({ users: 1, sent: 1 });
    expect(
      writes.find((w) => w.table === digestSettings)?.values,
    ).toMatchObject({
      lastSentKey: "2026-08-11 09:00",
    });
  });

  it("reports only what arrived since the previous send and moves the watermark (ADR-022)", async () => {
    const { db, queue, writes } = ownerDb();
    queue(digestSettings, [scheduled({ maxItems: null, minScore: 0 })]);
    const window = {
      after: "2026-08-10 09:00:00.100001+00",
      until: "2026-08-11 08:50:00.200002+00",
    };
    queue(
      vacancies,
      [window],
      ["a", "b", "c"].map((id) => vacancyRow({ id })),
    );
    const bot = makeBot();

    const result = await service(db, bot).run(
      new Date("2026-08-11T09:01:00Z"),
    );

    expect(result).toMatchObject({ sent: 1, vacancies: 3 });
    expect(bot.sendToUser.mock.calls[0][1]).toContain("3");
    const slot = writes.find((w) => w.table === digestSettings)?.values;
    expect(slot).toMatchObject({ lastSentKey: "2026-08-11 09:00" });
    expect(slot).toHaveProperty("judgedThrough");
  });

  it("says nothing is new when no vacancy arrived since the previous send", async () => {
    const { db, queue, writes } = ownerDb();
    queue(digestSettings, [scheduled({ judgedThrough: "2026-08-11 08:00:00+00" })]);
    queue(vacancies, [{ after: "2026-08-11 08:00:00+00", until: null }]);
    const bot = makeBot();

    const result = await service(db, bot).run(
      new Date("2026-08-11T09:01:00Z"),
    );

    expect(result).toMatchObject({ sent: 1, vacancies: 0 });
    expect(bot.sendToUser).toHaveBeenCalledTimes(1);
    const slot = writes.find((w) => w.table === digestSettings)?.values;
    expect(slot).toMatchObject({ lastSentKey: "2026-08-11 09:00" });
    expect(slot).not.toHaveProperty("judgedThrough");
  });

  it("consumes a long-elapsed slot without sending a morning digest at night", async () => {
    const { db, queue, writes } = ownerDb();
    queue(digestSettings, [scheduled()]);
    const bot = makeBot();

    const result = await service(db, bot).run(
      new Date("2026-08-11T22:00:00Z"),
    );

    expect(result).toMatchObject({ sent: 0, skipped: 1 });
    expect(bot.sendToUser).not.toHaveBeenCalled();
    expect(writes[0]?.values).toMatchObject({
      lastSentKey: "2026-08-11 09:00",
    });
  });

  it("keeps going when one user run throws", async () => {
    const { db, queue } = ownerDb();
    queue(digestSettings, [
      scheduled({ userId: "bad" }),
      scheduled({ userId: "good" }),
    ]);
    // Only one candidate response is queued, so the second user reads an empty
    // list — the point is that the loop reaches them at all.
    queue(vacancies, []);
    const bot = makeBot();
    bot.sendToUser.mockRejectedValueOnce(new Error("boom"));

    const result = await service(db, bot).run(
      new Date("2026-08-11T09:01:00Z"),
    );

    expect(result.users).toBe(2);
    expect(result.sent).toBe(1);
  });
});

describe("DigestSendService.run — instant mode (ADR-020)", () => {
  const WINDOW = {
    after: "2026-08-11 08:00:00.100001+00",
    until: "2026-08-11 11:50:00.200002+00",
  };

  const instant = (over: Record<string, unknown> = {}) => ({
    userId: "user-1",
    enabled: true,
    sendTimes: ["09:00"],
    maxItems: 10,
    minScore: 60,
    lastSentKey: null,
    mode: "instant",
    quietStart: "22:00",
    quietEnd: "08:00",
    instantMinScore: 75,
    judgedThrough: WINDOW.after,
    timezone: "UTC",
    language: "ru",
    ...ownerDefaults,
    ...over,
  });

  const NOON = new Date("2026-08-11T12:00:00Z");

  it("holds its fire during quiet hours, without touching the board or the watermark", async () => {
    const { db, queue, writes } = ownerDb();
    queue(digestSettings, [instant()]);
    queue(vacancies, [WINDOW], [vacancyRow()]);
    const bot = makeBot();

    const result = await service(db, bot).run(
      new Date("2026-08-11T23:30:00Z"),
    );

    expect(result).toMatchObject({ instant: 0, vacancies: 0 });
    expect(bot.sendToUser).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it("does nothing when no settled vacancy arrived past the watermark", async () => {
    const { db, queue, writes } = ownerDb();
    queue(digestSettings, [instant()]);
    queue(vacancies, [{ after: WINDOW.after, until: null }]);
    const bot = makeBot();

    const result = await service(db, bot).run(NOON);

    expect(result.instant).toBe(0);
    expect(bot.sendToUser).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it("pushes the new matches under an instant header and moves the watermark", async () => {
    const { db, queue, writes } = ownerDb();
    queue(digestSettings, [instant()]);
    queue(vacancies, [WINDOW], [vacancyRow({ id: "fresh" })]);
    const bot = makeBot();

    const result = await service(db, bot).run(NOON);

    expect(result).toMatchObject({ instant: 1, vacancies: 1, sent: 0 });
    expect(bot.sendToUser.mock.calls[0][1]).toContain("Свежее: одна вакансия");
    expect(writes.find((w) => w.table === digestItems)?.values).toMatchObject({
      vacancyId: "fresh",
      slotKey: `instant ${WINDOW.until}`,
    });
    const watermark = writes.find((w) => w.table === digestSettings);
    expect(watermark?.values).toHaveProperty("judgedThrough");
  });

  it("judges by the stricter instant floor, not the scheduled one", async () => {
    const { db, queue, writes } = ownerDb();
    // 86% clears the scheduled floor of 60 but not an instant floor of 90.
    queue(digestSettings, [instant({ instantMinScore: 90 })]);
    queue(vacancies, [WINDOW], [vacancyRow({ id: "decent", ...PARTIAL })]);
    const bot = makeBot();

    await service(db, bot).run(NOON);

    expect(writes.filter((w) => w.table === digestItems)).toHaveLength(0);
  });

  it("stays silent when nothing clears the floor, yet still moves the watermark", async () => {
    const { db, queue, writes } = ownerDb();
    queue(digestSettings, [instant()]);
    queue(vacancies, [WINDOW], [vacancyRow({ id: "weak", ...OFF_STACK })]);
    const bot = makeBot();

    const result = await service(db, bot).run(NOON);

    // No "nothing worth your attention" several times a day.
    expect(bot.sendToUser).not.toHaveBeenCalled();
    expect(result).toMatchObject({ instant: 1, vacancies: 0 });
    // Judged once is judged: the same window is not scored again next tick.
    expect(writes.map((w) => w.table)).toEqual([digestSettings]);
  });

  it("stays silent when every new vacancy was already sent or hidden", async () => {
    const { db, queue, writes } = ownerDb();
    queue(digestSettings, [instant()]);
    queue(vacancies, [WINDOW], []);
    const bot = makeBot();

    await service(db, bot).run(NOON);

    expect(bot.sendToUser).not.toHaveBeenCalled();
    expect(writes.map((w) => w.table)).toEqual([digestSettings]);
  });

  it("ignores the send times: a due slot does not produce a scheduled digest", async () => {
    const { db, queue, writes } = ownerDb();
    queue(digestSettings, [instant({ sendTimes: ["11:59"] })]);
    queue(vacancies, [{ after: WINDOW.after, until: null }]);
    const bot = makeBot();

    const result = await service(db, bot).run(NOON);

    expect(result.sent).toBe(0);
    expect(writes).toHaveLength(0);
  });
});

describe("DigestSendService buttons", () => {
  const ctx = (parts: string[]): BotCallbackContext => ({
    userId: "user-1",
    chatId: "555",
    messageId: 77,
    parts,
    role: "owner",
    language: "ru",
  });

  const handlerFor = (db: never, bot: ReturnType<typeof makeBot>) => {
    const instance = service(db, bot);
    instance.onModuleInit();
    return bot.registerCallback.mock.calls[0][1] as (
      c: BotCallbackContext,
    ) => Promise<{ alert?: string; editKeyboard?: unknown }>;
  };

  it("registers under the digest namespace", () => {
    const { db } = makeDb();
    const bot = makeBot();
    handlerFor(db, bot);
    expect(bot.registerCallback).toHaveBeenCalledWith(
      "d",
      expect.any(Function),
    );
    expect(bot.registerCommand).toHaveBeenCalledWith("digest", expect.any(Function));
  });

  it("answers the send-now button at once and sends the cards after", async () => {
    const { db, queue, writes } = ownerDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, [vacancyRow({ id: "fit" })]);
    const bot = makeBot();

    const result = await handlerFor(db, bot)(ctx(["d", "n"]));

    expect(result).toEqual({ alert: "Ищу вакансии…" });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(writes.find((w) => w.table === digestItems)?.values).toMatchObject({
      vacancyId: "fit",
    });
  });


  it("hides a vacancy and rewrites its card", async () => {
    const { db, writes } = makeDb();
    const bot = makeBot();
    const result = await handlerFor(db, bot)(ctx(["d", "h", "vac-1"]));

    expect(writes[0]).toMatchObject({
      kind: "insert",
      table: hiddenVacancies,
      values: { userId: "user-1", vacancyId: "vac-1" },
    });
    expect(result.editKeyboard).toBeNull();
  });

  it("records both thumbs against the digest item", async () => {
    const { db, writes } = makeDb();
    const bot = makeBot();
    const handler = handlerFor(db, bot);

    await handler(ctx(["d", "u", "vac-1"]));
    await handler(ctx(["d", "w", "vac-2"]));

    expect(writes[0]).toMatchObject({
      table: digestItems,
      values: { feedback: 1 },
    });
    expect(writes[1]).toMatchObject({
      table: digestItems,
      values: { feedback: -1 },
    });
  });

  it("puts the vacancy on the applications and swaps only the button (roadmap 5.5)", async () => {
    const { db, writes } = makeDb();
    const bot = makeBot();
    const applications = makeApplications();
    const instance = service(db, bot, applications);
    instance.onModuleInit();
    const handler = bot.registerCallback.mock.calls[0][1] as (
      c: BotCallbackContext,
    ) => Promise<{ alert?: string; editText?: string; editKeyboard?: unknown }>;

    const result = await handler(ctx(["d", "a", "vac-1"]));

    expect(applications.markApplied).toHaveBeenCalledWith("user-1", "vac-1");
    expect(result.alert).toBe("Добавлено в отклики — /applications");
    // The card text is left as sent; only the keyboard changes.
    expect(result.editText).toBeUndefined();
    expect(result.editKeyboard).toEqual([
      [
        { text: "Откликнуться", url: "https://acme.test/1" },
        { text: "✅ В откликах", callbackData: "d:a:vac-1" },
      ],
    ]);
    expect(writes).toHaveLength(0);
  });

  it("answers a repeated press the same way, without moving a later stage back", async () => {
    const { db } = makeDb();
    const bot = makeBot();
    const applications = makeApplications();
    applications.markApplied.mockResolvedValue({
      item: { id: "app-1", stage: "offer", vacancy: { url: "" } },
      outcome: "kept",
    });
    service(db, bot, applications).onModuleInit();
    const handler = bot.registerCallback.mock.calls[0][1] as (
      c: BotCallbackContext,
    ) => Promise<{ alert?: string; editKeyboard?: unknown }>;

    const result = await handler(ctx(["d", "a", "vac-1"]));

    expect(result.alert).toBe("Добавлено в отклики — /applications");
    // No link on the posting: the state button stays on its own.
    expect(result.editKeyboard).toEqual([
      [{ text: "✅ В откликах", callbackData: "d:a:vac-1" }],
    ]);
  });

  it("ignores malformed callback data", async () => {
    const { db, writes } = makeDb();
    const bot = makeBot();
    await handlerFor(db, bot)(ctx(["d"]));
    expect(writes).toHaveLength(0);
  });
});

describe("DigestSendService.sendOnRequest (/digest, the send-now button)", () => {
  it("sends every unsent match, like the web's manual send", async () => {
    const { db, queue, writes } = ownerDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, [vacancyRow({ id: "fit" }), vacancyRow({ id: "backend", ...OFF_STACK })]);
    const bot = makeBot();

    await expect(service(db, bot).sendOnRequest("user-1", "owner", "ru")).resolves.toBe(1);
    expect(writes.filter((w) => w.table === digestItems)).toHaveLength(1);
  });

  it("says nothing new clears the floor instead of the scheduled digest's line", async () => {
    const { db, queue } = ownerDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, [vacancyRow({ id: "backend", ...OFF_STACK })]);
    const bot = makeBot();

    await expect(service(db, bot).sendOnRequest("user-1", "owner", "ru")).resolves.toBe(0);
    expect(bot.sendToUser).toHaveBeenCalledTimes(1);
    expect(bot.sendToUser.mock.calls[0][1]).toContain("Ничего нового выше твоего минимального соответствия");
  });

  it("asks for a resume when there is nothing to match on yet", async () => {
    const { db, queue } = makeDb();
    queue(candidateProfiles, [{ role: null, grade: null, skills: [], weights: {}, confirmedAt: null }]);
    const bot = makeBot();

    await expect(service(db, bot).sendOnRequest("user-1", "user", "en")).resolves.toBe(0);
    expect(bot.sendToUser).toHaveBeenCalledWith(
      "user-1",
      "Nothing to match on yet: send your resume as a PDF and confirm the profile.",
    );
  });
});

describe("instant settle delay (ADR-023)", () => {
  it("waits five minutes, half the 10-minute ingestion tick", () => {
    expect(INSTANT_SETTLE_MINUTES).toBe(5);
  });
});

describe("DigestSendService — formula for non-owners (ADR-025 §8)", () => {
  const profileRow = (over: Record<string, unknown> = {}) => ({
    role: "Frontend Developer",
    grade: "senior",
    skills: [
      { name: "React", weight: "core" },
      { name: "TypeScript", weight: "core" },
    ],
    weights: { skills: {}, companies: {} },
    confirmedAt: new Date("2026-10-01T00:00:00Z"),
    ...over,
  });
  const userRow = (over: Record<string, unknown> = {}) =>
    settingsRow({ role: "user", maxItems: null, minScore: 60, ...over });
  const NOW = new Date("2026-08-10T12:00:00Z");

  it("scores by the formula with a template note", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [userRow({ language: "en" })]);
    queue(candidateProfiles, [profileRow()]);
    queue(vacancies, [
      vacancyRow({ id: "fit", description: "React, TypeScript, GraphQL" }),
      vacancyRow({ id: "backend", title: "Senior Backend Engineer", description: "Go, Kafka" }),
    ]);
    const bot = makeBot();

    await expect(service(db, bot).sendNow("user-1", NOW)).resolves.toBe(1);

    const sent = writes.filter((w) => w.table === digestItems);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.values).toMatchObject({ vacancyId: "fit" });
    const card = bot.sendToUser.mock.calls[1][1] as string;
    expect(card).toContain("Matched: React, TypeScript; missing: GraphQL; grade: Senior ✓");
  });

  it("never offers a non-owner the owner's own sources", async () => {
    const { db, queue, wheres } = makeDb();
    queue(digestSettings, [userRow()]);
    queue(candidateProfiles, [profileRow()]);
    queue(vacancies, []);

    await service(db, makeBot()).sendNow("user-1", NOW);

    const condition = wheres.find((w) => w.table === vacancies)?.condition;
    expect(containsSql(condition, ownerOnlySource)).toBe(true);
  });

  it("lets through owner-only vacancies addressed to this user (ADR-027)", async () => {
    const { db, queue, wheres } = makeDb();
    queue(digestSettings, [userRow()]);
    queue(candidateProfiles, [profileRow()]);
    queue(vacancies, []);

    await service(db, makeBot()).sendNow("user-1", NOW);

    const condition = wheres.find((w) => w.table === vacancies)?.condition;
    expect(containsSql(condition, vacancyRecipients)).toBe(true);
    expect(containsSql(condition, "user-1")).toBe(true);
  });

  it("keeps the owner's own sources for the owner", async () => {
    const { db, queue, wheres } = ownerDb();
    queue(digestSettings, [settingsRow({ minScore: 0 })]);
    queue(vacancies, []);

    await service(db, makeBot()).sendNow("user-1", NOW);

    const condition = wheres.find((w) => w.table === vacancies)?.condition;
    expect(condition).toBeDefined();
    expect(containsSql(condition, ownerOnlySource)).toBe(false);
    expect(containsSql(condition, vacancyRecipients)).toBe(false);
  });

  it("sends nothing until the profile is confirmed", async () => {
    const { db, queue } = makeDb();
    queue(digestSettings, [userRow()]);
    queue(candidateProfiles, [profileRow({ confirmedAt: null })]);
    queue(vacancies, [vacancyRow()]);
    const bot = makeBot();

    await expect(service(db, bot).sendNow("user-1", NOW)).resolves.toBe(0);
    expect(bot.sendToUser).not.toHaveBeenCalled();
  });

  it("drops postings that break a hard preference before scoring", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [userRow({ workFormats: ["remote"] })]);
    queue(candidateProfiles, [profileRow()]);
    queue(vacancies, [
      vacancyRow({ id: "office", workFormat: "onsite" }),
      vacancyRow({ id: "remote", workFormat: "remote" }),
    ]);
    const bot = makeBot();

    await expect(service(db, bot).sendNow("user-1", NOW)).resolves.toBe(1);
    expect(writes.find((w) => w.table === digestItems)?.values).toMatchObject({
      vacancyId: "remote",
    });
  });

  it("applies the same preferences to the owner", async () => {
    const { db, queue, writes } = ownerDb();
    queue(digestSettings, [settingsRow({ workFormats: ["remote"], minScore: 0 })]);
    queue(vacancies, [vacancyRow({ id: "office", workFormat: "onsite" })]);
    const bot = makeBot();

    await expect(service(db, bot).sendNow("user-1", NOW)).resolves.toBe(0);
    expect(writes.filter((w) => w.table === digestItems)).toHaveLength(0);
  });

  it("builds pre-rank terms from the profile: family words and skill spellings, core first", () => {
    const terms = profileTerms({
      role: "Frontend Developer",
      grade: null,
      skills: [
        { name: "Jest", weight: "familiar" },
        { name: "ReactJS", weight: "core" },
      ],
    });
    expect(terms.roles).toContain("front-end");
    expect(terms.stack.slice(0, 3)).toEqual(["react", "react.js", "reactjs"]);
    expect(terms.stack).toContain("jest");
  });
});

describe("DigestSendService — feedback weights (ADR-025 §7)", () => {
  const ctx = (parts: string[], role: "owner" | "user" = "user"): BotCallbackContext => ({
    userId: "user-1",
    chatId: "555",
    messageId: 77,
    parts,
    role,
    language: "ru",
  });
  const learnRow = {
    weights: { skills: {}, companies: {} },
    skills: [{ name: "React", weight: "core" }],
    company: "Acme",
    title: "Senior Angular Developer",
    description: "Angular, RxJS, React",
  };
  const handlerFor = (db: never) => {
    const bot = makeBot();
    service(db, bot).onModuleInit();
    return bot.registerCallback.mock.calls[0][1] as (c: BotCallbackContext) => Promise<unknown>;
  };

  it("moves company and non-core skill weights on a dislike", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestItems, [{ feedback: null }]);
    queue(candidateProfiles, [learnRow]);

    await handlerFor(db)(ctx(["d", "w", "vac-1"]));

    const update = writes.find((w) => w.table === candidateProfiles);
    expect(update?.values).toMatchObject({
      feedbackWeights: { companies: { acme: -0.2 }, skills: { angular: -0.1, rxjs: -0.1 } },
    });
  });

  it("ignores a repeated press of the same button", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestItems, [{ feedback: 1 }]);
    queue(candidateProfiles, [learnRow]);

    await handlerFor(db)(ctx(["d", "u", "vac-1"]));

    expect(writes.find((w) => w.table === candidateProfiles)).toBeUndefined();
  });

  it("lowers the company on hide", async () => {
    const { db, queue, writes } = makeDb();
    queue(candidateProfiles, [learnRow]);

    await handlerFor(db)(ctx(["d", "h", "vac-1"]));

    expect(writes.find((w) => w.table === candidateProfiles)?.values).toMatchObject({
      feedbackWeights: { companies: { acme: -0.3 }, skills: {} },
    });
  });

  it("learns from the owner's presses too, now the owner is judged by the formula", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestItems, [{ feedback: null }]);
    queue(candidateProfiles, [learnRow]);

    await handlerFor(db)(ctx(["d", "w", "vac-1"], "owner"));

    expect(writes.find((w) => w.table === candidateProfiles)?.values).toMatchObject({
      feedbackWeights: { companies: { acme: -0.2 } },
    });
  });

  it("learns nothing for an owner without a stored profile", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestItems, [{ feedback: null }]);

    await handlerFor(db)(ctx(["d", "w", "vac-1"], "owner"));

    expect(writes.find((w) => w.table === candidateProfiles)).toBeUndefined();
  });
});
