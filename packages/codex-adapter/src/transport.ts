import type { Readable, Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

export type RpcId = number | string;
export type RpcNotification = { method: string; params?: unknown };
export type RpcServerRequest = RpcNotification & { id: RpcId };
type Options = {
  maxFrameBytes?: number;
  onNotification?: (message: RpcNotification) => void;
  onRequest?: (message: RpcServerRequest) => void;
  onClosed?: (reason: string) => void;
};
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class RpcTransport {
  private input: Readable;
  private output: Writable;
  private options: Options;
  private pending = new Map<RpcId, Pending>();
  private serverRequests = new Set<RpcId>();
  private nextId = 0;
  private closed = false;
  private buffer = '';
  private decoder = new StringDecoder('utf8');

  constructor(input: Readable, output: Writable, options: Options = {}) {
    this.input = input;
    this.output = output;
    this.options = options;
    input.on('data', this.onData);
    input.once('end', this.onEnd);
    input.once('error', this.onEnd);
    output.once('error', this.onEnd);
  }

  request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('RPC_CONNECTION_CLOSED'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('RPC_TIMEOUT_RESULT_UNKNOWN'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch { this.close('RPC_CONNECTION_CLOSED'); }
    });
  }

  notify(method: string, params: unknown = {}) { this.send({ method, params }); }

  reply(id: RpcId, result: unknown) {
    if (!this.serverRequests.has(id)) throw new Error('UNKNOWN_SERVER_REQUEST');
    this.send({ id, result });
    this.serverRequests.delete(id);
  }

  close(reason = 'RPC_CONNECTION_CLOSED') {
    if (this.closed) return;
    this.closed = true;
    this.input.off('data', this.onData);
    this.input.off('end', this.onEnd);
    // Retain error listeners until streams disappear so late pipe errors are harmless.
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
    this.serverRequests.clear();
    this.buffer = '';
    this.options.onClosed?.(reason);
  }

  private onEnd = () => this.close();

  private send(message: unknown) {
    if (this.closed) throw new Error('RPC_CONNECTION_CLOSED');
    this.output.write(JSON.stringify(message) + '\n', error => {
      if (error) this.close();
    });
  }

  private onData = (chunk: Buffer | string) => {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    const max = this.options.maxFrameBytes ?? 2 * 1024 * 1024;
    let newline: number;
    while (!this.closed && (newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (Buffer.byteLength(line) > max) { this.close('RPC_FRAME_TOO_LARGE'); return; }
      if (!line.trim()) continue;
      let value: unknown;
      try { value = JSON.parse(line); }
      catch { this.close('RPC_INVALID_FRAME'); return; }
      this.dispatch(value);
    }
    if (Buffer.byteLength(this.buffer) > max) this.close('RPC_FRAME_TOO_LARGE');
  };

  private dispatch(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      this.close('RPC_INVALID_FRAME'); return;
    }
    const frame = value as Record<string, unknown>;
    const hasId = typeof frame.id === 'number' || typeof frame.id === 'string';
    if (typeof frame.method === 'string') {
      if (hasId) {
        const request = frame as RpcServerRequest;
        if (this.serverRequests.has(request.id)) { this.close('RPC_INVALID_FRAME'); return; }
        if (this.options.onRequest) {
          this.serverRequests.add(request.id);
          this.options.onRequest(request);
        } else {
          this.send({ id: frame.id, error: { code: -32601, message: 'Unsupported client request' } });
        }
      } else this.options.onNotification?.(frame as RpcNotification);
      return;
    }
    if (!hasId || (('result' in frame) === ('error' in frame))) {
      this.close('RPC_INVALID_FRAME'); return;
    }
    const pending = this.pending.get(frame.id as RpcId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(frame.id as RpcId);
    if ('error' in frame) {
      const code = (frame.error as { code?: unknown } | null)?.code;
      pending.reject(new Error(`RPC_REMOTE_ERROR_${typeof code === 'number' ? code : 'UNKNOWN'}`));
    } else pending.resolve(frame.result);
  }
}
