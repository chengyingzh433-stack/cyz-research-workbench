import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { RpcTransport } from '../packages/codex-adapter/src/transport.ts';
import type { InitializeParams } from '../packages/codex-adapter/generated/InitializeParams.ts';
import type { GetAccountParams } from '../packages/codex-adapter/generated/v2/GetAccountParams.ts';

const executable = process.env.CYZ_CODEX_EXE;
if (!executable) throw new Error('Set CYZ_CODEX_EXE to the verified native Codex executable');
const version = execFileSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
const proc = spawn(executable, ['app-server', '--stdio'], {
  shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
});
let stderrBytes = 0;
proc.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; });
const notifications = new Set<string>();
const rpc = new RpcTransport(proc.stdout, proc.stdin, {
  onNotification: event => notifications.add(event.method),
});
proc.once('error', () => rpc.close('CODEX_PROCESS_ERROR'));
proc.once('exit', () => rpc.close());

try {
  const params: InitializeParams = {
    clientInfo: { name: 'cyz_workbench_probe', title: 'CYZ Workbench compatibility probe', version: '0.1.0' },
    capabilities: { experimentalApi: false, requestAttestation: false, optOutNotificationMethods: null },
  };
  const initialized = await rpc.request('initialize', params) as Record<string, unknown>;
  if (initialized.platformOs !== 'windows') throw new Error('UNEXPECTED_PLATFORM');
  rpc.notify('initialized');
  const accountParams: GetAccountParams = { refreshToken: false };
  const account = await rpc.request('account/read', accountParams) as Record<string, unknown>;
  if (typeof account.requiresOpenaiAuth !== 'boolean' || !('account' in account)) throw new Error('INVALID_ACCOUNT_RESPONSE');
  const generatedRoot = resolve('packages/codex-adapter/generated');
  const entries: { path: string; sha256: string }[] = [];
  async function inventory(directory: string) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (item.isDirectory()) await inventory(path);
      else entries.push({ path: relative(generatedRoot, path).replaceAll('\\', '/'), sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
    }
  }
  await inventory(generatedRoot);
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const report = {
    schemaVersion: 1, recordedAt: new Date().toISOString(), cliVersion: version,
    nodeVersion: process.version, platform: process.platform,
    initialization: 'passed', accountRead: 'passed', authenticated: account.account !== null,
    modelTurnsStarted: 0, notifications: [...notifications], stderrBytes,
    rawStderrRetained: false, privateAccountFieldsRetained: false,
    generationCommand: 'codex app-server generate-ts --out packages/codex-adapter/generated',
    generatedFileCount: entries.length,
    protocolInventorySha256: createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
    notYetVerified: ['turn/start', 'turn/interrupt', 'thread/resume', 'user input', 'approvals', 'sandbox writes'],
  };
  await mkdir('docs/acceptance', { recursive: true });
  await writeFile('docs/acceptance/protocol-inventory.json', JSON.stringify(entries, null, 2) + '\n');
  await writeFile('docs/acceptance/codex-probe.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  rpc.close();
  proc.stdin.end();
  const killTimer = setTimeout(() => proc.kill(), 3000);
  proc.once('exit', () => clearTimeout(killTimer));
  killTimer.unref();
}
