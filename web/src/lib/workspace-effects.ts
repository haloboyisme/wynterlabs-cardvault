export const EFFECTS_KEY="wynterlabs.workspace.effects.v1";
export const effectsDefaults={motion:true,lowPower:true,clicks:false,hover:false,volume:.2};
export type WorkspaceEffects=typeof effectsDefaults;
export function readEffects():WorkspaceEffects{try{const s=JSON.parse(localStorage.getItem(EFFECTS_KEY)||"{}");return {motion:typeof s.motion==="boolean"?s.motion:true,lowPower:typeof s.lowPower==="boolean"?s.lowPower:true,clicks:s.clicks===true,hover:s.hover===true,volume:typeof s.volume==="number"&&Number.isFinite(s.volume)?Math.max(0,Math.min(1,s.volume)):.2};}catch{return {...effectsDefaults};}}
export function saveEffects(s:WorkspaceEffects){try{localStorage.setItem(EFFECTS_KEY,JSON.stringify(s));}catch{}window.dispatchEvent(new Event("workspace-effects"));}
