import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../lib/api";
import { endpoint, tone, type Presentation } from "./model";
import { Stage } from "./Stage";
export function Overlay() {
  const [state,setState]=useState<Presentation|null>(null); const [error,setError]=useState(""); const [replay,setReplay]=useState(false);
  const [fresh,setFresh]=useState(false);const audio=useRef<AudioContext|null>(null);
  useEffect(()=>{
    const body=document.body.style.background,html=document.documentElement.style.background;
    document.body.style.background="transparent";document.documentElement.style.background="transparent";
    let stopped=false,revision:number|null=null,disconnected=false,timer=0;const controller=new AbortController();
    const token=location.hash.slice(1);
    let soundAllowed=false;
    function startAudio(){
      if(stopped||!soundAllowed||typeof AudioContext==="undefined")return;
      try{audio.current??=new AudioContext();if(audio.current.state!=="closed")void audio.current.resume().catch(()=>{});}catch{/* Keep the overlay usable if audio is unavailable. */}
    }
    function syncAudio(next:Presentation){
      soundAllowed=!next.settings.muted&&next.settings.audio==="overlay";
      if(soundAllowed)startAudio();
      else if(audio.current){const previous=audio.current;audio.current=null;void previous.close().catch(()=>{});}
    }
    // OBS permits autoplay. Ordinary browsers can unlock silently on a gesture.
    document.addEventListener("pointerdown",startAudio);
    document.addEventListener("keydown",startAudio);
    async function poll(){
      try{
        const next=await apiRequest<Presentation>(endpoint+"/overlay"+(revision!==null&&!disconnected?`?after_revision=${revision}`:""),{signal:controller.signal,credentials:"omit",headers:{Authorization:`Bearer ${token}`}});
        if(stopped)return;
        if(!next){timer=window.setTimeout(poll,document.hidden?5000:1000);return;}
        syncAudio(next);
        const changed=revision!==null&&next.revision!==revision&&!disconnected;
        if(changed||disconnected||revision===null)setFresh(changed);if(next.revision!==revision||disconnected){setReplay(changed&&["finish","replay"].includes(next.event?.kind||""));}
        if(changed&&soundAllowed&&audio.current){const kind=next.event?.kind;if(kind==="confirm"||kind==="reject"||kind==="found")tone(audio.current,next.settings,kind,undefined,next.preview??next.cards.at(-1));if(kind==="finish"||kind==="replay")tone(audio.current,next.settings,"complete");}
        if(next.revision!==revision||disconnected)setState(next);revision=next.revision;disconnected=false;setError("");
      }catch(e){if(stopped)return;disconnected=true;setState(null);setReplay(false);setError((e as Error).message);}
      if(!stopped)timer=window.setTimeout(poll,document.hidden?5000:1000);
    }
    void poll();return()=>{stopped=true;document.removeEventListener("pointerdown",startAudio);document.removeEventListener("keydown",startAudio);controller.abort();clearTimeout(timer);void audio.current?.close();audio.current=null;document.body.style.background=body;document.documentElement.style.background=html;};
  },[]);
  return <main className="overlay-page">{state&&<Stage state={fresh?state:{...state,event:null,settings:{...state.settings,reveal:"instant"}}} replay={replay}/>}{error&&<p className="overlay-error">{error}</p>}</main>;
}
