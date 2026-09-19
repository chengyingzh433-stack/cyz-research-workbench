import { expect, it } from 'vitest';
import { normalize } from '../../packages/codex-adapter/src/normalize.ts';
it('only completes a task on a matching confirmed turn event', () => {
  expect(normalize({ method:'turn/completed', params:{threadId:'wrong',turn:{id:'t',status:'completed'}}}, 'mine')).toBeNull();
  expect(normalize({ method:'turn/completed', params:{threadId:'mine',turn:{id:'t',status:'interrupted'}}}, 'mine')).toMatchObject({ type:'task.status.changed', payload:{status:'interrupted'} });
});
it('does not expose reasoning or unknown events', () => {
  expect(normalize({method:'item/reasoning/textDelta',params:{threadId:'mine',delta:'private'}},'mine')).toBeNull();
  expect(normalize({method:'new-event',params:{threadId:'mine'}},'mine')).toBeNull();
});
it('preserves final public text independently of deltas', () => {
  expect(normalize({method:'item/completed',params:{threadId:'mine',item:{type:'agentMessage',id:'m',text:'完整答复'}}},'mine')).toMatchObject({type:'message.completed',payload:{id:'m',text:'完整答复'}});
});
it('does not fabricate unknown usage', () => {
  expect(normalize({method:'thread/tokenUsage/updated',params:{threadId:'mine',tokenUsage:{total:{inputTokens:12,outputTokens:4,cachedInputTokens:8}}}},'mine')).toMatchObject({payload:{input:12,output:4,cachedRead:8,cost:null}});
});
