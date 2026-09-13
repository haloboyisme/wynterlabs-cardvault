import {expect,it,vi} from "vitest";
import {SOUND_IDS,SOUND_PATTERNS} from "./sounds";
import {defaults,tone} from "./model";
it("offers 15 distinct bounded sound patterns",()=>{
 expect(SOUND_IDS).toHaveLength(15);
 expect(new Set(Object.values(SOUND_PATTERNS).map(p=>JSON.stringify(p))).size).toBe(15);
 for(const p of Object.values(SOUND_PATTERNS)){expect(p.notes.length).toBeLessThanOrEqual(9);expect(p.notes.every(n=>n>0&&n<3000)).toBe(true);}
});
it.each(SOUND_IDS)("plays %s in every feedback event and respects mute",sound=>{
 const start=vi.fn();const ctx={state:"running",currentTime:0,destination:{},createOscillator:()=>({frequency:{value:0},connect:vi.fn(),disconnect:vi.fn(),start,stop:vi.fn()}),createGain:()=>({gain:{setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn()})} as unknown as AudioContext;
 for(const kind of ["found","confirm","reject","complete"] as const){start.mockClear();tone(ctx,{...defaults,[kind]:sound},kind);expect(start).toHaveBeenCalled();start.mockClear();tone(ctx,{...defaults,[kind]:sound,muted:true},kind);expect(start).not.toHaveBeenCalled();}
});
