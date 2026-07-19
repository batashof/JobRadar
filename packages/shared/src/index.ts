/**
 * @jobradar/shared — types, validation schemas and constants shared
 * between apps/web and apps/api.
 */

export const APP_NAME = 'JobRadar';

/** Shape of the API health-check response (GET /health). */
export interface HealthResponse {
  status: 'ok';
  service: string;
  version: string;
  timestamp: string;
}
