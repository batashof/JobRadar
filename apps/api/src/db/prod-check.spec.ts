import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { describeDatabase, describeSources } from "./prod-check";

const dialect = new PgDialect();

function fakeDb(exposed: { role: string; tables: number }[]) {
  const queries: string[] = [];
  const execute = jest.fn(async (query: SQL) => {
    queries.push(dialect.sqlToQuery(query).sql);
    if (queries.length === 1) {
      return {
        rows: [
          {
            version: "17.6",
            role: "postgres",
            database: "postgres",
            tables: 25,
          },
        ],
      };
    }
    return { rows: exposed };
  });
  return { db: { execute }, queries };
}

describe("describeDatabase", () => {
  it("reports the server, the database and its tables", async () => {
    const { db } = fakeDb([]);
    const lines = await describeDatabase(db);

    expect(lines[0]).toBe(
      "Connected: PostgreSQL 17.6, database postgres, role postgres.",
    );
    expect(lines[1]).toBe("Tables in public: 25.");
  });

  it("says so when the Data API roles do not exist", async () => {
    const { db } = fakeDb([]);
    const lines = await describeDatabase(db);
    expect(lines).toContain("No Data API roles on this server (not Supabase).");
  });

  it("counts the public tables each Data API role can reach", async () => {
    const { db } = fakeDb([
      { role: "anon", tables: 0 },
      { role: "authenticated", tables: 3 },
    ]);
    const lines = await describeDatabase(db);

    expect(lines).toContain(
      "Data API role anon can read/write 0 public table(s).",
    );
    expect(lines).toContain(
      "Data API role authenticated can read/write 3 public table(s).",
    );
  });

  it("only reads", async () => {
    const { db, queries } = fakeDb([]);
    await describeDatabase(db);

    expect(queries).toHaveLength(2);
    for (const query of queries) expect(query.trim()).toMatch(/^select /);
  });
});

describe("describeSources", () => {
  function sourcesDb(
    bySource: Record<string, unknown>[],
    byChannel: Record<string, unknown>[],
  ) {
    const queries: string[] = [];
    const execute = jest.fn(async (query: SQL) => {
      queries.push(dialect.sqlToQuery(query).sql);
      return { rows: queries.length === 1 ? bySource : byChannel };
    });
    return { db: { execute }, queries };
  }

  it("reports the recent yield of every source and every Telegram channel", async () => {
    const { db } = sourcesDb(
      [
        {
          slug: "dou",
          active: true,
          lastRunAt: "2026-10-15T20:00:00Z",
          lastRunStatus: "success",
          recent: 42,
          newest: "2026-10-15T19:00:00Z",
        },
        {
          slug: "hh",
          active: false,
          lastRunAt: null,
          lastRunStatus: null,
          recent: 0,
          newest: null,
        },
      ],
      [{ channel: "job_react", recent: 30, newest: "2026-10-15T10:00:00Z" }],
    );
    const lines = await describeSources(db);

    expect(lines).toEqual([
      "Vacancies per source, last 14 days:",
      "  dou: 42, newest 2026-10-15, last run 2026-10-15 success",
      "  hh (inactive): 0, newest never, last run never",
      "Telegram vacancies per channel, last 14 days:",
      "  job_react: 30, newest 2026-10-15",
    ]);
  });

  it("skips the channel section when no Telegram vacancy exists, and only reads", async () => {
    const { db, queries } = sourcesDb([], []);
    const lines = await describeSources(db);

    expect(lines).toEqual(["Vacancies per source, last 14 days:"]);
    expect(queries).toHaveLength(2);
    for (const query of queries) expect(query.trim()).toMatch(/^select /);
  });
});
