import {expect,it} from "vitest";
import {assessCapture} from "./capture-quality";
it("flags dark, washed out and low detail captures without blocking scanning",()=>{
 expect(assessCapture(Array(192).fill(20))).toMatch(/dark/);
 expect(assessCapture(Array(192).fill(255))).toMatch(/glare/);
 expect(assessCapture(Array(192).fill(120))).toMatch(/focus/);
 expect(assessCapture(Array.from({length:192},(_,i)=>i%2?180:60))).toBe("");
});
