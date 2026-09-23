import {
  ERROR_CODES,
  ProtocolError,
  type ErrorCode,
  type PageRequest,
  type PageResult,
} from '../shared/protocol';
import type { ResolvedTab } from './tabs';

export const CONTENT_FILE = 'content.js';

// Runs code in a tab's top frame, in the extension's isolated world.
export type ScriptRunner = {
  // Installs content.js; a second install in the same document is a no-op.
  inject(tabId: number): Promise<void>;
  // Calls the installed agent. Resolves to null when no agent of this version is installed.
  call(tabId: number, request: PageRequest, version: string): Promise<unknown>;
};

export type PageRun = (tab: ResolvedTab, request: PageRequest) => Promise<unknown>;

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
  return async (tab, request) => {
    if (tab.url && isRestrictedUrl(tab.url)) {
      const scheme = tab.url.split(':')[0] ?? 'this';
      throw new ProtocolError(
        'restricted_page',
        `the browser does not let extensions script ${scheme} pages`,
      );
    }
    let answer: unknown;
    try {
      answer = await runner.call(tab.id, request, version);
      if (answer === null || answer === undefined) {
        await runner.inject(tab.id);
        answer = await runner.call(tab.id, request, version);
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
