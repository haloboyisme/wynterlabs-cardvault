import {useEffect,useState} from "react";
import {useAuth} from "../app/auth";
import {apiRequest} from "../lib/api";
interface Snapshot {name:string;set_code:string;collector_number:string;language:string;finish:string|null;finish_source:string}
const describe=(card?:Snapshot|null)=>card?`${card.name} · ${card.set_code} #${card.collector_number} · ${card.language} · ${card.finish??"finish not selected"}${card.finish_source==="default"?" (default, not camera detected)":""}`:"Not recorded";
interface Item {codes?:string[];diagnostics?:{suggested?:Snapshot|null;latest_suggestion?:Snapshot|null;accepted?:Snapshot|null};scan_id:string;mode:string;attempts:number;outcome:string;reasons:string[];suspected:string[];reported:string[];created_at:string}
const label=(value:string)=>value.replaceAll("_"," ");
export function ScanFailureHistory() {
  const {user}=useAuth();
  const [open,setOpen]=useState(false),[all,setAll]=useState(false),[items,setItems]=useState<Item[]>([]),[error,setError]=useState("");
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{setItems([]);setAll(false);setError("");},[user?.id]);
  useEffect(()=>{
    const fail=()=>setError("A scan log could not be saved. Scanning still works; that attempt may be missing from history.");
    const changed=()=>setRefresh(n=>n+1);
    window.addEventListener("cardvault-scan-log-changed",changed);
    window.addEventListener("cardvault-scan-log-error",fail);
    return()=>{window.removeEventListener("cardvault-scan-log-error",fail);window.removeEventListener("cardvault-scan-log-changed",changed);};
  },[]);
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();
    apiRequest<{items:Item[]}>(`/api/v1/scanner/failures${all?"?all_accounts=true":""}`,{signal:controller.signal})
      .then(data=>{if(!controller.signal.aborted)setItems(data.items);})
      .catch(()=>{if(!controller.signal.aborted)setError("Scan history could not be loaded. Try Refresh history.");});
    return()=>controller.abort();
  },[open,all,refresh,user?.id]);
  return <section className="scan-failure-history">{error&&<p role="status">{error}</p>}<details onToggle={e=>setOpen(e.currentTarget.open)}><summary>Scan history · failed attempts</summary>
    <p>First failures stay here even when a retry succeeds. Possible causes are estimates, not confirmed diagnoses. Suggested and saved card/finish details are recorded for new scans. No photos or raw recognized text are stored. Shows up to 100 recent records; retention is 90 days, capped at 1,000 per account.</p>
    {user && ["owner","super_admin","admin"].includes(user.role)&&<label><input type="checkbox" checked={all} onChange={e=>setAll(e.target.checked)}/> Admin: include all accounts</label>}
    <p>SCAN-001: no readable text · 002: no catalog match · 003: choose a printing · 004: corrected card/printing · 005: changed default finish · 006: timeout · 007: recognition/service error. Codes identify the failure category, not a proven camera fault.</p>
    <button type="button" onClick={()=>setRefresh(n=>n+1)}>Refresh history</button>
    {!items.length?<p>No failed scans to show.</p>:<ol>{items.map((item,index)=><li key={`${item.scan_id}-${index}`}><strong>{label(item.mode)} · {label(item.outcome)}</strong><p>{new Date(item.created_at).toLocaleString()} · {item.attempts} attempt(s) · Scan {item.scan_id.slice(0,8)}</p><p><strong>{item.codes?.join(" · ")||"Legacy record"}</strong></p><p>Scanner suggested: {describe(item.diagnostics?.suggested)}</p><p>Actually saved: {describe(item.diagnostics?.accepted)}</p><p>Reason: {item.reasons.map(label).join(", ")||"User reported"}{item.reported.length>0&&` · Reported: ${item.reported.map(label).join(", ")}`}{item.suspected.length>0&&` · Possible causes: ${item.suspected.map(label).join(", ")}`}</p></li>)}</ol>}
  </details></section>;
}
