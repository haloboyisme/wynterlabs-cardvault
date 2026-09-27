import {it,expect,beforeEach,vi} from 'vitest';
import {exportWorkspacePreset,importWorkspacePreset,saveNamedPreset,readNamedPresets} from './workspace-presets';
import {brandDesign} from './brand-design';
beforeEach(()=>localStorage.clear());
it('exports only design fields and round trips',()=>{
 const text=exportWorkspacePreset({...brandDesign(),token:'secret',email:'private'} as any,'Mine');
 expect(text).not.toContain('secret');expect(text).not.toContain('private');
 expect(importWorkspacePreset(text).design.workspace.preset).toBe('collector');
});
it('rejects bad imports and oversized files',()=>{
 for(const text of ['oops',JSON.stringify({version:7,design:{}}),JSON.stringify({version:1,design:{accent:'javascript:bad'}}),' '.repeat(4000001)])expect(()=>importWorkspacePreset(text)).toThrow();
});
it('saves by account and does not lose existing presets on storage failure',()=>{
 saveNamedPreset('u1',{name:'One',design:brandDesign()});expect(readNamedPresets('u2')).toEqual([]);
 const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('full')});
 expect(()=>saveNamedPreset('u1',{name:'Two',design:brandDesign()})).toThrow();spy.mockRestore();
 expect(readNamedPresets('u1').map(x=>x.name)).toEqual(['One']);
});
it('rejects oversized image dimensions',()=>{
 const bytes='\x89PNG\r\n\x1a\n'+'\0'.repeat(8)+'\x00\x01\x86\xa0'+'\x00\x01\x86\xa0';
 const design=brandDesign({background:{preset:'none',upload:'data:image/png;base64,'+btoa(bytes),still:'',opacity:.35,position:'center',size:'cover'}});
 expect(()=>importWorkspacePreset(JSON.stringify({version:1,design}))).toThrow();
});
