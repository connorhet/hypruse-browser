import { parseRequest, ProtocolError, type ParseResult } from '../../src/shared/protocol';

function expectInvalid(result: ParseResult, pattern: RegExp): void {
  expect(result.kind).toBe('invalid');
  if (result.kind !== 'invalid') return;
  expect(result.error).toBeInstanceOf(ProtocolError);
  expect(result.error.code).toBe('bad_request');
  expect(result.error.message).toMatch(pattern);
}

describe('parseRequest', () => {
  it('accepts a request without args', () => {
    expect(parseRequest({ id: 'h1', op: 'tabs.list' })).toEqual({
      kind: 'request',
      request: { id: 'h1', op: 'tabs.list', args: {} },
    });
  });

  it('fills the snapshot defaults', () => {
    expect(parseRequest({ id: 'h2', op: 'page.snapshot', args: {} })).toEqual({
      kind: 'request',
      request: { id: 'h2', op: 'page.snapshot', args: { max: 120, settle_ms: 0 } },
    });
  });

  it('keeps explicit snapshot arguments', () => {
    const result = parseRequest({
      id: 'h3',
      op: 'page.snapshot',
      args: { tab_id: 12, max: 40, settle_ms: 1500 },
    });
    expect(result).toMatchObject({ request: { args: { tab_id: 12, max: 40, settle_ms: 1500 } } });
  });

  it('defaults submit to false when typing', () => {
    const result = parseRequest({
      id: 'h4',
      op: 'page.type',
      args: { snapshot_id: 's1', element_id: 'e3', text: 'lofi' },
    });
    expect(result).toMatchObject({ request: { args: { submit: false } } });
  });

  it('ignores messages it cannot answer', () => {
    expect(parseRequest(null).kind).toBe('ignored');
    expect(parseRequest('ping').kind).toBe('ignored');
    expect(parseRequest([]).kind).toBe('ignored');
    expect(parseRequest({ op: 'ping' }).kind).toBe('ignored');
    expect(parseRequest({ id: 7, op: 'ping' }).kind).toBe('ignored');
    expect(parseRequest({ id: '', op: 'ping' }).kind).toBe('ignored');
  });

  it('rejects an unknown op', () => {
    expectInvalid(parseRequest({ id: 'h5', op: 'tabs.explode' }), /unknown op: tabs\.explode/);
    expectInvalid(parseRequest({ id: 'h6' }), /unknown op/);
    expectInvalid(parseRequest({ id: 'h7', op: 'toString' }), /unknown op: toString/);
  });

  it('rejects args that are not an object', () => {
    expectInvalid(parseRequest({ id: 'h8', op: 'ping', args: [1] }), /args must be an object/);
    expectInvalid(parseRequest({ id: 'h9', op: 'ping', args: 'x' }), /args must be an object/);
  });

  it('rejects missing and mistyped arguments', () => {
    expectInvalid(parseRequest({ id: 'a', op: 'tabs.activate', args: {} }), /tab_id/);
    expectInvalid(parseRequest({ id: 'b', op: 'tabs.activate', args: { tab_id: '12' } }), /tab_id/);
    expectInvalid(parseRequest({ id: 'c', op: 'tabs.close', args: { tab_id: 1.5 } }), /tab_id/);
    expectInvalid(
      parseRequest({ id: 'd', op: 'tabs.open', args: { url: 'https://example.com' } }),
      /where/,
    );
    expectInvalid(
      parseRequest({ id: 'e', op: 'tabs.history', args: { tab_id: 1, direction: 'sideways' } }),
      /direction/,
    );
    expectInvalid(
      parseRequest({ id: 'f', op: 'page.type', args: { snapshot_id: 's1', element_id: 'e1' } }),
      /text/,
    );
    expectInvalid(parseRequest({ id: 'g', op: 'page.scroll', args: {} }), /direction/);
  });

  it('rejects out of range snapshot limits', () => {
    expectInvalid(parseRequest({ id: 'a', op: 'page.snapshot', args: { max: 0 } }), /max/);
    expectInvalid(parseRequest({ id: 'b', op: 'page.snapshot', args: { max: 5000 } }), /max/);
    expectInvalid(
      parseRequest({ id: 'c', op: 'page.snapshot', args: { settle_ms: -1 } }),
      /settle_ms/,
    );
    expectInvalid(
      parseRequest({ id: 'd', op: 'page.snapshot', args: { settle_ms: 60_000 } }),
      /settle_ms/,
    );
  });

  it('rejects unknown argument names so typos do not fall back to defaults', () => {
    expectInvalid(parseRequest({ id: 'a', op: 'page.snapshot', args: { tabId: 3 } }), /tabId/);
    expectInvalid(parseRequest({ id: 'b', op: 'ping', args: { verbose: true } }), /verbose/);
  });
});
