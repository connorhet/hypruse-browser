import {
  parseRequest,
  ProtocolError,
  type ArgsOf,
  type Op,
  type Request,
  type Response,
} from '../shared/protocol';

export type Handlers = { [O in Op]: (args: ArgsOf<O>) => Promise<unknown> };

export type Dispatch = (message: unknown) => Promise<Response | null>;

export type DispatchOptions = {
  // How long a request may run before it is answered with `timeout`.
  timeoutMs?: (request: Request) => number;
  log?: (message: string) => void;
};

export const DEFAULT_TIMEOUT_MS = 20_000;

function defaultTimeout(request: Request): number {
  return request.op === 'page.snapshot'
    ? DEFAULT_TIMEOUT_MS + request.args.settle_ms
    : DEFAULT_TIMEOUT_MS;
}

export function toProtocolError(error: unknown): ProtocolError {
  if (error instanceof ProtocolError) return error;
  if (error instanceof Error) return new ProtocolError('internal', error.message || error.name);
  return new ProtocolError('internal', String(error));
}

function withTimeout<T>(work: Promise<T>, ms: number, op: Op): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ProtocolError('timeout', `${op} did not finish within ${ms} ms`));
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : toProtocolError(error));
      },
    );
  });
}

function call(handlers: Handlers, request: Request): Promise<unknown> {
  const handler = handlers[request.op] as (args: unknown) => Promise<unknown>;
  // A handler that throws synchronously is still one failed request, not a crash.
  try {
    return handler(request.args);
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : toProtocolError(error));
  }
}

// Turns one incoming message into exactly one response, or null when the message is not a
// request at all. It never throws.
export function createDispatcher(handlers: Handlers, options: DispatchOptions = {}): Dispatch {
  const timeoutMs = options.timeoutMs ?? defaultTimeout;
  return async (message) => {
    const parsed = parseRequest(message);
    if (parsed.kind === 'ignored') {
      options.log?.(`ignored a message: ${parsed.reason}`);
      return null;
    }
    if (parsed.kind === 'invalid') {
      return {
        id: parsed.id,
        ok: false,
        error: { code: 'bad_request', message: parsed.error.message },
      };
    }
    const { request } = parsed;
    try {
      const result = await withTimeout(call(handlers, request), timeoutMs(request), request.op);
      return { id: request.id, ok: true, result };
    } catch (error) {
      const { code, message } = toProtocolError(error);
      return { id: request.id, ok: false, error: { code, message } };
    }
  };
}
