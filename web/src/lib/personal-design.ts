import {readWorkspaceLayout,DASHBOARD_MODULES,layoutStorageKey} from './workspace-layout';
import {brandDesign,type BrandDesign} from './brand-design';
import {importWorkspacePreset,exportWorkspacePreset} from './workspace-presets';
import {backgroundSettings} from './backgrounds';
import {APPEARANCE_STORAGE_KEY,readAppearance,applyAppearance} from './appearance';
const key=(id?:string)=>`wynterlabs.personal-design.v1.${id??'guest'}`;
const backgroundKey=(id?:string)=>`wynterlabs.background.v277.${id??'guest'}`;
export function readPersonalDesign(id?:string):BrandDesign|null{try{const text=localStorage.getItem(key(id));return text?importWorkspacePreset(text).design:null;}catch{return null;}}
export function savePersonalDesign(value:BrandDesign|null,id?:string){try{if(value)localStorage.setItem(key(id),exportWorkspacePreset(value));else localStorage.removeItem(key(id));window.dispatchEvent(new Event('workspace-layout'));return true;}catch{return false;}}
export function effectiveBrandDesign(site:BrandDesign,id?:string):BrandDesign{
 const p=readPersonalDesign(id);const layout=readWorkspaceLayout(id);let background=site.background;
 try{const value=localStorage.getItem(backgroundKey(id));if(value)background=backgroundSettings(JSON.parse(value));}catch{}
 const flags=layout?Object.fromEntries(DASHBOARD_MODULES.map(k=>[`dashboard_${k}`,!layout.hiddenModules.includes(k)])):{};
 return brandDesign({...site,...flags,background,...(p?{accent:p.accent,secondary:p.secondary,surface:p.surface,typography:p.typography,corners:p.corners,finish:p.finish,width:p.width,workspace:layout??p.workspace}:{})});
}
/** Commit the complete personal look, rolling back partial storage writes on failure. */
export function applyPersonalLook(value:BrandDesign|null,id?:string):boolean{
 const previous=new Map<string,string|null>();
 try{
  const serialized=value?exportWorkspacePreset(value):null;
  const updates:[string,string|null][]=[[key(id),serialized],[layoutStorageKey(id),value?JSON.stringify(value.workspace):null],[backgroundKey(id),value?JSON.stringify(value.background):null],[APPEARANCE_STORAGE_KEY,JSON.stringify({...readAppearance(),theme:'system'})]];
  for(const[k]of updates)previous.set(k,localStorage.getItem(k));
  for(const[k,v]of updates){if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);}
 }catch{for(const[k,v]of previous){try{if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v);}catch{}}return false;}
 applyAppearance(readAppearance());
 window.dispatchEvent(new StorageEvent('storage',{key:APPEARANCE_STORAGE_KEY}));
 window.dispatchEvent(new Event('workspace-layout'));window.dispatchEvent(new Event('workspace-background'));return true;
}
