import { useState } from "react";
import { CardImage } from "../components/CardImage";
import "./presentation.css";

/** Presentation only: never confirms a printing or advances the scanner. */
export function ScanReveal({ name, imageUris, revealKey }: { name: string; imageUris: Record<string,string>; revealKey: string }) {
  const [animation,setAnimation] = useState("flip");
  const [replay,setReplay] = useState(0);
  return <div className="scan-reveal-panel">
    <div className="scan-comic-frame">
      <span className="scan-comic-label">CARD REVEAL</span>
      <div key={`${revealKey}-${animation}-${replay}`} className={`scan-reveal-art scan-reveal-${animation}`}>
        <div className="scan-reveal-front"><CardImage name={name} imageUris={imageUris} className="multi-scan-selected-preview-image"/></div>
        <div className="scan-reveal-back" aria-hidden="true"><span>W</span><small>CARDVAULT</small></div>
      </div>
    </div>
    <div className="scan-reveal-toolbar"><label>Preview animation<select value={animation} onChange={e=>setAnimation(e.target.value)}><option value="flip">Card flip</option><option value="fade">Fade</option><option value="instant">Plain · no animation</option></select></label><button type="button" onClick={()=>setReplay(v=>v+1)} aria-label="Replay card reveal">↻ Replay</button></div>
  </div>;
}
