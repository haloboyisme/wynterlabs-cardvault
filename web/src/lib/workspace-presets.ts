import {brandDesign,DEFAULT_DESIGN,type BrandDesign} from './brand-design';
import {backgroundSettings} from './backgrounds';
import {normalizeWorkspaceLayout,WORKSPACE_PRESETS} from './workspace-layout';
export interface NamedPreset{name:string;design:BrandDesign}
const key=(id?:string)=>`wynterlabs.workspace-presets.v1.${id??'guest'}`;
const enums:Record<string,string[]>={surface:['navy','charcoal','light'],typography:['modern','rounded','editorial'],corners:['soft','rounded','square'],finish:['glow','outline','plain'],width:['comfortable','wide','full'],navigation:['side','top','hidden']};
function validatedDesign(value:unknown):BrandDesign{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Choose a valid CardVault appearance file.');
 const input=value as Record<string,unknown>;const out:Record<string,unknown>={};
 for(const [key,def]of Object.entries(DEFAULT_DESIGN)){
  if(!(key in input))continue;const val=input[key];
  if(key==='workspace'){if(!val||typeof val!=='object'||Array.isArray(val))throw Error('Invalid workspace settings.');out[key]=normalizeWorkspaceLayout(val);continue;}
  if(key==='background'){
   if(!val||typeof val!=='object'||Array.isArray(val))throw Error('Invalid background settings.');
   const raw=val as Record<string,unknown>;const clean=backgroundSettings(raw);
   for(const image of ['upload','still']as const){if(raw[image]!==undefined&&raw[image]!==clean[image])throw Error('Invalid background image.');if(clean[image]){
    let bytes:string;try{bytes=atob(clean[image].split(',')[1]);}catch{throw Error('Invalid image encoding.');}
    if(bytes.length>1048576||!(bytes.startsWith('\x89PNG\r\n\x1a\n')||bytes.startsWith('\xff\xd8\xff')||bytes.startsWith('GIF8')))throw Error('Invalid background image.');
    const u=(i:number)=>bytes.charCodeAt(i);let w=0,h=0;
    if(bytes.startsWith('\x89PNG')){if(bytes.length>=24){w=u(16)*16777216+u(17)*65536+u(18)*256+u(19);h=u(20)*16777216+u(21)*65536+u(22)*256+u(23);}if(bytes.includes('acTL'))throw Error('Use GIF for animated backgrounds.');}
    else if(bytes.startsWith('GIF8')){if(bytes.length>=10){w=u(6)+u(7)*256;h=u(8)+u(9)*256;}}
    else {let offset=2;while(offset+4<=bytes.length){if(u(offset)!==255)break;const marker=u(offset+1);offset+=2;const size=u(offset)*256+u(offset+1);if(size<2||offset+size>bytes.length)break;if([192,193,194].includes(marker)&&size>=8){h=u(offset+3)*256+u(offset+4);w=u(offset+5)*256+u(offset+6);break;}offset+=size;}}
    if(!w||!h||w*h>4000000||Math.max(w,h)>4096)throw Error('Background dimensions exceed the supported limit.');
   }}
   if(clean.still.startsWith('data:image/gif')||(clean.upload.startsWith('data:image/gif')&&!clean.still))throw Error('Moving backgrounds need a still fallback.');
   out[key]=clean;continue;
  }
  if(typeof val!==typeof def)throw Error(`Invalid ${key} setting.`);
  if(typeof val==='string'&&(val.length>400||(enums[key]&&!enums[key].includes(val))))throw Error(`Invalid ${key} setting.`);
  if(['accent','secondary'].includes(key)&&!/^#[a-f\d]{6}$/i.test(String(val)))throw Error('Invalid theme color.');
  out[key]=val;
 }
 return brandDesign(out as Partial<BrandDesign>);
}
export function exportWorkspacePreset(design:BrandDesign,name='My look'){return JSON.stringify({version:1,name:name.trim().slice(0,40)||'My look',design:validatedDesign(design)},null,2);}
export function importWorkspacePreset(text:string):NamedPreset{
 if(text.length>4000000)throw Error('Choose an appearance file smaller than 4 MB.');
 let v:any;try{v=JSON.parse(text);}catch{throw Error('This is not a valid appearance file.');}
 if(v?.version!==1)throw Error('This appearance file version is not supported.');
 return {name:typeof v.name==='string'?v.name.slice(0,40):'Imported look',design:validatedDesign(v.design)};
}
export function readNamedPresets(id?:string):NamedPreset[]{try{const data=JSON.parse(localStorage.getItem(key(id))??'[]');return Array.isArray(data)?data.slice(0,20).map(v=>importWorkspacePreset(JSON.stringify({version:1,...v}))):[];}catch{return [];}}
export function saveNamedPreset(id:string|undefined,preset:NamedPreset){const clean=importWorkspacePreset(exportWorkspacePreset(preset.design,preset.name));const existing=readNamedPresets(id);const next=[...existing.filter(p=>p.name!==clean.name),clean];if(next.length>20)throw Error('You can save 20 looks. Remove one first.');try{localStorage.setItem(key(id),JSON.stringify(next));}catch{throw Error('Browser storage is full. Remove an old look or use a smaller background.');}}
export function deleteNamedPreset(id:string|undefined,name:string){localStorage.setItem(key(id),JSON.stringify(readNamedPresets(id).filter(p=>p.name!==name)));}
export function presetDesign(id:string,current:BrandDesign):BrandDesign{
 const preset=WORKSPACE_PRESETS.find(p=>p.id===id);if(!preset)return current;
 return {...current,workspace:normalizeWorkspaceLayout(preset.layout),accent:preset.colors[1],surface:id==='paper'?'light':id==='night-studio'?'charcoal':'navy',typography:id==='paper'?'editorial':'modern',corners:id==='soft-glass'?'rounded':id==='compact'?'square':'soft',finish:id==='night-studio'||id==='soft-glass'?'glow':'plain'};
}
