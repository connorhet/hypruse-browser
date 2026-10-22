// Protocol version 1 between the extension and hypruse's browser-host.
// docs/PROTOCOL.md is the prose version of this file; keep the two in step.
import { z } from 'zod';

// Extension pages forbid eval, so zod must not try to compile validators with it.
z.config({ jitless: true });

export const PROTOCOL_VERSION = 1;
export const HOST_NAME = 'dev.hypruse.browser';

export const ERROR_CODES = [
  'bad_request',
  'not_found',
  'stale_snapshot',
  'refused',
  'restricted_page',
  'timeout',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class ProtocolError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}

const tabId = z.number().int().nonnegative();
const handle = z.string().min(1);
const noArgs = z.strictObject({});

export const MAX_ELEMENTS = 1000;
// An upload arrives in chunks, since Chrome caps a message from the host at 1 MB.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_CHUNKS = 64;
export const MAX_SETTLE_MS = 10_000;

export const requestSchemas = {
  ping: noArgs,
  'tabs.list': noArgs,
  'tabs.activate': z.strictObject({ tab_id: tabId }),
  'tabs.open': z.strictObject({
    url: z.string().min(1),
    where: z.enum(['new', 'current', 'background']),
  }),
  'tabs.close': z.strictObject({ tab_id: tabId }),
  'tabs.history': z.strictObject({ tab_id: tabId, direction: z.enum(['back', 'forward']) }),
  'page.snapshot': z.strictObject({
    tab_id: tabId.optional(),
    max: z.number().int().min(1).max(MAX_ELEMENTS).default(120),
    settle_ms: z.number().int().min(0).max(MAX_SETTLE_MS).default(0),
  }),
  'page.click': z.strictObject({ snapshot_id: handle, element_id: handle }),
  'page.type': z.strictObject({
    snapshot_id: handle,
    element_id: handle,
    text: z.string(),
    submit: z.boolean().default(false),
  }),
  'page.scroll': z.strictObject({
    tab_id: tabId.optional(),
    direction: z.enum(['up', 'down', 'top', 'bottom']),
  }),
  'files.stage': z.strictObject({
    upload_id: handle,
    index: z.number().int().nonnegative(),
    total: z.number().int().min(1).max(MAX_UPLOAD_CHUNKS),
    data: z.string(),
  }),
  'page.upload': z.strictObject({
    snapshot_id: handle,
    element_id: handle,
    upload_id: handle,
    name: z.string().min(1).max(255),
    type: z.string().max(255).default(''),
  }),
  'sites.top': noArgs,
};

export type Op = keyof typeof requestSchemas;
export type ArgsOf<O extends Op> = z.output<(typeof requestSchemas)[O]>;
export type Request = { [O in Op]: { id: string; op: O; args: ArgsOf<O> } }[Op];

export const OPS = Object.keys(requestSchemas) as Op[];

function isOp(value: string): value is Op {
  return Object.hasOwn(requestSchemas, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type ParseResult =
  | { kind: 'request'; request: Request }
  | { kind: 'invalid'; id: string; error: ProtocolError }
  | { kind: 'ignored'; reason: string };

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

// A message without a string id cannot be answered, so it is not a request and is dropped.
// Anything with an id gets exactly one answer, even when it is malformed.
export function parseRequest(message: unknown): ParseResult {
  if (!isRecord(message)) return { kind: 'ignored', reason: 'message is not an object' };
  const { id, op, args } = message;
  if (typeof id !== 'string' || id.length === 0) {
    return { kind: 'ignored', reason: 'message has no string id' };
  }
  if (typeof op !== 'string' || !isOp(op)) {
    const shown = typeof op === 'string' ? op : JSON.stringify(op);
    return { kind: 'invalid', id, error: new ProtocolError('bad_request', `unknown op: ${shown}`) };
  }
  const rawArgs = args ?? {};
  if (!isRecord(rawArgs)) {
    return {
      kind: 'invalid',
      id,
      error: new ProtocolError('bad_request', 'args must be an object'),
    };
  }
  const parsed = requestSchemas[op].safeParse(rawArgs);
  if (!parsed.success) {
    return {
      kind: 'invalid',
      id,
      error: new ProtocolError('bad_request', `${op}: ${describeIssues(parsed.error)}`),
    };
  }
  return { kind: 'request', request: { id, op, args: parsed.data } as Request };
}

// Messages the extension sends.

export type ErrorBody = { code: ErrorCode; message: string };
export type Response =
  { id: string; ok: true; result: unknown } | { id: string; ok: false; error: ErrorBody };

export type TabsChangedReason = 'activated' | 'created' | 'removed' | 'updated';
export type TabsChangedEvent = {
  event: 'tabs.changed';
  data: { reason: TabsChangedReason; tab_id: number };
};

export type Hello = {
  hello: { protocol: typeof PROTOCOL_VERSION; extension: string; browser: string };
};

// Results.

export type TabInfo = {
  id: number;
  window_id: number;
  index: number;
  active: boolean;
  audible: boolean;
  title: string;
  url: string;
};

export type ElementKind =
  'link' | 'button' | 'input' | 'search' | 'tab' | 'option' | 'toggle' | 'other';

export type ListPosition = { group: string; index: number; size: number };

export type SnapshotElement = {
  id: string;
  role: string;
  name: string;
  kind: ElementKind;
  rect: [number, number, number, number];
  in_view: boolean;
  list?: ListPosition;
};

export type Viewport = {
  width: number;
  height: number;
  dpr: number;
  scroll_y: number;
  scroll_height: number;
};

// Where a document shows a frame: the URL the frame was asked to load, and its box in the
// document's viewport. The service worker places each frame's elements with it.
export type FrameBox = { url: string; rect: [number, number, number, number] };

// What the content script returns; the service worker adds tab_id, and keeps `frames` to
// itself.
export type PageSnapshot = {
  snapshot_id: string;
  url: string;
  title: string;
  headings: string;
  viewport: Viewport;
  elements: SnapshotElement[];
  frames?: FrameBox[];
};

export type Snapshot = PageSnapshot & { tab_id: number };

export type ScrollResult = { scroll_y: number; scroll_height: number };

// Between the service worker and the content script.

export type PageRequest =
  | { op: 'snapshot'; args: { snapshot_id: string; max: number; settle_ms: number } }
  | { op: 'click'; args: { snapshot_id: string; element_id: string } }
  | {
      op: 'type';
      args: { snapshot_id: string; element_id: string; text: string; submit: boolean };
    }
  | { op: 'scroll'; args: { direction: 'up' | 'down' | 'top' | 'bottom' } }
  | {
      op: 'upload';
      args: { snapshot_id: string; element_id: string; name: string; type: string; data: string };
    };

// What a page.upload answers: the file as the field now holds it.
export type UploadResult = { name: string; size: number; files: number };

export type PageResult = { ok: true; result: unknown } | { ok: false; error: ErrorBody };

export type PageAgent = {
  version: string;
  handle(op: string, args: unknown): Promise<PageResult>;
};

declare global {
  // Installed once per document by content.js, in the extension's isolated world.
  var __hypruseBrowser: PageAgent | undefined;
}
