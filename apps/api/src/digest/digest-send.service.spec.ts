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
  BATCH_LIMIT,
  DigestSendService,
  INSTANT_SETTLE_MINUTES,
  MAX_SCORING_DEFER_HOURS,
  parsePgTimestamp,
  ownerOnlySource,
  profileTerms,
} from "./digest-send.service";

/**
 * Fake drizzle: a query is keyed by the table its `from()` names, so the join
 * chain can be ignored; reads come from a per-table queue and writes are
 * recorded. Everything resolves lazily so one `from()` consumes one response.
 */
function makeDb() {
  const queues = new Map<unknown, unknown[][]>();
  const writes: { kind: string; table: unknown; values?: unknown }[] = [];
  /** Every `where()` argument of a read, by the table its `from()` names. */
  const wheres: { table: unknown; condition: unknown }[] = [];

  const chain = () => {
    let table: unknown;
    let rows: unknown[] | undefined;
    const resolve = () => (rows ??= queues.get(table)?.shift() ?? []);
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
});

const makeLlm = (reply?: string) => ({
  isConfigured: () => reply !== undefined,
  complete: jest
    .fn()
    .mockResolvedValue({ text: reply ?? "", provider: "groq", model: "m" }),
});

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
  llm: ReturnType<typeof makeLlm>,
  applications: ReturnType<typeof makeApplications> = makeApplications(),
) => {
  const instance = new DigestSendService(db, bot as never, llm as never, applications as never);
  // Production waits between scoring calls for the per-minute token limit.
  instance.batchPaceMs = 0;
  return instance;
};

describe("DigestSendService.sendNow", () => {
  it("says so plainly when there is nothing to send", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, []);
    const bot = makeBot();

    await expect(service(db, bot, makeLlm()).sendNow("user-1")).resolves.toBe(
      0,
    );

    expect(bot.sendToUser).toHaveBeenCalledTimes(1);
    expect(bot.sendToUser.mock.calls[0][1]).toContain(
      "Сегодня ничего стоящего",
    );
    expect(writes).toHaveLength(0);
  });

  it("ranks by the rules score when no LLM is configured", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, [
      vacancyRow({ id: "weak" }),
      vacancyRow({ id: "strong" }),
    ]);
    queue(profileMatches, [ruleRow("weak", 0.3), ruleRow("strong", 0.95)]);
    queue(resumes, []);
    const bot = makeBot();
    const llm = makeLlm();

    await expect(service(db, bot, llm).sendNow("user-1")).resolves.toBe(1);

    // 0.3 → 30%, below the default floor of 60; 0.95 → 95% goes out.
    expect(llm.complete).not.toHaveBeenCalled();
    expect(writes.filter((w) => w.table === digestItems)).toHaveLength(1);
    expect(writes[0]?.values).toMatchObject({ vacancyId: "strong", score: 95 });
  });

  it("still has candidates for a user with no search profile at all", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, [vacancyRow({ id: "a" }), vacancyRow({ id: "b" })]);
    // No profiles → no rules scores. The feed shows these vacancies, so the
    // digest has to reach them too rather than reporting an empty day.
    queue(profileMatches, []);
    queue(resumes, [{ id: "res-1", text: "my resume" }]);
    const bot = makeBot();
    const llm = makeLlm(
      '[{"i":0,"score":88,"note":"Стек совпадает"},{"i":1,"score":30}]',
    );

    await expect(service(db, bot, llm).sendNow("user-1")).resolves.toBe(1);

    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(writes[0]?.values).toMatchObject({ vacancyId: "a", score: 88 });
  });

  it("still sends on lexical relevance when nothing at all is cached", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow({ maxItems: 1 })]);
    // No profile, no scored resume match, no LLM: exactly the account state
    // that answered "nothing worth your attention" for three days straight.
    queue(vacancies, [
      vacancyRow({ id: "unrelated", lexScore: 0 }),
      vacancyRow({ id: "right-job", lexScore: 6 }),
    ]);
    queue(profileMatches, []);
    queue(resumes, []);
    const bot = makeBot();

    await expect(service(db, bot, makeLlm()).sendNow("user-1")).resolves.toBe(
      1,
    );
    expect(writes[0]?.values).toMatchObject({
      vacancyId: "right-job",
      score: 100,
    });
  });

  it("ranks on the cached resume score when there is no rules score", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow({ maxItems: 1 })]);
    queue(vacancies, [
      vacancyRow({ id: "meh", resumeScore: 0.61 }),
      vacancyRow({ id: "great", resumeScore: 0.92 }),
    ]);
    queue(profileMatches, []);
    queue(resumes, []);
    const bot = makeBot();

    await expect(service(db, bot, makeLlm()).sendNow("user-1")).resolves.toBe(
      1,
    );
    expect(writes[0]?.values).toMatchObject({ vacancyId: "great", score: 92 });
  });

  it("scores the batch with one LLM call and sends a card per pick", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, [vacancyRow({ id: "a" }), vacancyRow({ id: "b" })]);
    queue(profileMatches, [ruleRow("a", 0.9), ruleRow("b", 0.2)]);
    queue(resumes, [{ id: "res-1", text: "my resume" }]);
    const bot = makeBot();
    const llm = makeLlm(
      '[{"i":0,"score":91,"note":"Стек совпадает"},{"i":1,"score":40}]',
    );

    await expect(service(db, bot, llm).sendNow("user-1")).resolves.toBe(1);

    expect(llm.complete).toHaveBeenCalledTimes(1);
    // Header + one card; the 40% vacancy is below the floor and never sent.
    expect(bot.sendToUser).toHaveBeenCalledTimes(2);
    expect(bot.sendToUser.mock.calls[1][1]).toContain("91%");
    expect(writes[0]?.values).toMatchObject({ vacancyId: "a", score: 91 });
  });

  it("sends a long posting as several messages, with the buttons on the last", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, [vacancyRow({ description: "слово ".repeat(1000) })]);
    queue(profileMatches, [ruleRow("vac-1", 0.9)]);
    queue(resumes, []);
    const bot = makeBot();
    bot.sendToUser
      .mockResolvedValueOnce("900")
      .mockResolvedValueOnce("901")
      .mockResolvedValue("902");

    await expect(service(db, bot, makeLlm()).sendNow("user-1")).resolves.toBe(
      1,
    );

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

  it("falls back to the rules order when the LLM call fails", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, [vacancyRow()]);
    queue(profileMatches, [ruleRow("vac-1", 0.8)]);
    queue(resumes, [{ id: "res-1", text: "my resume" }]);
    const bot = makeBot();
    const llm = makeLlm("");
    llm.complete.mockRejectedValue(new Error("all providers failed"));

    await expect(service(db, bot, llm).sendNow("user-1")).resolves.toBe(1);
    expect(writes[0]?.values).toMatchObject({ score: 80 });
  });

  it("falls back when the reply parses to nothing rather than sending an empty digest", async () => {
    const { db, queue } = makeDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, [vacancyRow()]);
    queue(profileMatches, [ruleRow("vac-1", 0.8)]);
    queue(resumes, [{ id: "res-1", text: "my resume" }]);
    const bot = makeBot();

    await expect(
      service(db, bot, makeLlm("sorry, I cannot")).sendNow("user-1"),
    ).resolves.toBe(1);
  });

  it("records a sent vacancy even when Telegram refused it, so it never returns", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow()]);
    queue(vacancies, [vacancyRow()]);
    queue(profileMatches, [ruleRow("vac-1", 0.9)]);
    queue(resumes, []);
    const bot = makeBot();
    bot.sendToUser.mockResolvedValue(null);

    await service(db, bot, makeLlm()).sendNow("user-1");

    expect(writes.filter((w) => w.table === digestItems)).toHaveLength(1);
  });

  it("respects the per-send cap", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow({ maxItems: 2, minScore: 0 })]);
    queue(vacancies, [
      vacancyRow({ id: "a" }),
      vacancyRow({ id: "b" }),
      vacancyRow({ id: "c" }),
    ]);
    queue(profileMatches, [
      ruleRow("a", 0.9),
      ruleRow("b", 0.8),
      ruleRow("c", 0.7),
    ]);
    queue(resumes, []);
    const bot = makeBot();

    await expect(service(db, bot, makeLlm()).sendNow("user-1")).resolves.toBe(
      2,
    );
    expect(writes.filter((w) => w.table === digestItems)).toHaveLength(2);
  });

  it("sends every match above the floor when there is no cap (ADR-022)", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow({ maxItems: null, minScore: 0 })]);
    const ids = Array.from({ length: 14 }, (_, i) => `v${i}`);
    queue(vacancies, ids.map((id) => vacancyRow({ id })));
    queue(profileMatches, ids.map((id) => ruleRow(id, 0.8)));
    queue(resumes, []);
    const bot = makeBot();

    await expect(service(db, bot, makeLlm()).sendNow("user-1")).resolves.toBe(
      14,
    );
    expect(writes.filter((w) => w.table === digestItems)).toHaveLength(14);
  });

  it("scores a window larger than one batch with one LLM call per batch", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow({ maxItems: null, minScore: 60 })]);
    const ids = Array.from({ length: BATCH_LIMIT * 2 + 3 }, (_, i) => `v${i}`);
    queue(vacancies, ids.map((id) => vacancyRow({ id })));
    queue(profileMatches, []);
    queue(resumes, [{ id: "r1", text: "Senior frontend React TypeScript" }]);
    // Every vacancy the model sees gets 80; indexes restart in each batch.
    const verdicts = (count: number) =>
      JSON.stringify(
        Array.from({ length: count }, (_, i) => ({ i, score: 80, note: "ok" })),
      );
    const llm = makeLlm("");
    llm.complete
      .mockResolvedValueOnce({ text: verdicts(BATCH_LIMIT), provider: "groq", model: "m" })
      .mockResolvedValueOnce({ text: verdicts(BATCH_LIMIT), provider: "groq", model: "m" })
      .mockResolvedValueOnce({ text: verdicts(3), provider: "groq", model: "m" });
    const bot = makeBot();

    await expect(service(db, bot, llm).sendNow("user-1")).resolves.toBe(ids.length);
    expect(llm.complete).toHaveBeenCalledTimes(3);
    const sent = writes
      .filter((w) => w.table === digestItems)
      .map((w) => (w.values as { vacancyId: string }).vacancyId);
    expect(new Set(sent)).toEqual(new Set(ids));
  });

  it("does nothing for a user with no settings row", async () => {
    const { db, queue } = makeDb();
    queue(digestSettings, []);
    const bot = makeBot();

    await expect(service(db, bot, makeLlm()).sendNow("user-1")).resolves.toBe(
      0,
    );
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
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [scheduled()]);
    const bot = makeBot();

    await expect(
      service(db, bot, makeLlm()).run(new Date("2026-08-11T08:00:00Z")),
    ).resolves.toMatchObject({ sent: 0, skipped: 0 });
    expect(bot.sendToUser).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it("sends the due slot and consumes it exactly once", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [scheduled()]);
    queue(vacancies, []);
    const bot = makeBot();

    const result = await service(db, bot, makeLlm()).run(
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
    const { db, queue, writes } = makeDb();
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
    queue(profileMatches, [ruleRow("a", 0.9), ruleRow("b", 0.8), ruleRow("c", 0.7)]);
    const bot = makeBot();

    const result = await service(db, bot, makeLlm()).run(
      new Date("2026-08-11T09:01:00Z"),
    );

    expect(result).toMatchObject({ sent: 1, vacancies: 3 });
    expect(bot.sendToUser.mock.calls[0][1]).toContain("3");
    const slot = writes.find((w) => w.table === digestSettings)?.values;
    expect(slot).toMatchObject({ lastSentKey: "2026-08-11 09:00" });
    expect(slot).toHaveProperty("judgedThrough");
  });

  it("says nothing is new when no vacancy arrived since the previous send", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [scheduled({ judgedThrough: "2026-08-11 08:00:00+00" })]);
    queue(vacancies, [{ after: "2026-08-11 08:00:00+00", until: null }]);
    const bot = makeBot();

    const result = await service(db, bot, makeLlm()).run(
      new Date("2026-08-11T09:01:00Z"),
    );

    expect(result).toMatchObject({ sent: 1, vacancies: 0 });
    expect(bot.sendToUser).toHaveBeenCalledTimes(1);
    const slot = writes.find((w) => w.table === digestSettings)?.values;
    expect(slot).toMatchObject({ lastSentKey: "2026-08-11 09:00" });
    expect(slot).not.toHaveProperty("judgedThrough");
  });

  it("consumes a long-elapsed slot without sending a morning digest at night", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [scheduled()]);
    const bot = makeBot();

    const result = await service(db, bot, makeLlm()).run(
      new Date("2026-08-11T22:00:00Z"),
    );

    expect(result).toMatchObject({ sent: 0, skipped: 1 });
    expect(bot.sendToUser).not.toHaveBeenCalled();
    expect(writes[0]?.values).toMatchObject({
      lastSentKey: "2026-08-11 09:00",
    });
  });

  it("keeps going when one user run throws", async () => {
    const { db, queue } = makeDb();
    queue(digestSettings, [
      scheduled({ userId: "bad" }),
      scheduled({ userId: "good" }),
    ]);
    // Only one candidate response is queued, so the second user reads an empty
    // list — the point is that the loop reaches them at all.
    queue(vacancies, []);
    const bot = makeBot();
    bot.sendToUser.mockRejectedValueOnce(new Error("boom"));

    const result = await service(db, bot, makeLlm()).run(
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
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [instant()]);
    queue(vacancies, [WINDOW], [vacancyRow()]);
    const bot = makeBot();

    const result = await service(db, bot, makeLlm()).run(
      new Date("2026-08-11T23:30:00Z"),
    );

    expect(result).toMatchObject({ instant: 0, vacancies: 0 });
    expect(bot.sendToUser).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it("does nothing when no settled vacancy arrived past the watermark", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [instant()]);
    queue(vacancies, [{ after: WINDOW.after, until: null }]);
    const bot = makeBot();

    const result = await service(db, bot, makeLlm()).run(NOON);

    expect(result.instant).toBe(0);
    expect(bot.sendToUser).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it("pushes the new matches under an instant header and moves the watermark", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [instant()]);
    queue(vacancies, [WINDOW], [vacancyRow({ id: "fresh" })]);
    queue(profileMatches, [ruleRow("fresh", 0.9)]);
    const bot = makeBot();

    const result = await service(db, bot, makeLlm()).run(NOON);

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
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [instant()]);
    // 70% clears the scheduled floor of 60 but not the instant floor of 75.
    queue(vacancies, [WINDOW], [vacancyRow({ id: "decent" })]);
    queue(profileMatches, [ruleRow("decent", 0.7)]);
    const bot = makeBot();

    await service(db, bot, makeLlm()).run(NOON);

    expect(writes.filter((w) => w.table === digestItems)).toHaveLength(0);
  });

  it("stays silent when nothing clears the floor, yet still moves the watermark", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [instant()]);
    queue(vacancies, [WINDOW], [vacancyRow({ id: "weak" })]);
    queue(profileMatches, [ruleRow("weak", 0.2)]);
    const bot = makeBot();

    const result = await service(db, bot, makeLlm()).run(NOON);

    // No "nothing worth your attention" several times a day.
    expect(bot.sendToUser).not.toHaveBeenCalled();
    expect(result).toMatchObject({ instant: 1, vacancies: 0 });
    // Judged once is judged: no LLM call per tick on the same window.
    expect(writes.map((w) => w.table)).toEqual([digestSettings]);
  });

  it("keeps the window and retries when the LLM is rate-limited", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [instant()]);
    queue(vacancies, [WINDOW], [vacancyRow({ id: "fresh" })]);
    queue(profileMatches, [ruleRow("fresh", 0.9)]);
    queue(resumes, [{ id: "r1", text: "Senior frontend React TypeScript" }]);
    const llm = makeLlm("");
    llm.complete.mockRejectedValue(new Error("groq: HTTP 429"));
    const bot = makeBot();

    const result = await service(db, bot, llm).run(NOON);

    // Nothing pushed on the rules order, and the watermark stays for the next tick.
    expect(bot.sendToUser).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
    expect(result.instant).toBe(0);
  });

  it(`gives up waiting after ${MAX_SCORING_DEFER_HOURS} hours and falls back to the rules order`, async () => {
    const { db, queue, writes } = makeDb();
    const old = { after: "2026-08-11 05:00:00.000001+00", until: WINDOW.until };
    queue(digestSettings, [instant({ judgedThrough: old.after })]);
    queue(vacancies, [old], [vacancyRow({ id: "fresh" })]);
    queue(profileMatches, [ruleRow("fresh", 0.9)]);
    queue(resumes, [{ id: "r1", text: "Senior frontend React TypeScript" }]);
    const llm = makeLlm("");
    llm.complete.mockRejectedValue(new Error("groq: HTTP 429"));
    const bot = makeBot();

    const result = await service(db, bot, llm).run(NOON);

    expect(result).toMatchObject({ instant: 1, vacancies: 1 });
    expect(writes.some((w) => w.table === digestSettings)).toBe(true);
  });

  it("stays silent when every new vacancy was already sent or hidden", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [instant()]);
    queue(vacancies, [WINDOW], []);
    const bot = makeBot();

    await service(db, bot, makeLlm()).run(NOON);

    expect(bot.sendToUser).not.toHaveBeenCalled();
    expect(writes.map((w) => w.table)).toEqual([digestSettings]);
  });

  it("ignores the send times: a due slot does not produce a scheduled digest", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [instant({ sendTimes: ["11:59"] })]);
    queue(vacancies, [{ after: WINDOW.after, until: null }]);
    const bot = makeBot();

    const result = await service(db, bot, makeLlm()).run(NOON);

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
    const instance = service(db, bot, makeLlm());
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
    const instance = service(db, bot, makeLlm(), applications);
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
    service(db, bot, makeLlm(), applications).onModuleInit();
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

  it("scores by the formula with a template note and never calls the LLM", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [userRow({ language: "en" })]);
    queue(candidateProfiles, [profileRow()]);
    queue(vacancies, [
      vacancyRow({ id: "fit", description: "React, TypeScript, GraphQL" }),
      vacancyRow({ id: "backend", title: "Senior Backend Engineer", description: "Go, Kafka" }),
    ]);
    const bot = makeBot();
    const llm = makeLlm('[{"i":0,"score":99}]');

    await expect(service(db, bot, llm).sendNow("user-1", NOW)).resolves.toBe(1);

    expect(llm.complete).not.toHaveBeenCalled();
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

    await service(db, makeBot(), makeLlm()).sendNow("user-1", NOW);

    const condition = wheres.find((w) => w.table === vacancies)?.condition;
    expect(containsSql(condition, ownerOnlySource)).toBe(true);
  });

  it("lets through owner-only vacancies addressed to this user (ADR-027)", async () => {
    const { db, queue, wheres } = makeDb();
    queue(digestSettings, [userRow()]);
    queue(candidateProfiles, [profileRow()]);
    queue(vacancies, []);

    await service(db, makeBot(), makeLlm()).sendNow("user-1", NOW);

    const condition = wheres.find((w) => w.table === vacancies)?.condition;
    expect(containsSql(condition, vacancyRecipients)).toBe(true);
    expect(containsSql(condition, "user-1")).toBe(true);
  });

  it("keeps the owner's own sources for the owner", async () => {
    const { db, queue, wheres } = makeDb();
    queue(digestSettings, [settingsRow({ minScore: 0 })]);
    queue(vacancies, []);
    queue(resumes, []);

    await service(db, makeBot(), makeLlm()).sendNow("user-1", NOW);

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

    await expect(service(db, bot, makeLlm()).sendNow("user-1", NOW)).resolves.toBe(0);
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

    await expect(service(db, bot, makeLlm()).sendNow("user-1", NOW)).resolves.toBe(1);
    expect(writes.find((w) => w.table === digestItems)?.values).toMatchObject({
      vacancyId: "remote",
    });
  });

  it("applies the same preferences to the owner", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestSettings, [settingsRow({ workFormats: ["remote"], minScore: 0 })]);
    queue(vacancies, [vacancyRow({ id: "office", workFormat: "onsite" })]);
    queue(resumes, []);
    const bot = makeBot();

    await expect(service(db, bot, makeLlm()).sendNow("user-1", NOW)).resolves.toBe(0);
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
    service(db, bot, makeLlm()).onModuleInit();
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

  it("keeps no weights for the owner, who is judged by the LLM", async () => {
    const { db, queue, writes } = makeDb();
    queue(digestItems, [{ feedback: null }]);
    queue(candidateProfiles, [learnRow]);

    await handlerFor(db)(ctx(["d", "u", "vac-1"], "owner"));

    expect(writes.find((w) => w.table === candidateProfiles)).toBeUndefined();
  });
});

describe("parsePgTimestamp", () => {
  it("reads Postgres timestamptz text with microseconds and a short offset", () => {
    expect(parsePgTimestamp("2026-10-16 06:10:00.189002+00").toISOString()).toBe(
      "2026-10-16T06:10:00.189Z",
    );
    expect(parsePgTimestamp("2026-10-16 09:10:00+03").toISOString()).toBe("2026-10-16T06:10:00.000Z");
  });
});

describe("scoring batch size", () => {
  it("keeps one call well under Groq's 8000 tokens per minute", () => {
    // ~150 tokens per card, ~2000 for the resume, 1500 for the reply.
    expect(BATCH_LIMIT * 150 + 2000 + 1500).toBeLessThan(8000 * 0.75);
  });
});
