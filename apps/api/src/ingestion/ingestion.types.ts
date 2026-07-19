export const INGESTION_QUEUE = 'ingestion';

export interface IngestJobData {
  slug: string;
  /** Bypass the 4-hour minimum interval (manual runs). */
  force?: boolean;
}
