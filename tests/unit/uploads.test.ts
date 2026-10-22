import { MAX_STAGED, Staging, STAGE_TTL_MS } from '../../src/background/uploads';
import { MAX_UPLOAD_BYTES, ProtocolError } from '../../src/shared/protocol';

function codeOf(work: () => unknown): string {
  try {
    work();
  } catch (error) {
    if (error instanceof ProtocolError) return error.code;
    throw error;
  }
  throw new Error('expected a ProtocolError');
}

describe('Staging', () => {
  it('assembles chunks that arrive in any order, once', () => {
    const staging = new Staging();
    expect(staging.stage('u1', 1, 2, 'bG8=')).toEqual({ received: 1 });
    expect(staging.stage('u1', 0, 2, 'aGVs')).toEqual({ received: 2 });
    expect(staging.take('u1')).toBe('aGVsbG8=');
    expect(codeOf(() => staging.take('u1'))).toBe('not_found');
  });

  it('refuses an upload with a chunk missing, and forgets it', () => {
    const staging = new Staging();
    staging.stage('u1', 0, 2, 'aGVs');
    expect(codeOf(() => staging.take('u1'))).toBe('bad_request');
    expect(codeOf(() => staging.take('u1'))).toBe('not_found');
  });

  it('refuses chunks that do not fit the upload', () => {
    const staging = new Staging();
    expect(codeOf(() => staging.stage('u1', 2, 2, ''))).toBe('bad_request');
    staging.stage('u1', 0, 2, 'aGVs');
    expect(codeOf(() => staging.stage('u1', 1, 3, 'bG8='))).toBe('bad_request');
  });

  it('refuses an upload over the size limit, and drops what it had', () => {
    const staging = new Staging();
    const chunk = 'A'.repeat(((MAX_UPLOAD_BYTES / 2) * 4) / 3 + 8); // just over half each
    staging.stage('big', 0, 2, chunk);
    expect(codeOf(() => staging.stage('big', 1, 2, chunk))).toBe('refused');
    expect(codeOf(() => staging.take('big'))).toBe('not_found');
  });

  it('forgets uploads nobody took and limits how many wait', () => {
    let now = 0;
    const staging = new Staging(() => now);
    for (let i = 0; i < MAX_STAGED; i += 1) staging.stage(`u${i}`, 0, 2, 'aGVs');
    expect(codeOf(() => staging.stage('one-more', 0, 1, 'aGVs'))).toBe('refused');
    now = STAGE_TTL_MS + 1;
    expect(staging.stage('one-more', 0, 1, 'aGVs')).toEqual({ received: 1 });
    expect(codeOf(() => staging.take('u0'))).toBe('not_found');
  });
});
