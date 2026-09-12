import { rewardDefaults } from "./rewards";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../app/auth";
import { apiRequest } from "../lib/api";
import { defaults, endpoint, requestEvent, tone, type Presentation, type Settings, type Pull } from "./model";
import { Stage } from "./Stage";
import { exportRecap } from "./export";

export function Studio({ account = false }: { account?: boolean }) {
  const { user } = useAuth();
  const [state, setState] = useState<Presentation | null>(null);
  const [draft, setDraft] = useState<Settings>(defaults);
  const [status, setStatus] = useState(""); const [url, setUrl] = useState("");
  const [revealReplay,setRevealReplay] = useState(0);
  const [preview,setPreview] = useState<Pull|null>(null);
  const [replay, setReplay] = useState(false); const [busy, setBusy] = useState(false);
  const [temporaryMute,setTemporaryMute] = useState(false);
  const foundKey=useRef("");
  const temporaryMuteRef=useRef(temporaryMute);temporaryMuteRef.current=temporaryMute;
  const stateRef = useRef(state); stateRef.current = state;
  const audio = useRef<AudioContext | null>(null); const exportAbort = useRef<AbortController | null>(null);
  const queue = useRef<Record<string, unknown>[]>([]); const draining = useRef(false); const alive = useRef(true);
  const [pending,setPending] = useState(0); const [download,setDownload] = useState<{url:string;extension:string}|null>(null);
  useEffect(() => { alive.current = true; if (!user || user.must_setup_mfa) return;
    const abort = new AbortController();
    apiRequest<Presentation>(endpoint,{signal:abort.signal}).then(s => {if (!s?.settings || !Array.isArray(s.cards)) throw new Error("Presentation settings are unavailable.");setState(s);setDraft(s.settings);}).catch(e => {if(!abort.signal.aborted)setStatus(e.message);});
    return () => {alive.current=false;abort.abort();exportAbort.current?.abort();void audio.current?.close();audio.current=null;};
  }, [user?.id, user?.must_setup_mfa]);
  useEffect(() => {
    const activate = () => {
      const settings = stateRef.current?.settings;
      if (!settings || settings.muted || settings.audio !== "scanner" || typeof AudioContext === "undefined") return;
      audio.current ??= new AudioContext();
      void audio.current.resume().catch(() => {});
    };
    window.addEventListener("pointerdown", activate);
    window.addEventListener("keydown", activate);
    return () => { window.removeEventListener("pointerdown", activate); window.removeEventListener("keydown", activate); };
  }, []);
  useEffect(() => () => {if(download)URL.revokeObjectURL(download.url);}, [download]);
  function play(s: Presentation) { if (s.settings.audio !== "scanner" || temporaryMute || !audio.current) return;
    const kind=s.event?.kind; if(kind==="confirm"||kind==="reject")tone(audio.current,s.settings,kind,undefined,s.cards.at(-1)); if(kind==="finish"||kind==="replay")tone(audio.current,s.settings,"complete"); }
  async function drain() {
    if(draining.current)return; draining.current=true;
    try {while(queue.current.length && alive.current){
      const s=await apiRequest<Presentation>(endpoint+"/events",{method:"POST",body:JSON.stringify(queue.current[0])});
      queue.current.shift();setPending(queue.current.length);setState(s);setReplay(false);
    }}catch(e){setStatus(`Collection saving is unaffected. Preview needs retry: ${(e as Error).message}`);}finally{draining.current=false;}
  }
  useEffect(() => {
    if(account)return;
    const listen=(event: Event)=>{const current=stateRef.current;if(!current)return;const detail=(event as CustomEvent).detail;
      if(current.settings.audio === "scanner"&&!temporaryMuteRef.current&&audio.current)tone(audio.current,current.settings,detail.kind,undefined,detail.card);
      window.dispatchEvent(new CustomEvent("cardvault-pull-feedback",{detail:{...detail,settings:current.settings}}));
      if(!current.settings.enabled){if(detail.kind==="confirm")setState({...current,event:{id:detail.id,kind:"confirm"},preview:detail.card,revision:current.revision+1});return;}queue.current.push(detail);setPending(queue.current.length);void drain();};
    window.addEventListener("cardvault-presentation",listen);return()=>window.removeEventListener("cardvault-presentation",listen);
  },[account,temporaryMute]);
  useEffect(() => {if(account)return;const listener=(e:Event)=>{const card=(e as CustomEvent).detail as Pull|null;setPreview(card);setReplay(false);const key=card?`${card.printing_id}|${card.preview_key??""}`:"";if(key===foundKey.current)return;foundKey.current=key;const current=stateRef.current;if(!card||!current)return;
      setState({...current,event:{id:card.id,kind:"found"},preview:card,revision:current.revision+1});
      if(current.settings.audio==="scanner"&&!temporaryMuteRef.current&&audio.current)tone(audio.current,current.settings,"found");
      window.dispatchEvent(new CustomEvent("cardvault-pull-feedback",{detail:{kind:"found",card,settings:current.settings,id:card.id}}));
      if(current.settings.enabled){queue.current.push({id:card.id,kind:"found",card});setPending(queue.current.length);void drain();}
    };window.addEventListener("cardvault-selected-preview",listener);return()=>window.removeEventListener("cardvault-selected-preview",listener);},[account]);
  const update=(key:keyof Settings,value:unknown)=>setDraft(s=>({...s,[key]:value}));
  async function uploadBack(file: File | undefined) {
    if (!file) return;
    if (!["image/png","image/jpeg","image/webp"].includes(file.type) || file.size > 256 * 1024) { setStatus("Choose a PNG, JPG, or WebP card back no larger than 256 KB."); return; }
    try {
      const value = await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload=()=>resolve(String(reader.result)); reader.onerror=()=>reject(new Error("Could not read card back.")); reader.readAsDataURL(file); });
      update("card_back",value); setStatus("Card back ready. Save settings to use it in OBS and recaps.");
    } catch (e) { setStatus((e as Error).message); }
  }
  async function run(fn:()=>Promise<void>) {setBusy(true);setStatus("");try{await fn();}catch(e){setStatus((e as Error).message);}finally{setBusy(false);}}
  async function event(kind:string,extra:object={}) {const next=await requestEvent(kind,extra);setState(next);setReplay(kind==="finish"||kind==="replay");play(next);if(kind==="new")setUrl("");}
  async function enableAudio(){audio.current ??= new AudioContext();await audio.current.resume();setStatus("Audio is ready in this browser tab.");}
  if(!user || user.must_setup_mfa)return null;
  const optionLabels: Record<string,string> = {instant:"Plain · no animation",fade:"Fade in",flip:"Card flip",slide:"Slide in",zoom:"Zoom in",pop:"Comic pop",tilt:"Tilt reveal",gradient:"Color blend",spotlight:"Spotlight",grid:"Neon grid",stars:"Star dots",square:"Square · stacked",reverse:"Landscape · card right",transparent:"Transparent",green:"Green screen",blue:"Blue screen",solid:"Solid color",landscape:"Landscape",portrait:"Portrait",scanner:"Scanner page",overlay:"OBS / pop-out",off:"Off",chime:"Chime",arcade:"Arcade"};
  const select=(key:keyof Settings,label:string,values:string[]) => <label>{label}<select value={String(draft[key]??(key==="found"?"chime":""))} onChange={e=>update(key,e.target.value)}>{values.map(v=><option key={v} value={v}>{optionLabels[v] ?? v}</option>)}</select></label>;
  const check=(key:keyof Settings,label:string)=><label><span>{label}</span><input type="checkbox" checked={Boolean(draft[key]??(["rewards","particles"].includes(key)?true:false))} onChange={e=>update(key,e.target.checked)}/></label>;
  return <details className="presentation-panel" open={account || undefined}>
    <summary><span>{account ? "Streamer settings and sound" : "Streamer preview"}</span><small>Preview · Sound · OBS · Pack recap</small></summary>
    <p className="studio-intro">Make each pull your own. Choose a look, save your settings, then scan as usual. Only confirmed, saved cards enter your pack.</p>
    {!state ? <p role="status">{status||"Loading presentation settings…"}</p> : <>
      <div className="studio-status-strip" aria-label="Presentation status">
        <span>{state.settings.enabled ? "● Capturing saved pulls" : "○ Pack capture is off"}</span>
        <span>{draft.muted ? "Sound muted" : "Sound on"}</span>
        <span className={JSON.stringify(draft)!==JSON.stringify(state.settings)?"unsaved":""}>{JSON.stringify(draft)!==JSON.stringify(state.settings)?"Unsaved changes":"Settings saved"}</span>
      </div>
      <div className={`studio-workspace ${account ? "settings-only" : ""}`}>
      {!account && <section className="studio-preview-card" aria-label="Live card presentation">
        <div className="studio-section-title"><div><small>LIVE PREVIEW</small><h3>Your next reveal</h3></div><span className="studio-tag">{optionLabels[draft.reveal]}</span></div>
        <Stage key={revealReplay} state={{...state,settings:draft,preview:!replay?preview:undefined,cards:(!replay&&preview)?[preview]:state.cards}} replay={replay}/>
        <div className="studio-preview-caption"><span>{!replay&&preview?"Selected printing · confirm it before saving":"Saved pulls · ready for your audience"}</span><button type="button" disabled={!preview&&!state.cards.length} onClick={()=>setRevealReplay(v=>v+1)}>Replay animation</button></div>
        <p className="studio-helper">This is a preview. Animations never confirm cards or move the feeder.</p>
      </section>}
      <section className="studio-settings-card" aria-label="Preview settings">
        <div className="studio-section-title"><div><small>01 · MAKE IT YOURS</small><h3>Look & feel</h3></div></div>
        <div className="presentation-actions studio-presets"><button type="button" onClick={()=>setDraft({...defaults,enabled:draft.enabled})}>Plain preset<small>Clean & direct</small></button><button type="button" onClick={()=>setDraft({...draft,reveal:"fade",glow:false,pack:false})}>Subtle preset<small>A gentle fade</small></button><button type="button" onClick={()=>setDraft({...draft,reveal:"flip",glow:true,pack:true})}>Streamer preset<small>Flip & a little flair</small></button></div>
        <div className="presentation-controls">
          <label>Custom flip card back<small>PNG, JPG, or WebP · up to 256 KB</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{void uploadBack(e.target.files?.[0]);e.target.value="";}} /></label>
          {draft.card_back && <button type="button" onClick={()=>update("card_back","")}>Remove custom card back</button>}
          {check("enabled","Capture saved pulls")}{select("reveal","Reveal",["instant","fade","flip","slide","zoom","pop","tilt"])}
          {select("background","Background",["transparent","green","blue","solid","gradient","spotlight","grid","stars"])}{select("layout","Layout",["landscape","portrait","square","reverse"])}
          {check("details","Show set and printing details")}{check("prices","Show price")}
        </div>
        <details className="studio-more"><summary>Fine-tune the look <small>Color, timing & optional effects</small></summary><div className="presentation-controls">
          <label>Solid color<input type="color" value={draft.color} onChange={e=>update("color",e.target.value)}/></label><label>Accent color<input type="color" value={draft.accent} onChange={e=>update("accent",e.target.value)}/></label>
          <label>Reveal seconds<input type="number" min="0.1" max="3" step="0.1" value={draft.duration} onChange={e=>update("duration",Number(e.target.value))}/></label><label>Hold seconds<input type="number" min="1" max="10" value={draft.hold} onChange={e=>update("hold",Number(e.target.value))}/></label><label>Card size<input type="range" min="0.5" max="1.5" step="0.05" value={draft.scale} onChange={e=>update("scale",Number(e.target.value))}/></label>
          {check("glow","Card glow")}{check("pack","Pack-opening intro")}
        </div></details>
      </section></div>
      <section className="studio-sound-card" aria-label="Sound settings">
        <div className="studio-section-title"><div><small>02 · SET THE SOUND</small><h3>Sound & feedback</h3></div><span className="studio-tag">{draft.muted ? "Muted" : "On"}</span></div>
        <div className="presentation-controls">
          {check("muted","Account master mute")}<label>Volume<input type="range" min="0" max="1" step="0.05" value={draft.volume} onChange={e=>update("volume",Number(e.target.value))}/><small>{Math.round(draft.volume*100)}%</small></label>
          {select("audio","Play sound in",["scanner","overlay"])}{select("found","Card found sound",["off","chime","arcade"])}{select("confirm","Card accepted sound",["off","chime","arcade"])}{select("reject","Rejection sound",["off","chime","arcade"])}{select("complete","Pack-complete sound",["off","chime","arcade"])}
        </div><p className="studio-helper">Choose one sound destination to avoid hearing it twice. Master mute is saved to your account; preview mute only affects this tab.</p>
      </section>
      <section className="studio-prize-card"><h3>Prize pulls</h3><p className="studio-helper">Celebrates accepted cards using the highest enabled matching USD price tier per card. Quantity does not multiply the tier. All sounds respect Account master mute.</p><div className="presentation-controls">{check("rewards","Prize celebrations")}{check("particles","Confetti & sparks")}</div><div className="prize-tier-grid">{(draft.reward_tiers??rewardDefaults).map((tier,index)=><fieldset key={tier.threshold}><legend>${tier.threshold}+ pull</legend><label><input type="checkbox" checked={tier.enabled} onChange={e=>update("reward_tiers",(draft.reward_tiers??rewardDefaults).map((t,i)=>i===index?{...t,enabled:e.target.checked}:t))}/>Enable this tier</label><label>Prize message<input maxLength={40} value={tier.label} onChange={e=>update("reward_tiers",(draft.reward_tiers??rewardDefaults).map((t,i)=>i===index?{...t,label:e.target.value}:t))}/></label>{(["sound","effect"]as const).map(key=><label key={key}>{key==="sound"?"Prize sound":"Prize effect"}<select value={tier[key]} onChange={e=>update("reward_tiers",(draft.reward_tiers??rewardDefaults).map((t,i)=>i===index?{...t,[key]:e.target.value}:t))}>{(key==="sound"?["off","chime","arcade","fanfare"]:["none","confetti","sparks","burst"]).map(value=><option key={value} value={value}>{value[0].toUpperCase()+value.slice(1)}</option>)}</select></label>)}<button type="button" disabled={busy||!tier.enabled||tier.sound==="off"} onClick={()=>void enableAudio().then(()=>{if(!temporaryMute&&audio.current)tone(audio.current,draft,"confirm",undefined,{price:`$${tier.threshold}`} as Pull);})}>Test ${tier.threshold} jingle</button></fieldset>)}</div></section>
      <div className="presentation-actions studio-save-bar"><button className="button primary" type="button" disabled={busy} onClick={()=>void run(async()=>{const next=await apiRequest<Presentation>(endpoint+"/settings",{method:"PUT",body:JSON.stringify(draft)});setState(next);setDraft(next.settings);setStatus("Account settings saved.");})}>Save presentation settings</button><button type="button" onClick={()=>void enableAudio()}>Enable browser audio</button><button type="button" onClick={()=>setTemporaryMute(v=>!v)}>{temporaryMute?"Unmute this preview":"Mute this preview"}</button><button type="button" onClick={()=>void enableAudio().then(()=>{if(!temporaryMute&&audio.current)tone(audio.current,draft,"confirm");})}>Test accepted sound</button><button type="button" onClick={()=>void enableAudio().then(()=>{if(!temporaryMute&&audio.current)tone(audio.current,draft,"found");})}>Test found sound</button></div>
      {!account && <>
        <section className="studio-pack-card" aria-label="Pack recap controls"><div className="studio-section-title"><div><small>03 · KEEP THE MOMENT</small><h3>Your pack</h3></div><span className="studio-tag">{state.cards.length} pulls</span></div>
        <p>{state.cards.length}/100 saved pulls · {state.finished ? "Pack finished. Start a new pack to capture more." : "Pack in progress"}</p>
        <div className="presentation-actions">
          <button disabled={busy||pending>0||!state.cards.length} onClick={()=>void run(()=>event("finish"))}>Finish Pack</button>
          <button disabled={busy||!state.cards.length} onClick={()=>void run(()=>event("replay"))}>Replay recap</button>
          <button disabled={busy||pending>0||(!state.finished&&state.cards.length>0)} onClick={()=>void run(()=>event("new"))}>Start new pack</button>
        </div><div className="studio-obs-block"><h4>Share your preview with OBS</h4><p className="studio-helper">Create a private viewing link, then add it as an OBS Browser Source.</p><div className="presentation-actions">
          <button disabled={busy} onClick={()=>void run(async()=>{const {token}=await apiRequest<{token:string}>(endpoint+"/link",{method:"POST"});setUrl(`${location.origin}/overlay#${token}`);setStatus("Private view-only link created. Expires in 7 days; previous links are disabled.");})}>Create / rotate OBS link</button>
          <button disabled={busy} onClick={()=>void run(async()=>{await apiRequest(endpoint+"/link",{method:"DELETE"});setUrl("");setStatus("OBS link disabled.");})}>Disable OBS link</button>
        </div>
        {url && <><label>Private OBS Browser Source URL<input className="presentation-link" readOnly value={url} onFocus={e=>e.target.select()}/></label><div className="presentation-actions"><button onClick={()=>void navigator.clipboard.writeText(url).then(()=>setStatus("OBS URL copied."),()=>setStatus("Select the URL above and copy it."))}>Copy URL</button><a href={url} target="_blank" rel="noreferrer">Open pop-out preview</a></div></>}
        <p>OBS: use this URL as a Browser Source at 1280×720 or 720×1280. Select transparent, green or blue above and save. Audio plays only in the selected destination. New packs disable old links. Refreshing does not replay old celebrations.</p>
        </div><details className="studio-more"><summary>Review recap pulls</summary><p>Remove or highlight a saved pull for the video. These changes do not edit your collection.</p><ul className="recap-edit">{state.cards.map(c=><li key={c.id}><span>{c.quantity}× {c.name}</span><button disabled={busy} onClick={()=>void run(()=>event("highlight",{target:c.id}))}>{c.highlight?"★ Highlighted":"☆ Highlight"}</button><button disabled={busy} onClick={()=>void run(()=>event("remove",{target:c.id}))}>Remove from recap</button></li>)}</ul></details>
        <div className="presentation-controls">{check("highlights","Recap selected highlights (all if none selected)")}</div><div className="presentation-actions"><button className="button primary" disabled={busy||!state.cards.length} onClick={()=>void run(async()=>{exportAbort.current=new AbortController();const result=await exportRecap({...state,settings:draft},exportAbort.current.signal,setStatus);setDownload({url:URL.createObjectURL(result.blob),extension:result.extension});setStatus(`Video ready.${result.missing?` ${result.missing} unavailable images use a text fallback.`:""}`);})}>Save recap video</button>{busy&&exportAbort.current&&<button onClick={()=>exportAbort.current?.abort()}>Cancel export</button>}</div>
        <p>Keep this tab visible while exporting. Video uses the selected layout and mute setting. Transparent backgrounds export as solid dark video; use the live OBS overlay for transparency.</p>
        {download&&<><a className="button" href={download.url} download={`cardvault-pack.${download.extension}`}>Download {download.extension.toUpperCase()} video</a><video controls src={download.url} style={{maxWidth:"100%",maxHeight:300}} aria-label="Recorded pack recap"/></>}
        </section>{pending>0&&<p role="alert">{pending} presentation event(s) waiting. Keep this page open. <button onClick={()=>void drain()}>Retry preview delivery</button></p>}
      </>}
      <p className="presentation-status" role="status">{status}</p>
    </>}
  </details>;
}
