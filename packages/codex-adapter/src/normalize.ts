import type { RpcNotification } from './transport.ts';
export type ResearchEvent = { type: string; payload: Record<string, unknown> };
export function normalize(message: RpcNotification, threadId: string): ResearchEvent | null {
  const p = message.params as Record<string, any> | undefined;
  if (!p || p.threadId !== threadId) return null;
  switch (message.method) {
    case 'turn/started': return { type: 'task.status.changed', payload: { status: 'running', turnId: p.turn?.id } };
    case 'turn/completed': {
      const status = p.turn?.status;
      if (!['completed', 'interrupted', 'failed'].includes(status)) return { type:'recovery.required', payload:{ reason:'UNKNOWN_TURN_STATUS' } };
      return { type:'task.status.changed', payload:{ status, turnId:p.turn.id } };
    }
    case 'item/agentMessage/delta': return typeof p.delta === 'string' ? { type:'message.delta',payload:{ id:p.itemId,text:p.delta } } : null;
    case 'item/completed':
      if (p.item?.type === 'agentMessage' && typeof p.item.text === 'string') return {type:'message.completed',payload:{id:p.item.id,text:p.item.text}};
      if (['commandExecution','fileChange','mcpToolCall','webSearch'].includes(p.item?.type)) return {type:'tool.status.changed',payload:{id:p.item.id,tool:p.item.type,status:p.item.status ?? 'completed'}};
      return null;
    case 'item/started':
      return ['commandExecution','fileChange','mcpToolCall','webSearch'].includes(p.item?.type) ? {type:'tool.status.changed',payload:{id:p.item.id,tool:p.item.type,status:'running'}} : null;
    case 'thread/tokenUsage/updated': {
      const total = p.tokenUsage?.total;
      const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
      return {type:'usage.updated',payload:{input:number(total?.inputTokens),output:number(total?.outputTokens),cachedRead:number(total?.cachedInputTokens),cachedWrite:null,cost:null,source:'codex thread/tokenUsage/updated',semantics:'cumulative'}};
    }
    default: return null;
  }
}
