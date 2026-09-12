import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../lib/api";
import { endpoint, tone, type Presentation } from "./model";
import { Stage } from "./Stage";
export function Overlay() {
  const [state,setState]=useState<Presentation|null>(null); const [error,setError]=useState(""); const [replay,setReplay]=useState(false);
  const [fresh,setFresh]=useState(false); const [audioReady,setAudioReady]=useState(false);const audio=useRef<AudioContext|null>(null);
  useEffect(()=>{
    const body=document.body.style.background,html=document.documentElement.style.background;
    document.body.style.background="transparent";document.documentElement.style.background="transparent";
    let stopped=false,revision:number|null=null,disconnected=false,timer=0;const controller=new AbortController();
    const token=location.hash.slice(1);
    async function poll(){
      try{
        const next=await apiRequest<Presentation>(endpoint+"/overlay"+(revision!==null&&!disconnected?`?after_revision=${revision}`:""),{signal:controller.signal,credentials:"omit",headers:{Authorization:`Bearer ${token}`}});
        if(stopped)return;
        if(!next){timer=window.setTimeout(poll,document.hidden?5000:1000);return;}
        const changed=revision!==null&&next.revision!==revision&&!disconnected;
        if(changed||disconnected||revision===null)setFresh(changed);if(next.revision!==revision||disconnected){setReplay(changed&&["finish","replay"].includes(next.event?.kind||""));}
        if(changed&&next.settings.audio==="overlay"&&audio.current){const kind=next.event?.kind;if(kind==="confirm"||kind==="reject"||kind==="found")tone(audio.current,next.settings,kind,undefined,next.preview??next.cards.at(-1));if(kind==="finish"||kind==="replay")tone(audio.current,next.settings,"complete");}
        if(next.revision!==revision||disconnected)setState(next);revision=next.revision;disconnected=false;setError("");
      }catch(e){if(stopped)return;disconnected=true;setState(null);setReplay(false);setError((e as Error).message);}
      if(!stopped)timer=window.setTimeout(poll,document.hidden?5000:1000);
    }
    void poll();return()=>{stopped=true;controller.abort();clearTimeout(timer);void audio.current?.close();audio.current=null;document.body.style.background=body;document.documentElement.style.background=html;};
  },[]);
  return <main className="overlay-page">{state&&<Stage state={fresh?state:{...state,event:null,settings:{...state.settings,reveal:"instant"}}} replay={replay}/>}{error&&<p className="overlay-error">{error}</p>}{state&&!state.settings.muted&&state.settings.audio==="overlay"&&!audioReady&&<button className="overlay-audio" onClick={()=>{audio.current??=new AudioContext();void audio.current.resume().then(()=>setAudioReady(true));}}>Enable overlay audio</button>}</main>;
}
