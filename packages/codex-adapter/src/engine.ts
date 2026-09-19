import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RpcTransport, type RpcServerRequest } from './transport.ts';
import { normalize, type ResearchEvent } from './normalize.ts';
import {assertIsolation,runSandbox} from './isolation.ts';
import type { InitializeParams } from '../generated/InitializeParams.ts';
import type { ThreadStartParams } from '../generated/v2/ThreadStartParams.ts';
import type { TurnStartParams } from '../generated/v2/TurnStartParams.ts';
import type { ThreadResumeParams } from '../generated/v2/ThreadResumeParams.ts';
import type {ThreadReadResponse} from '../generated/v2/ThreadReadResponse.ts';
import type {RuntimeInspection} from '../../project-service/src/recovery.ts';
import {workflowSkillPath,workflowTurnInput} from '../../workflow-adapter/src/skill-binding.ts';
import type {SkillsListResponse} from '../generated/v2/SkillsListResponse.ts';

export function findCodex() {
  const explicit = process.env.CYZ_CODEX_EXE;
  if (explicit && existsSync(explicit)) return explicit;
  const candidate = join(process.env.APPDATA ?? '', 'npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
  if (existsSync(candidate)) return candidate;
  throw new Error('CODEX_NOT_FOUND');
}

export class CodexEngine {
  private process?: ChildProcessWithoutNullStreams;
  private rpc?: RpcTransport;
  private threadId?: string;
  private turnId?: string;
  private onEvent: (event: ResearchEvent) => void;
  private requests = new Map<string, RpcServerRequest>();
  private stopping = false;
  private busy = false;
  private closing = false;

  constructor(onEvent: (event: ResearchEvent) => void) { this.onEvent = onEvent; }
  async connect() {
    if (this.rpc) return;
    this.process = spawn(findCodex(), ['app-server', '--stdio'], { windowsHide:true, shell:false, stdio:['pipe','pipe','pipe'] });
    // Drain stderr without retaining authentication, personal paths, or raw diagnostics.
    this.process.stderr.on('data', () => {});
    this.rpc = new RpcTransport(this.process.stdout, this.process.stdin, {
      onNotification: message => {
        if (!this.threadId) return;
        const event = normalize(message, this.threadId);
        if (!event) return;
        if (event.type === 'task.status.changed') {
          if (typeof event.payload.turnId === 'string') this.turnId = event.payload.turnId;
          if (['completed','interrupted','failed'].includes(String(event.payload.status))) this.busy = false;
          if (this.stopping && event.payload.status === 'running') { void this.stop().catch(() => this.onEvent({type:'recovery.required',payload:{reason:'STOP_UNCONFIRMED'}})); }
        }
        this.onEvent(event);
      },
      onRequest: request => {
        const params = request.params as Record<string,unknown> | undefined;
        const supported = ['item/tool/requestUserInput','item/commandExecution/requestApproval','item/fileChange/requestApproval'];
        if (!params || !supported.includes(request.method) || params.threadId !== this.threadId) {
          this.onEvent({type:'recovery.required',payload:{reason:'UNSUPPORTED_SERVER_REQUEST',method:request.method}});
          // Close the connection instead of accidentally approving unsupported requests.
          this.rpc?.close('UNSUPPORTED_SERVER_REQUEST');
          this.process?.stdin.end();
          return;
        }
        const id = String(request.id);
        this.requests.set(id, request);
        this.onEvent({type:'decision.requested',payload:{id,kind:request.method === 'item/tool/requestUserInput' ? 'research' : 'approval',questions:params.questions ?? null,reason:typeof params.reason === 'string' ? params.reason : null,revision:1}});
      },
      onClosed: () => { if (!this.closing && this.busy) this.onEvent({type:'recovery.required',payload:{reason:'CODEX_CONNECTION_CLOSED'}}); },
    });
    this.process.once('error', () => this.rpc?.close('CODEX_PROCESS_ERROR'));
    this.process.once('exit', () => this.rpc?.close());
    const params: InitializeParams = {clientInfo:{name:'cyz_research_workbench',title:'CYZ Research Workbench',version:'0.1.0'},capabilities:{experimentalApi:false,requestAttestation:false}};
    await this.rpc.request('initialize', params);
    this.rpc.notify('initialized');
  }

  async start(cwd: string, prompt: string, existingThreadId?: string) {
    if (this.busy) throw new Error('TASK_ALREADY_RUNNING');
    this.busy = true; this.stopping = false; this.turnId = undefined; this.requests.clear();
    try {
      const skillPath=workflowSkillPath();
      await this.connect();
      const catalog=await this.rpc!.request('skills/list',{cwds:[resolve(cwd)],forceReload:true}) as SkillsListResponse;
      const input=workflowTurnInput(prompt,skillPath,cwd,catalog);
      const common = {cwd:resolve(cwd),approvalPolicy:'on-request' as const,sandbox:'workspace-write' as const,config:{sandbox_workspace_write:{writable_roots:[resolve(cwd)],network_access:false,exclude_tmpdir_env_var:true,exclude_slash_tmp:true}}};
      // Stable API uses kebab-case SandboxMode as generated by the local runtime.
      const request: ThreadStartParams | ThreadResumeParams = existingThreadId ? {...common,threadId:existingThreadId} : {...common,developerInstructions:'Use only this task workspace for edits. Do not use subagents or goal mode. Preserve facts and ask the user about consequential research decisions. Never publish directly into the parent project.'};
      const result = await this.rpc!.request(existingThreadId ? 'thread/resume' : 'thread/start', request) as any;
      if (!result.thread?.id) throw new Error('INVALID_THREAD_RESPONSE');
      assertIsolation(cwd,result);
      this.threadId = result.thread.id;
      this.onEvent({type:'session.started',payload:{threadId:this.threadId,model:result.model,sandbox:result.sandbox.type}});
      const turn: TurnStartParams = {threadId:this.threadId!,input,sandboxPolicy:runSandbox(cwd)};
      const response = await this.rpc!.request('turn/start', turn) as any;
      if (!response.turn?.id) throw new Error('INVALID_TURN_RESPONSE');
      this.turnId = response.turn.id;
      if (this.stopping && this.busy) await this.stop();
      return {threadId:this.threadId,turnId:this.turnId};
    } catch (error) {
      this.busy = false;
      this.onEvent({type:'recovery.required',payload:{reason:error instanceof Error ? error.message : 'CODEX_START_UNKNOWN'}});
      throw error;
    }
  }

  async inspect(threadId:string):Promise<RuntimeInspection>{
    await this.connect();
    const result=await this.rpc!.request('thread/read',{threadId,includeTurns:true}) as ThreadReadResponse;
    if(result.thread?.id!==threadId||!Array.isArray(result.thread.turns)||typeof result.thread.cwd!=='string')throw new Error('INVALID_THREAD_READ');
    return {threadId:result.thread.id,cwd:result.thread.cwd,turns:result.thread.turns.map(turn=>({id:turn.id,status:turn.status,messages:turn.items.flatMap(item=>item.type==='agentMessage'?[{id:item.id,text:item.text}]:[])}))};
  }

  async stop() {
    if(!this.busy)return;
    this.stopping = true;
    this.onEvent({type:'task.status.changed',payload:{status:'stopping'}});
    if (!this.rpc || !this.threadId || !this.turnId) return;
    await this.rpc.request('turn/interrupt',{threadId:this.threadId,turnId:this.turnId},15_000);
  }

  answer(id: string, revision: number, answer: unknown) {
    if (revision !== 1) throw new Error('STALE_DECISION');
    const request = this.requests.get(id);
    if (!request || !this.rpc) throw new Error('DECISION_EXPIRED');
    if (request.method === 'item/tool/requestUserInput') {
      if (!answer || typeof answer !== 'object' || !('answers' in answer)) throw new Error('INVALID_ANSWER');
      this.rpc.reply(request.id, answer);
    } else {
      if (answer !== 'accept' && answer !== 'decline') throw new Error('INVALID_APPROVAL');
      this.rpc.reply(request.id,{decision:answer});
    }
    this.requests.delete(id);
    this.onEvent({type:'decision.resolved',payload:{id}});
  }

  close() {
    this.closing = true;
    this.rpc?.close();
    this.process?.stdin.end();
    const child = this.process;
    const timer = setTimeout(() => { if (child && child.exitCode === null) child.kill(); },3000);
    timer.unref(); child?.once('exit',() => clearTimeout(timer));
    this.requests.clear();
  }
}
