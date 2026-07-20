import { HttpException, HttpStatus } from '@nestjs/common';

export interface LlmRequest {
  /** Optional system prompt. */
  system?: string;
  /** The user message (already truncated to a sane size by the caller). */
  user: string;
  maxTokens?: number;
  /** 0..1; defaults to 0.4 — assistant features want mostly-deterministic output. */
  temperature?: number;
}

export interface LlmResult {
  text: string;
  provider: string;
  model: string;
}

/**
 * Every configured provider failed (or none is configured). LLM features are
 * enhancements (ADR-005): controllers let this bubble up as a 503 and the UI
 * tells the user to try again later — core flows never depend on it.
 */
export class LlmUnavailableError extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.SERVICE_UNAVAILABLE);
    this.name = 'LlmUnavailableError';
  }
}
