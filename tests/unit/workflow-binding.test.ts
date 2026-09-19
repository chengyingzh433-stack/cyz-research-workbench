import {expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {workflowSkillPath,workflowTurnInput} from '../../packages/workflow-adapter/src/skill-binding.ts';
it('resolves the pinned workflow in the selected Codex home',()=>{
  const home=mkdtempSync(join(tmpdir(),'cyz skill '));const root=join(home,'skills/cyz-edu-research');mkdirSync(root,{recursive:true});
  writeFileSync(join(root,'SKILL.md'),'---\nname: cyz-edu-research\n---');writeFileSync(join(root,'VERSION'),'0.3.0\n');
  expect(workflowSkillPath(home)).toBe(join(root,'SKILL.md'));
  writeFileSync(join(root,'VERSION'),'0.4.0');expect(()=>workflowSkillPath(home)).toThrow('WORKFLOW_VERSION_UNVERIFIED');
});
it('requires enabled discovery and explicitly passes the workflow to Codex',()=>{
  const path=resolve('test-skill/SKILL.md'),cwd=resolve('run');
  const catalog={data:[{cwd,skills:[{name:'cyz-edu-research',path,enabled:true}],errors:[]}]};
  expect(workflowTurnInput('继续研究',path,cwd,catalog)).toEqual([{type:'text',text:'$cyz-edu-research\n继续研究',text_elements:[]},{type:'skill',name:'cyz-edu-research',path}]);
  catalog.data[0].skills[0].enabled=false;expect(()=>workflowTurnInput('继续',path,cwd,catalog)).toThrow('WORKFLOW_NOT_DISCOVERED');
});
