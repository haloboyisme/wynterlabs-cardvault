import {it,expect} from "vitest";
import {backgroundSettings,backgroundDefaults,prepareBackground} from "./backgrounds";
it("retains defaults for old branding and rejects unsafe URLs",()=>{
 expect(backgroundSettings()).toEqual(backgroundDefaults);
 expect(backgroundSettings({upload:"javascript:alert(1)",preset:"unknown",opacity:9})).toMatchObject({upload:"",preset:"none",opacity:.8});
 expect(backgroundSettings({upload:"https://example.com/tracker.gif"}).upload).toBe("");
});
it("rejects unsupported or oversized uploads before decoding",async()=>{
 await expect(prepareBackground(new File(["svg"],"file.svg",{type:"image/svg+xml"}))).rejects.toThrow("PNG");
 await expect(prepareBackground(new File([new Uint8Array(1048577)],"file.gif",{type:"image/gif"}))).rejects.toThrow("1 MB");
});
