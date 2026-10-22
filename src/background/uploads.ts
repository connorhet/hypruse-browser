import { MAX_UPLOAD_BYTES, ProtocolError } from '../shared/protocol';
import type { Handlers } from './dispatch';

type Staged = { chunks: (string | undefined)[]; bytes: number; at: number };

// How long a staged upload waits for its page.upload, and how many may wait at once.
export const STAGE_TTL_MS = 60_000;
export const MAX_STAGED = 4;

// The decoded size of a base64 string, without decoding it.
function decodedSize(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

// Chunks of a file on their way to a page, kept in the service worker until page.upload takes
// them. Base64, each under Chrome's 1 MB cap on a message from the host.
export class Staging {
  private uploads = new Map<string, Staged>();

  constructor(private readonly now: () => number = Date.now) {}

  stage(uploadId: string, index: number, total: number, data: string): { received: number } {
    for (const [id, staged] of this.uploads) {
      if (this.now() - staged.at > STAGE_TTL_MS) this.uploads.delete(id);
    }
    if (index >= total) {
      throw new ProtocolError('bad_request', `chunk ${index} of an upload of ${total} chunks`);
    }
    let staged = this.uploads.get(uploadId);
    if (staged && staged.chunks.length !== total) {
      throw new ProtocolError('bad_request', `upload ${uploadId} was staged with another total`);
    }
    if (!staged) {
      if (this.uploads.size >= MAX_STAGED) {
        throw new ProtocolError('refused', 'too many uploads are waiting; finish one first');
      }
      staged = { chunks: new Array<string | undefined>(total).fill(undefined), bytes: 0, at: 0 };
      this.uploads.set(uploadId, staged);
    }
    const bytes = staged.bytes - decodedSize(staged.chunks[index] ?? '') + decodedSize(data);
    if (bytes > MAX_UPLOAD_BYTES) {
      this.uploads.delete(uploadId);
      throw new ProtocolError(
        'refused',
        `an upload is limited to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`,
      );
    }
    staged.chunks[index] = data;
    staged.bytes = bytes;
    staged.at = this.now();
    return { received: staged.chunks.filter((chunk) => chunk !== undefined).length };
  }

  // The whole file, once every chunk is in; the upload is forgotten either way.
  take(uploadId: string): string {
    const staged = this.uploads.get(uploadId);
    this.uploads.delete(uploadId);
    if (!staged) throw new ProtocolError('not_found', `no staged upload ${uploadId}`);
    if (staged.chunks.some((chunk) => chunk === undefined)) {
      throw new ProtocolError('bad_request', `upload ${uploadId} is missing chunks`);
    }
    return staged.chunks.join('');
  }
}

export function createStagingHandlers(staging: Staging): Pick<Handlers, 'files.stage'> {
  return {
    // a refusal thrown here is still one failed request: the dispatcher catches it
    'files.stage': ({ upload_id, index, total, data }) =>
      Promise.resolve(staging.stage(upload_id, index, total, data)),
  };
}
