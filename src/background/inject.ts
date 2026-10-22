import {
  ERROR_CODES,
  ProtocolError,
  type ErrorCode,
  type PageRequest,
  type PageResult,
} from '../shared/protocol';
import type { ResolvedTab } from './tabs';

export const CONTENT_FILE = 'content.js';

// Runs code in a tab's frames, in the extension's isolated world: the top frame unless a
// frame id is given.
export type ScriptRunner = {
  // Installs content.js; a second install in the same document is a no-op.
  inject(tabId: number, frameId?: number): Promise<void>;
  // Calls the installed agent. Resolves to null when no agent of this version is installed.
  call(tabId: number, request: PageRequest, version: string, frameId?: number): Promise<unknown>;
  // Installs content.js in every frame that will take it and calls each agent, answering
  // per frame. Frames the browser will not script are left out.
  callFrames?(
    tabId: number,
    request: PageRequest,
    version: string,
  ): Promise<{ frameId: number; result: unknown }[]>;
};

export type PageRun = (
  tab: ResolvedTab,
  request: PageRequest,
  frameId?: number,
) => Promise<unknown>;
export type FrameRun = (
  tab: ResolvedTab,
  request: PageRequest,
) => Promise<{ frameId: number; result: unknown }[]>;

// Pages Chrome never lets an extension script, recognised before trying.
const RESTRICTED_URLS = [
  /^(chrome|chrome-extension|chrome-untrusted|chrome-search|devtools|edge|brave|opera|vivaldi|view-source):/i,
  /^about:(?!blank|srcdoc)/i,
  /^https:\/\/chromewebstore\.google\.com\//i,
  /^https:\/\/chrome\.google\.com\/webstore/i,
  /^https:\/\/microsoftedge\.microsoft\.com\/addons/i,
];

export function isRestrictedUrl(url: string): boolean {
  return RESTRICTED_URLS.some((pattern) => pattern.test(url));
}

// executeScript reports refusals only as messages, so they are matched by their wording.
export function injectionError(error: unknown): ProtocolError {
  if (error instanceof ProtocolError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/no tab with id/i.test(message)) return new ProtocolError('not_found', message);
  // a frame that navigated away or was removed since the snapshot named its element
  if (/no frame with id/i.test(message)) {
    return new ProtocolError('stale_snapshot', `the frame is gone: ${message}`);
  }
  if (
    /cannot access|cannot be scripted|must request permission|error page|extensions gallery|different extension/i.test(
      message,
    )
  ) {
    return new ProtocolError('restricted_page', message);
  }
  return new ProtocolError('internal', message);
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

function isPageResult(value: unknown): value is PageResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as { ok?: unknown; error?: { code?: unknown; message?: unknown } };
  if (result.ok === true) return 'result' in result;
  return result.ok === false && typeof result.error?.message === 'string';
}

// Runs one page operation in a tab: calls the agent, installs content.js first when the
// document has none, and turns the agent's answer back into a result or a ProtocolError.
export function createPageRunner(runner: ScriptRunner, version: string): PageRun {
  return async (tab, request, frameId) => {
    if (tab.url && isRestrictedUrl(tab.url)) {
      const scheme = tab.url.split(':')[0] ?? 'this';
      throw new ProtocolError(
        'restricted_page',
        `the browser does not let extensions script ${scheme} pages`,
      );
    }
    let answer: unknown;
    try {
      answer = await runner.call(tab.id, request, version, frameId);
      if (answer === null || answer === undefined) {
        await runner.inject(tab.id, frameId);
        answer = await runner.call(tab.id, request, version, frameId);
      }
    } catch (error) {
      throw injectionError(error);
    }
    if (!isPageResult(answer)) throw new ProtocolError('internal', 'the page gave no answer');
    if (answer.ok) return answer.result;
    const code = isErrorCode(answer.error.code) ? answer.error.code : 'internal';
    throw new ProtocolError(code, answer.error.message);
  };
}

// Runs one page operation in every frame below the top one, for a snapshot that covers the
// page's frames. Best effort: a frame that cannot be scripted, or answers with an error, is
// left out rather than failing the whole snapshot, and a page whose top frame cannot be
// scripted has already failed in the PageRun.
export function createFrameRunner(runner: ScriptRunner, version: string): FrameRun {
  return async (tab, request) => {
    if (!runner.callFrames || (tab.url && isRestrictedUrl(tab.url))) return [];
    let answers: { frameId: number; result: unknown }[];
    try {
      answers = await runner.callFrames(tab.id, request, version);
    } catch {
      return [];
    }
    return answers
      .filter(({ frameId, result }) => frameId !== 0 && isPageResult(result) && result.ok)
      .map(({ frameId, result }) => ({ frameId, result: (result as { result: unknown }).result }));
  };
}
