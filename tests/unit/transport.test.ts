import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { RpcTransport } from '../../packages/codex-adapter/src/transport.ts';

function setup(options = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const sent: any[] = [];
  output.on('data', chunk => sent.push(JSON.parse(chunk.toString())));
  const rpc = new RpcTransport(input, output, options);
  const receive = (value: unknown) => input.write(JSON.stringify(value) + '\n');
  return { input, output, sent, rpc, receive };
}

describe('newline RPC transport', () => {
  it('matches reversed responses to their own requests', async () => {
    const { rpc, receive, sent } = setup();
    const first = rpc.request('one', {});
    const second = rpc.request('two', {});
    receive({ id: sent[1].id, result: 'second' });
    receive({ id: sent[0].id, result: 'first' });
    expect(await first).toBe('first');
    expect(await second).toBe('second');
    rpc.close();
  });

  it('preserves Chinese across UTF-8 byte chunks and multiple frames', async () => {
    const notifications: unknown[] = [];
    const { rpc, input, sent } = setup({ onNotification: (value: unknown) => notifications.push(value) });
    const pending = rpc.request('echo', {});
    const frame = Buffer.from(JSON.stringify({ id: sent[0].id, result: '研究资料' }) + '\n' + JSON.stringify({ method: 'done', params: {} }) + '\n');
    for (const byte of frame) input.write(Buffer.from([byte]));
    expect(await pending).toBe('研究资料');
    expect(notifications).toEqual([{ method: 'done', params: {} }]);
    rpc.close();
  });

  it('routes server requests separately and replies only once', () => {
    const requests: any[] = [];
    const { rpc, receive, sent } = setup({ onRequest: (value: unknown) => requests.push(value) });
    receive({ id: 'approval-1', method: 'approval', params: {} });
    expect(sent).toHaveLength(0);
    expect(requests[0].id).toBe('approval-1');
    rpc.reply('approval-1', { decision: 'decline' });
    expect(sent[0]).toEqual({ id: 'approval-1', result: { decision: 'decline' } });
    expect(() => rpc.reply('approval-1', {})).toThrow('UNKNOWN_SERVER_REQUEST');
    rpc.close();
  });

  it('rejects unsupported server requests without approval', () => {
    const { rpc, receive, sent } = setup();
    receive({ id: 0, method: 'unknown', params: {} });
    expect(sent[0]).toMatchObject({ id: 0, error: { code: -32601 } });
    rpc.close();
  });

  it('times out without resending and ignores a late response', async () => {
    const { rpc, sent, receive } = setup();
    await expect(rpc.request('write', {}, 15)).rejects.toThrow('RPC_TIMEOUT_RESULT_UNKNOWN');
    expect(sent).toHaveLength(1);
    receive({ id: sent[0].id, result: {} });
    rpc.close();
  });

  it('rejects pending and future requests after connection ends', async () => {
    const { rpc, input } = setup();
    const pending = rpc.request('write', {});
    input.end();
    await expect(pending).rejects.toThrow('RPC_CONNECTION_CLOSED');
    await expect(rpc.request('next', {})).rejects.toThrow('RPC_CONNECTION_CLOSED');
  });

  it.each(['not json\n', '[]\n', '{"id":1}\n'])('fails closed on malformed protocol %s', async frame => {
    const { rpc, input } = setup();
    const pending = rpc.request('one', {});
    input.write(frame);
    await expect(pending).rejects.toThrow('RPC_INVALID_FRAME');
  });

  it('bounds incomplete frame memory', async () => {
    const { rpc, input } = setup({ maxFrameBytes: 128 });
    const pending = rpc.request('one', {});
    input.write('x'.repeat(129));
    await expect(pending).rejects.toThrow('RPC_FRAME_TOO_LARGE');
  });

  it('surfaces error code without leaking server text', async () => {
    const { rpc, receive, sent } = setup();
    const pending = rpc.request('one', {});
    receive({ id: sent[0].id, error: { code: -32600, message: 'private credential text' } });
    await expect(pending).rejects.toThrow('RPC_REMOTE_ERROR_-32600');
    rpc.close();
  });
});
