import type { ErrorCode } from '../shared/protocol';

// Thrown inside the page and turned into {ok: false, error} by the agent.
export class PageError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PageError';
  }
}
