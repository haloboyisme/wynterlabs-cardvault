import {useState} from "react";
import {BACKGROUNDS,backgroundDefaults,backgroundSettings,prepareBackground,type BackgroundSettings as Value} from "../lib/backgrounds";
import "../styles/backgrounds.css";
export function BackgroundSettings({value,onChange,disabled=false}:{value:Value;onChange:(value:Value)=>void;disabled?:boolean}){
 const [error,setError]=useState("");const [loading,setLoading]=useState(false);const v=backgroundSettings(value);
 return <fieldset className="background-editor" disabled={disabled||loading}><legend>Background studio</legend><p>Choose a scene, then layer your own artwork over it. Your theme colors remain underneath.</p>
 <div className="background-presets">{BACKGROUNDS.map(b=><button type="button" key={b.id} aria-pressed={v.preset===b.id} onClick={()=>onChange({...v,preset:b.id})}>{b.image?<img src={b.image} loading="lazy" alt=""/>:<span className="background-plain">◇</span>}<span>{b.name}</span></button>)}</div>
 <label>Upload background<input type="file" accept="image/png,image/jpeg,image/gif" onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;setLoading(true);setError("");void prepareBackground(file).then(image=>onChange({...v,...image})).catch(err=>setError(err.message)).finally(()=>setLoading(false));}}/></label>
 <p className="muted">PNG, JPEG or GIF · up to 1 MB. Animated GIFs use a still frame in low-power mode, reduced motion, while scanning or in hidden tabs.</p>
 {v.upload&&<><img className="background-upload-preview" src={v.still||v.upload} alt="Uploaded background preview"/><button type="button" onClick={()=>onChange({...v,upload:"",still:""})}>Remove uploaded background</button></>}
 <div className="background-controls"><label>Background intensity<input type="range" min="0" max=".8" step=".05" value={v.opacity} onChange={e=>onChange({...v,opacity:Number(e.target.value)})}/><output>{Math.round(v.opacity*100)}%</output></label><label>Image framing<select value={v.size} onChange={e=>onChange({...v,size:e.target.value})}><option value="cover">Fill the screen</option><option value="contain">Show the whole image</option></select></label><label>Image position<select value={v.position} onChange={e=>onChange({...v,position:e.target.value})}>{["top","center","bottom"].map(p=><option key={p}>{p}</option>)}</select></label></div>
 <button type="button" onClick={()=>onChange({...backgroundDefaults})}>Reset background</button>{loading&&<p role="status">Preparing your background…</p>}{error&&<p role="alert">{error}</p>}</fieldset>;
}
