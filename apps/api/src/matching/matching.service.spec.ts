import { profileMatches, searchProfiles, vacancies } from "../db/schema";
import { MatchingService } from "./matching.service";

/**
 * Fake drizzle in the shape of the other service specs: a read is keyed by the
 * table its `from()` names and served from a per-table queue; writes are
 * recorded. A chain that is never awaited (a subquery) consumes nothing.
 */
function makeDb(profiles: Record<string, unknown>[] = []) {
  const queues = new Map<unknown, unknown[][]>();
  const reads: unknown[] = [];
  const deletes: unknown[] = [];
  const updates: { table: unknown; values: Record<string, unknown> }[] = [];
  const inserts: { table: unknown; values: unknown }[] = [];

  const chain = () => {
    let table: unknown;
    let rows: unknown[] | undefined;
    const resolve = () => {
      if (rows === undefined) {
        reads.push(table);
        rows = queues.get(table)?.shift() ?? [];
      }
      return rows;
    };
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
            return proxy;
          };
        },
      },
    );
    return proxy;
  };

  const db = {
    select: () => chain(),
    delete: (table: unknown) => ({
      where: () => {
        deletes.push(table);
        const reported =
          queues.get(`delete:${String(deletes.length)}`)?.[0] ?? [];
        return {
          returning: () => Promise.resolve(reported),
          then: (ok: (r: unknown) => unknown) =>
            Promise.resolve(undefined).then(ok),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push({ table, values });
          return Promise.resolve();
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        onConflictDoNothing: () => {
          inserts.push({ table, values });
          return Promise.resolve();
        },
      }),
    }),
    query: {
      searchProfiles: {
        findFirst: () => Promise.resolve(profiles[0]),
      },
    },
  };

  return {
    db: db as never,
    reads,
    deletes,
    updates,
    inserts,
    queue: (table: unknown, ...responses: unknown[][]) =>
      queues.set(table, responses),
    /** Rows the n-th delete (1-based) reports as removed. */
    deleted: (n: number, rows: unknown[]) =>
      queues.set(`delete:${String(n)}`, [rows]),
  };
}

const profile = (over: Record<string, unknown> = {}) => ({
  id: "p-1",
  userId: "u-1",
  name: "Frontend",
  keywords: ["react"],
  stack: [],
  workFormat: [],
  employmentType: [],
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  isActive: true,
  matchedThrough: "2026-09-28 10:00:00.123456+00",
  ...over,
});

const vacancy = (
  id: string,
  title = "Senior React Developer",
  description = "React, TypeScript",
) => ({
  id,
  title,
  description,
  workFormat: null,
  employmentType: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
});

const UNTIL = "2026-09-29 08:00:00.654321+00";

function service(fake: ReturnType<typeof makeDb>) {
  const svc = new MatchingService(fake.db);
  (svc as unknown as { logger: { log: () => void } }).logger = {
    log: () => undefined,
  };
  return svc;
}

/** Reads of `vacancies` that fetched rows, i.e. not the one-row high-water probe. */
const vacancyReads = (fake: ReturnType<typeof makeDb>) =>
  fake.reads.filter((t) => t === vacancies).length;

describe("MatchingService.rematchAll", () => {
  it("reads no vacancy at all when there is no active profile", async () => {
    const fake = makeDb();
    fake.queue(searchProfiles, []);

    const result = await service(fake).rematchAll();

    expect(vacancyReads(fake)).toBe(0);
    expect(result).toEqual({
      profiles: 0,
      vacancies: 0,
      inserted: 0,
      updated: 0,
      removed: 0,
    });
  });

  it("clears an inactive profile and forgets its watermark, without reading the board", async () => {
    const fake = makeDb();
    fake.queue(searchProfiles, [profile({ isActive: false })]);
    fake.deleted(1, [{ vacancyId: "v-1" }, { vacancyId: "v-2" }]);

    const result = await service(fake).rematchAll();

    expect(vacancyReads(fake)).toBe(0);
    expect(fake.deletes).toEqual([profileMatches]);
    expect(fake.updates).toEqual([
      { table: searchProfiles, values: { matchedThrough: null } },
    ]);
    expect(result.removed).toBe(2);
  });

  it("matches only the delta and moves the watermark to the high-water mark", async () => {
    const fake = makeDb();
    fake.queue(searchProfiles, [profile()]);
    fake.queue(vacancies, [{ at: UNTIL }], [vacancy("v-new")]);
    fake.queue(profileMatches, []);

    const result = await service(fake).rematchAll();

    expect(result).toMatchObject({ vacancies: 1, inserted: 1, removed: 0 });
    expect(fake.inserts).toHaveLength(1);
    const watermark = fake.updates.find((u) => u.table === searchProfiles);
    expect(watermark).toBeDefined();
  });

  it('does not read "absent from the delta" as "no longer a match"', async () => {
    const fake = makeDb();
    fake.queue(searchProfiles, [profile()]);
    // Nothing changed since the watermark: the stored match of v-old stays.
    fake.queue(vacancies, [{ at: UNTIL }], []);

    const result = await service(fake).rematchAll();

    expect(result).toMatchObject({ vacancies: 0, inserted: 0, removed: 0 });
    // The only delete is the duplicate prune; no reconcile delete ran.
    expect(fake.deletes).toEqual([profileMatches]);
    expect(fake.reads).not.toContain(profileMatches);
  });

  it("drops a match whose vacancy changed into a non-match", async () => {
    const fake = makeDb();
    fake.queue(searchProfiles, [profile()]);
    fake.queue(
      vacancies,
      [{ at: UNTIL }],
      [vacancy("v-1", "Accountant", "Excel, reporting")],
    );
    fake.queue(profileMatches, [{ vacancyId: "v-1", score: 80 }]);

    const result = await service(fake).rematchAll();

    expect(result.removed).toBe(1);
    // prune + the reconcile delete of v-1
    expect(fake.deletes).toEqual([profileMatches, profileMatches]);
  });

  it("gives a never-matched profile the full pass, so stale matches go", async () => {
    const fake = makeDb();
    fake.queue(searchProfiles, [profile({ matchedThrough: null })]);
    fake.queue(vacancies, [{ at: UNTIL }], [vacancy("v-1")]);
    // v-gone is not on the board any more; only a full comparison sees it.
    fake.queue(profileMatches, [{ vacancyId: "v-gone", score: 70 }]);

    const result = await service(fake).rematchAll();

    expect(result).toMatchObject({ vacancies: 1, inserted: 1, removed: 1 });
  });

  it("prunes matches of vacancies dedup has since linked as duplicates", async () => {
    const fake = makeDb();
    fake.queue(searchProfiles, [profile()]);
    fake.queue(vacancies, [{ at: UNTIL }], []);
    fake.deleted(1, [{ vacancyId: "v-dup" }]);

    const result = await service(fake).rematchAll();

    expect(result.removed).toBe(1);
  });

  it("leaves the watermark alone on an empty board", async () => {
    const fake = makeDb();
    fake.queue(searchProfiles, [profile()]);
    fake.queue(vacancies, [{ at: null }]);

    await service(fake).rematchAll();

    expect(vacancyReads(fake)).toBe(1); // the high-water probe only
    expect(fake.updates).toEqual([]);
  });
});

describe("MatchingService.rematchProfile", () => {
  it("ignores the watermark: edited criteria make every old verdict moot", async () => {
    const fake = makeDb([profile()]);
    fake.queue(vacancies, [{ at: UNTIL }], [vacancy("v-1")]);
    fake.queue(profileMatches, [{ vacancyId: "v-stale", score: 60 }]);

    await service(fake).rematchProfile("p-1");

    // Full comparison: the stale match is deleted, the new one inserted.
    expect(fake.inserts).toHaveLength(1);
    expect(fake.deletes).toEqual([profileMatches]);
  });

  it("clears a deactivated profile without reading the board", async () => {
    const fake = makeDb([profile({ isActive: false })]);

    await service(fake).rematchProfile("p-1");

    expect(vacancyReads(fake)).toBe(0);
    expect(fake.deletes).toEqual([profileMatches]);
    expect(fake.updates).toEqual([
      { table: searchProfiles, values: { matchedThrough: null } },
    ]);
  });
});
