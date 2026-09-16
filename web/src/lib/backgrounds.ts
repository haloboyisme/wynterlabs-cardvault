export const BACKGROUNDS = [
  {id:"none",name:"Plain · use theme colors",image:""},
  {id:"pokemon",name:"Pokémon · trainer horizon",image:"/backgrounds/trainer-horizon.png"},
  {id:"magic",name:"Magic · five mana realms",image:"/backgrounds/mana-realms.png"},
  {id:"anime",name:"Anime · neon evening",image:"/backgrounds/neon-evening.png"},
];
export const backgroundDefaults = {preset:"none",upload:"",still:"",opacity:0.35,position:"center",size:"cover"};
export type BackgroundSettings = typeof backgroundDefaults;
export function backgroundSettings(value?: Partial<BackgroundSettings>): BackgroundSettings {
 const v={...backgroundDefaults,...value};
 return {...v,preset:BACKGROUNDS.some(b=>b.id===v.preset)?v.preset:"none",opacity:Number.isFinite(v.opacity)?Math.max(0,Math.min(.8,v.opacity)):.35,position:["center","top","bottom"].includes(v.position)?v.position:"center",size:["cover","contain"].includes(v.size)?v.size:"cover",upload:validImage(v.upload)?v.upload:"",still:validImage(v.still)?v.still:""};
}
function validImage(value:unknown):value is string{return typeof value==="string"&&value.length<=1400000&&(!value||/^data:image\/(png|jpeg|gif);base64,[A-Za-z0-9+/=]+$/.test(value));}
export async function prepareBackground(file:File):Promise<{upload:string;still:string}>{
 if(!["image/png","image/jpeg","image/gif"].includes(file.type)||file.size>1024*1024)throw new Error("Choose a PNG, JPEG or GIF up to 1 MB.");
 const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("Could not read this image."));reader.readAsDataURL(file);});
 const img=new Image();await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(new Error("This image could not be opened."));img.src=data;});
 if(img.naturalWidth*img.naturalHeight>4000000||img.naturalWidth>4096||img.naturalHeight>4096)throw new Error("Choose an image with at most 4 million pixels and edges under 4096 pixels.");
 const scale=Math.min(1,1280/img.naturalWidth,720/img.naturalHeight);const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
 const ctx=canvas.getContext("2d");if(!ctx)throw new Error("Image processing is unavailable.");ctx.drawImage(img,0,0,canvas.width,canvas.height);
 const still=canvas.toDataURL(file.type==="image/png"?"image/png":"image/jpeg",.82);
 if(still.length>1400000)throw new Error("This image is too detailed. Try a smaller image.");
 return {upload:file.type==="image/gif"?data:still,still};
}
