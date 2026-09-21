import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./scan-photo-window.css";

/** Non-modal so the manual search remains usable alongside the photograph. */
export function ScanPhotoWindow({src, onClose}: {src: string; onClose: () => void}) {
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{x: number; y: number; left: number; top: number} | null>(null);
  const [position, setPosition] = useState({left: 16, top: 80});
  const close = useRef(onClose);
  close.current = onClose;
  const clamp = (left: number, top: number) => ({
    left: Math.max(0, Math.min(left, window.innerWidth - (panel.current?.offsetWidth || 320))),
    top: Math.max(0, Math.min(top, window.innerHeight - (panel.current?.offsetHeight || 400))),
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") close.current(); };
    const resize = () => setPosition(current => clamp(current.left, current.top));
    resize();
    window.addEventListener("keydown", key);
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("resize", resize); };
  }, []);
  return createPortal(<div ref={panel} className="scan-photo-window" role="dialog" aria-label="Enlarged scanned card" aria-modal="false" style={position}>
    <header>
      <button type="button" className="scan-photo-drag" aria-label="Move card photo" title="Drag to move, or use arrow keys"
        onPointerDown={event => {
          if (event.button !== 0) return;
          drag.current = {x:event.clientX, y:event.clientY, ...position};
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => { const start = drag.current; if (start) setPosition(clamp(start.left + event.clientX-start.x, start.top+event.clientY-start.y)); }}
        onPointerUp={() => {drag.current = null;}}
        onPointerCancel={() => {drag.current = null;}}
        onKeyDown={event => {
          const move = {ArrowLeft:[-20,0], ArrowRight:[20,0], ArrowUp:[0,-20], ArrowDown:[0,20]}[event.key];
          if (move) {event.preventDefault(); setPosition(current => clamp(current.left+move[0], current.top+move[1]));}
        }}
      >Scanned card · Drag to move</button>
      <button type="button" aria-label="Close enlarged card" onClick={onClose}>×</button>
    </header>
    <img src={src} alt="Enlarged captured card" draggable={false}/>
  </div>, document.body);
}
