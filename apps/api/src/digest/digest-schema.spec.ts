import {
  DIGEST_MAX_ITEMS_LIMIT,
  DIGEST_MAX_SENDS_PER_DAY,
  sortSendTimes,
  updateDigestSettingsSchema,
} from "@jobradar/shared";

describe("updateDigestSettingsSchema — instant delivery (ADR-019)", () => {
  it("accepts the delivery mode, quiet hours and instant floor", () => {
    expect(
      updateDigestSettingsSchema.parse({
        mode: "instant",
        quietStart: "22:00",
        quietEnd: "08:00",
        instantMinScore: 75,
      }),
    ).toEqual({
      mode: "instant",
      quietStart: "22:00",
      quietEnd: "08:00",
      instantMinScore: 75,
    });
  });

  it("rejects an unknown mode, a malformed quiet bound and an out-of-range floor", () => {
    expect(
      updateDigestSettingsSchema.safeParse({ mode: "hourly" }).success,
    ).toBe(false);
    expect(
      updateDigestSettingsSchema.safeParse({ quietStart: "24:00" }).success,
    ).toBe(false);
    expect(
      updateDigestSettingsSchema.safeParse({ quietEnd: "8:00" }).success,
    ).toBe(false);
    expect(
      updateDigestSettingsSchema.safeParse({ instantMinScore: 101 }).success,
    ).toBe(false);
    expect(
      updateDigestSettingsSchema.safeParse({ instantMinScore: 7.5 }).success,
    ).toBe(false);
  });
});

describe("updateDigestSettingsSchema", () => {
  it("accepts a partial update", () => {
    expect(updateDigestSettingsSchema.parse({ enabled: false })).toEqual({
      enabled: false,
    });
    expect(updateDigestSettingsSchema.parse({})).toEqual({});
  });

  it("accepts up to the daily send cap", () => {
    const times = ["08:00", "12:30", "17:00", "21:45"];
    expect(times).toHaveLength(DIGEST_MAX_SENDS_PER_DAY);
    expect(
      updateDigestSettingsSchema.parse({ sendTimes: times }).sendTimes,
    ).toEqual(times);
  });

  it("rejects more sends than the cap, and an empty schedule", () => {
    expect(
      updateDigestSettingsSchema.safeParse({
        sendTimes: ["08:00", "12:00", "16:00", "20:00", "23:00"],
      }).success,
    ).toBe(false);
    expect(
      updateDigestSettingsSchema.safeParse({ sendTimes: [] }).success,
    ).toBe(false);
  });

  it("rejects duplicate times, which would race for the same vacancies", () => {
    expect(
      updateDigestSettingsSchema.safeParse({ sendTimes: ["09:00", "09:00"] })
        .success,
    ).toBe(false);
  });

  it("rejects anything that is not a 24-hour HH:MM", () => {
    for (const bad of ["9:00", "24:00", "09:60", "09:00:00", "morning", ""]) {
      expect(
        updateDigestSettingsSchema.safeParse({ sendTimes: [bad] }).success,
      ).toBe(false);
    }
  });

  it("keeps the shortlist a shortlist", () => {
    expect(
      updateDigestSettingsSchema.safeParse({ maxItems: DIGEST_MAX_ITEMS_LIMIT })
        .success,
    ).toBe(true);
    expect(
      updateDigestSettingsSchema.safeParse({
        maxItems: DIGEST_MAX_ITEMS_LIMIT + 1,
      }).success,
    ).toBe(false);
    expect(updateDigestSettingsSchema.safeParse({ maxItems: 0 }).success).toBe(
      false,
    );
    expect(
      updateDigestSettingsSchema.safeParse({ maxItems: 2.5 }).success,
    ).toBe(false);
  });

  it("bounds the fit threshold to a percentage", () => {
    expect(updateDigestSettingsSchema.safeParse({ minScore: 0 }).success).toBe(
      true,
    );
    expect(
      updateDigestSettingsSchema.safeParse({ minScore: 100 }).success,
    ).toBe(true);
    expect(
      updateDigestSettingsSchema.safeParse({ minScore: 101 }).success,
    ).toBe(false);
    expect(updateDigestSettingsSchema.safeParse({ minScore: -1 }).success).toBe(
      false,
    );
  });

  it("accepts the timezone the times were entered in, and stays optional", () => {
    expect(
      updateDigestSettingsSchema.safeParse({ timezone: "Europe/Minsk" })
        .success,
    ).toBe(true);
    expect(
      updateDigestSettingsSchema.safeParse({ sendTimes: ["09:00"] }).success,
    ).toBe(true);
    expect(updateDigestSettingsSchema.safeParse({ timezone: "" }).success).toBe(
      false,
    );
  });
});

describe("sortSendTimes", () => {
  it("orders times so the next send is a scan from the front", () => {
    expect(sortSendTimes(["21:45", "08:00", "12:30"])).toEqual([
      "08:00",
      "12:30",
      "21:45",
    ]);
  });

  it("does not mutate the caller array", () => {
    const times = ["21:45", "08:00"];
    sortSendTimes(times);
    expect(times).toEqual(["21:45", "08:00"]);
  });
});
