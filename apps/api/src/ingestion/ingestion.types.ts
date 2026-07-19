export const INGESTION_QUEUE = 'ingestion';

export type IngestJobData =
  | {
      kind: 'source';
      slug: string;
      /** Bypass the 4-hour minimum interval (manual runs). */
      force?: boolean;
    }
  | {
      /** Runs after all source jobs (FIFO queue, concurrency 1). */
      kind: 'dedup';
    };
