import {describe,it,expect} from 'vitest';
import {normalizeWorkspaceLayout,WORKSPACE_PRESETS,DASHBOARD_MODULES} from './workspace-layout';
describe('workspace layout',()=>{
 it('upgrades missing settings and rejects unknown values',()=>{
  expect(normalizeWorkspaceLayout(null)).toMatchObject({preset:'collector',navigation:'side',sidebarWidth:260});
  expect(normalizeWorkspaceLayout({navigation:'script',logoSize:999,cardSize:'huge'})).toMatchObject({navigation:'side',logoSize:40,cardSize:'medium'});
 });
 it('repairs module order without duplicates or losing panels',()=>{
  const value=normalizeWorkspaceLayout({dashboardOrder:['sets','sets','bad','recent']});
  expect(value.dashboardOrder.slice(0,2)).toEqual(['sets','recent']);
  expect([...value.dashboardOrder].sort()).toEqual([...DASHBOARD_MODULES].sort());
 });
 it('provides six valid presets and isolated defaults',()=>{
  expect(WORKSPACE_PRESETS.map(x=>x.id)).toEqual(['collector','gallery','compact','paper','night-studio','soft-glass']);
  for(const p of WORKSPACE_PRESETS) expect(normalizeWorkspaceLayout(p.layout).preset).toBe(p.id);
  const one=normalizeWorkspaceLayout(null);one.dashboardOrder.reverse();
  expect(normalizeWorkspaceLayout(null).dashboardOrder).toEqual(DASHBOARD_MODULES);
 });
});
it('preserves account-specific personal layout and can follow the site again',async()=>{
 const{writeWorkspaceLayout,readWorkspaceLayout}=await import('./workspace-layout');
 localStorage.clear();expect(writeWorkspaceLayout(normalizeWorkspaceLayout({view:'list'}),'one')).toBe(true);
 expect(readWorkspaceLayout('one')?.view).toBe('list');expect(readWorkspaceLayout('two')).toBeNull();
 expect(writeWorkspaceLayout(null,'one')).toBe(true);expect(readWorkspaceLayout('one')).toBeNull();
});
