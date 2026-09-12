import { rewardFor } from "./rewards";
import { backdrop, recapCards, tone, type Presentation } from "./model";
/** Browser-local export: never captures the camera or sends video to a service. */
export async function exportRecap(state: Presentation, signal: AbortSignal, progress: (text: string) => void) {
  if (!globalThis.MediaRecorder) throw new Error("Video export is unavailable in this browser. Record the pop-out in OBS instead.");
  const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/mp4"].find(t => MediaRecorder.isTypeSupported(t));
  if (!mime) throw new Error("This browser has no supported video recorder. Use OBS to record the pop-out.");
  const cards = recapCards(state); if (!cards.length) throw new Error("Save at least one confirmed pull first.");
  const s = state.settings;
  const canvas = document.createElement("canvas"); canvas.width = s.layout === "portrait" || s.layout === "square" ? 720 : 1280; canvas.height = s.layout === "portrait" ? 1280 : 720;
  const ctx = canvas.getContext("2d")!;
  const audio = new AudioContext(); await audio.resume(); const mix = audio.createMediaStreamDestination();
  const stream = canvas.captureStream(30); if (!s.muted) for (const track of mix.stream.getAudioTracks()) stream.addTrack(track);
  const images = new Map<string, HTMLImageElement>(); let missing = 0;
  const chunks: Blob[] = []; const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3500000 });
  let stopped = false; let timer = 0;
  try {
    progress("Preparing card images…");
    await Promise.all(cards.map(c => new Promise<void>(resolve => {
      if (!c.image) { missing++; resolve(); return; }
      const img = new Image(); img.crossOrigin = "anonymous";
      const timeout = setTimeout(() => { missing++; resolve(); }, 5000);
      img.onload = () => { clearTimeout(timeout); images.set(c.id, img); resolve(); };
      img.onerror = () => { clearTimeout(timeout); missing++; resolve(); }; img.src = c.image;
    })));
    if (s.card_back) await new Promise<void>(resolve => { const img=new Image(); const timeout=setTimeout(resolve,3000); img.onload=()=>{clearTimeout(timeout);images.set("custom-back",img);resolve();};img.onerror=()=>{clearTimeout(timeout);resolve();};img.src=s.card_back!; });
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const done = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
      recorder.onerror = () => reject(new Error("Video recording failed. Try OBS or a different browser."));
    });
    const abort = () => { stopped = true; if (recorder.state !== "inactive") recorder.stop(); };
    signal.addEventListener("abort", abort, { once: true });
    recorder.start(250);
    const packTime = s.pack ? 1.5 : 0;
    const duration = packTime + cards.length * s.hold + 3;
    const start = performance.now(); let last = -10;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduced";
    await new Promise<void>(resolve => {
      const draw = () => {
        const elapsed = (performance.now() - start) / 1000;
        if (stopped || elapsed >= duration) { resolve(); return; }
        const step = elapsed < packTime ? -1 : Math.floor((elapsed - packTime) / s.hold);
        ctx.fillStyle = ["transparent","gradient","spotlight","grid","stars"].includes(s.background) ? s.color : backdrop(s); ctx.fillRect(0, 0, canvas.width, canvas.height);
        if(s.background === "gradient" || s.background === "spotlight") {
          const g=s.background === "gradient" ? ctx.createLinearGradient(0,0,canvas.width,canvas.height) : ctx.createRadialGradient(canvas.width/2,canvas.height/2,0,canvas.width/2,canvas.height/2,canvas.width*.6);
          g.addColorStop(0,s.background === "gradient" ? s.color : s.accent+"55");g.addColorStop(1,s.background === "gradient" ? s.accent+"66" : s.color);ctx.fillStyle=g;ctx.fillRect(0,0,canvas.width,canvas.height);
        }
        if(s.background === "grid" || s.background === "stars") { ctx.strokeStyle=s.accent+"22";ctx.fillStyle=s.accent+"66";for(let x=0;x<canvas.width;x+=32){if(s.background === "grid"){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();}else for(let y=0;y<canvas.height;y+=23)ctx.fillRect(x,y,2,2);}if(s.background === "grid")for(let y=0;y<canvas.height;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();} }

        const text = (value: string, x: number, y: number, size = 26, width = canvas.width - 70) => {
          ctx.fillStyle = "#ffffff"; ctx.font = `600 ${size}px system-ui`; ctx.fillText(value, x, y, width);
        };
        if (step < 0) {
          ctx.fillStyle = s.accent; ctx.fillRect(canvas.width * .25, canvas.height * .2, canvas.width * .5, canvas.height * .6);
          text("OPEN THE PACK", canvas.width * .28, canvas.height * .5, 38, canvas.width * .44);
        } else if (step >= cards.length) {
          if (last !== step) tone(audio, s, "complete", mix);
          text(`Pack complete · ${state.cards.reduce((n,c) => n+c.quantity,0)} cards`, 35, 55, 34);
          const all = state.cards; const columns = s.layout === "portrait" ? 4 : 8;
          const width = (canvas.width - 60) / columns; const rows = Math.ceil(all.length / columns);
          const height = Math.min(170, (canvas.height - 90) / rows);
          all.forEach((c, i) => {
            const x = 30 + i % columns * width; const y = 90 + Math.floor(i / columns) * height;
            ctx.fillStyle = "#293457"; ctx.fillRect(x, y, width-8, height-8);
            const img = images.get(c.id); if (img && height > 70) ctx.drawImage(img, x+8, y+4, width-24, height-34);
            text(`${c.quantity}× ${c.name}`, x+4, y+height-15, Math.max(9, Math.min(16,height/4)), width-16);
          });
        } else {
          const c = cards[step]; if (last !== step) tone(audio, s, "confirm", mix, c);
          const t = Math.min(1, ((elapsed-packTime)%s.hold) / s.duration);
          const portrait = s.layout === "portrait" || s.layout === "square";
          const h = (portrait ? canvas.height * .54 : canvas.height * .78) * Math.min(s.scale, 1.15), w = h * .714;
          const x = portrait ? (canvas.width-w)/2 : s.layout === "reverse" ? canvas.width-w-65 : 65, y = 45;
          ctx.save(); if (s.reveal === "fade" && !reduced) ctx.globalAlpha = t;
          ctx.translate(x+w/2,y+h/2);
          if (!reduced) {
            if(s.reveal === "slide")ctx.translate(-(1-t)*canvas.width*.3,0);
            if(s.reveal === "zoom" || s.reveal === "pop"){const k=s.reveal === "pop" ? 1-Math.pow(1-t,3)*Math.cos(t*Math.PI*3) : .6+.4*t;ctx.scale(Math.max(.01,k),Math.max(.01,k));}
            if(s.reveal === "tilt"){ctx.rotate((1-t)*-.25);ctx.globalAlpha=t;}
          }
          if (s.reveal === "flip" && !reduced) ctx.scale(Math.max(.01,Math.abs(Math.cos(Math.PI*t))),1);
          ctx.fillStyle = "#293457"; if (s.glow) { ctx.shadowColor=s.accent; ctx.shadowBlur=25; } ctx.fillRect(-w/2,-h/2,w,h); ctx.shadowBlur=0;
          const image = images.get(c.id);
          if (s.reveal === "flip" && t < .5 && !reduced) { const back=images.get("custom-back"); if(back)ctx.drawImage(back,-w/2,-h/2,w,h);else text("CARDVAULT", -w/2+15, 0, 30, w-30); }
          else if (image) ctx.drawImage(image,-w/2,-h/2,w,h);
          else text(c.name,-w/2+15,0,26,w-30);
          ctx.restore();
          const tx = portrait ? 40 : s.layout === "reverse" ? 40 : x+w+55, ty = portrait ? y+h+(s.layout === "square" ? 30 : 65) : 190;
          const max = s.layout === "reverse" ? x-75 : canvas.width-tx-35;
          text(c.name,tx,ty,34,max);
          if(s.details){text(c.set,tx,ty+50,24,max);text(`${c.number} · ${c.language} · ${c.finish}`,tx,ty+90,22,max);text(`${c.rarity} · ${c.quantity} copies`,tx,ty+(s.layout === "square" ? 112 : 130),22,max);}
          if(s.prices)text(c.price || "Price unavailable",tx,ty+(s.details?(s.layout === "square" ? 140 : 185):60),30,max);
          const prize=rewardFor(s,c);const age=(elapsed-packTime)%s.hold;
          if(prize&&prize.effect!=="none"&&age<2.4){ctx.save();ctx.fillStyle="#fff0a5";ctx.fillRect(canvas.width*.2,20,canvas.width*.6,58);ctx.fillStyle="#191428";ctx.font="900 28px system-ui";ctx.fillText(`${prize.label} · $${prize.threshold}+`,canvas.width*.22,58,canvas.width*.56);if(!reduced&&s.particles!==false){for(let i=0;i<(document.documentElement.dataset.effectsPower === "low" ? 6 : 12);i++){const a=i*Math.PI/6;ctx.fillStyle=i%2?"#8af0e2":"#f5a4e0";ctx.fillRect(canvas.width/2+Math.cos(a)*age*100,canvas.height/2+Math.sin(a)*age*90,prize.effect==="burst"?20:7,prize.effect==="sparks"?3:10);}}ctx.restore();}

        }
        last = step; progress(`Recording ${Math.min(100,Math.round(elapsed/duration*100))}%${missing ? ` · ${missing} images use a text fallback` : ""}`);
        timer = window.setTimeout(draw, 33);
      }; draw();
    });
    if(recorder.state !== "inactive")recorder.stop();
    const blob = await done; signal.removeEventListener("abort", abort);
    if(signal.aborted)throw new DOMException("Cancelled", "AbortError");
    return { blob, extension: mime.startsWith("video/mp4") ? "mp4" : "webm", missing };
  } finally {
    clearTimeout(timer); if(recorder.state !== "inactive")recorder.stop(); stream.getTracks().forEach(t => t.stop()); await audio.close();
  }
}
