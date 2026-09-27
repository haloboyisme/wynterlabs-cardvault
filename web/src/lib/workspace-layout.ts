export const DASHBOARD_MODULES=['history','recent','decks','sets','attention'] as const;
export type DashboardModule=typeof DASHBOARD_MODULES[number];
export interface WorkspaceLayout {
 preset:'collector'|'gallery'|'compact'|'paper'|'night-studio'|'soft-glass';
 navigation:'side'|'top';sidebarWidth:220|260|300;density:'compact'|'comfortable'|'spacious';
 cardSize:'small'|'medium'|'large';view:'grid'|'list';logoSize:32|40|48|56;
 dashboardOrder:DashboardModule[];hiddenModules:DashboardModule[];
}
const defaults:WorkspaceLayout={preset:'collector',navigation:'side',sidebarWidth:260,density:'comfortable',cardSize:'medium',view:'grid',logoSize:40,dashboardOrder:[...DASHBOARD_MODULES],hiddenModules:[]};
export function normalizeWorkspaceLayout(value:unknown):WorkspaceLayout{
 const v=value&&typeof value==='object'?value as Record<string,unknown>:{};
 const pick=<T,>(key:string,values:readonly T[],fallback:T):T=>values.includes(v[key] as T)?v[key] as T:fallback;
 const order=Array.isArray(v.dashboardOrder)?v.dashboardOrder.filter((x):x is DashboardModule=>DASHBOARD_MODULES.includes(x as DashboardModule)):[];
 return {preset:pick('preset',['collector','gallery','compact','paper','night-studio','soft-glass'] as const,'collector'),navigation:pick('navigation',['side','top'] as const,'side'),sidebarWidth:pick('sidebarWidth',[220,260,300] as const,260),density:pick('density',['compact','comfortable','spacious'] as const,'comfortable'),cardSize:pick('cardSize',['small','medium','large'] as const,'medium'),view:pick('view',['grid','list'] as const,'grid'),logoSize:pick('logoSize',[32,40,48,56] as const,40),dashboardOrder:[...new Set([...order,...DASHBOARD_MODULES])],hiddenModules:Array.isArray(v.hiddenModules)?[...new Set(v.hiddenModules.filter((x):x is DashboardModule=>DASHBOARD_MODULES.includes(x as DashboardModule)))]:[]};
}
export const WORKSPACE_PRESETS=[
 {id:'collector',name:'Collector',detail:'Balanced, clear and made for everyday collecting.',colors:['#0b1423','#5be7e7'],layout:{...defaults}},
 {id:'gallery',name:'Gallery',detail:'Generous artwork. Room for every detail.',colors:['#1c2336','#a7b5ff'],layout:{...defaults,preset:'gallery',cardSize:'large',density:'spacious'}},
 {id:'compact',name:'Compact',detail:'More information, less scrolling.',colors:['#15202b','#75d6bb'],layout:{...defaults,preset:'compact',cardSize:'small',density:'compact',view:'list',sidebarWidth:220}},
 {id:'paper',name:'Paper',detail:'An editorial layout with quiet, crisp edges.',colors:['#f4efe5','#80613c'],layout:{...defaults,preset:'paper',navigation:'top'}},
 {id:'night-studio',name:'Night Studio',detail:'Focused panels and a bold studio accent.',colors:['#101019','#b999ff'],layout:{...defaults,preset:'night-studio',sidebarWidth:220}},
 {id:'soft-glass',name:'Soft Glass',detail:'Soft edges and layered color, without blur overhead.',colors:['#142a30','#85e0d0'],layout:{...defaults,preset:'soft-glass',density:'spacious'}}
].map(p=>({...p,layout:normalizeWorkspaceLayout(p.layout)}));
export const layoutStorageKey=(id?:string)=>`wynterlabs.workspace.v1.${id??'guest'}`;
export function readWorkspaceLayout(id?:string):WorkspaceLayout|null{try{const v=localStorage.getItem(layoutStorageKey(id));return v?normalizeWorkspaceLayout(JSON.parse(v)):null;}catch{return null;}}
export function writeWorkspaceLayout(value:WorkspaceLayout|null,id?:string){try{if(value)localStorage.setItem(layoutStorageKey(id),JSON.stringify(normalizeWorkspaceLayout(value)));else localStorage.removeItem(layoutStorageKey(id));window.dispatchEvent(new Event('workspace-layout'));return true;}catch{return false;}}
export function applyWorkspaceLayout(layout:WorkspaceLayout){
 const root=document.documentElement;
 for(const key of ['preset','navigation','density','cardSize','view'] as const)root.dataset[`workspace${key[0].toUpperCase()+key.slice(1)}`]=layout[key];
 root.style.setProperty('--workspace-sidebar',`${layout.sidebarWidth}px`);root.style.setProperty('--workspace-logo',`${layout.logoSize}px`);
}
