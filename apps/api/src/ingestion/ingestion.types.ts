export type IngestJobData =
  | {
      kind: 'source';
      slug: string;
      /** Bypass the per-source minimum interval (manual runs, `schedule.ts`). */
      force?: boolean;
    }
  | {
      /** Runs after all source jobs (FIFO, one at a time: `IngestionQueue`). */
      kind: 'dedup';
    }
  | {
      /** Runs after dedup: recomputes profile ↔ vacancy matches. */
      kind: 'match';
    };
