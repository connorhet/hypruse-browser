import type { PageAgent, PageRequest, PageResult } from '../shared/protocol';
import { click } from './click';
import { PageError } from './errors';
import type { Geometry } from './geometry';
import { Registry } from './registry';
import { scroll } from './scroll';
import { settle } from './settle';
import { takeSnapshot } from './snapshot';
import { typeText } from './type';

// The object content.js installs in each document. The service worker calls handle() through
// chrome.scripting.executeScript with arguments it has already validated.
export function createAgent(doc: Document, geometry: Geometry, version: string): PageAgent {
  const registry = new Registry(doc);

  async function run(request: PageRequest): Promise<unknown> {
    switch (request.op) {
      case 'snapshot': {
        await settle(doc, request.args.settle_ms);
        const { snapshot, handles } = takeSnapshot(doc, geometry, {
          snapshotId: request.args.snapshot_id,
          max: request.args.max,
        });
        registry.replace(request.args.snapshot_id, handles);
        return snapshot;
      }
      case 'click':
        click(registry.resolve(request.args.snapshot_id, request.args.element_id), geometry);
        return {};
      case 'type':
        typeText(
          registry.resolve(request.args.snapshot_id, request.args.element_id),
          request.args.text,
          request.args.submit,
        );
        return {};
      case 'scroll':
        return scroll(doc, geometry, request.args.direction);
      default:
        throw new PageError(
          'bad_request',
          `unknown page op: ${String((request as { op: unknown }).op)}`,
        );
    }
  }

  return {
    version,
    async handle(op, args): Promise<PageResult> {
      try {
        return { ok: true, result: await run({ op, args } as PageRequest) };
      } catch (error) {
        if (error instanceof PageError) {
          return { ok: false, error: { code: error.code, message: error.message } };
        }
        const message = error instanceof Error ? error.message || error.name : String(error);
        return { ok: false, error: { code: 'internal', message } };
      }
    },
  };
}
