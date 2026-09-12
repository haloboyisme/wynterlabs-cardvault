import{describe,it,expect,vi}from"vitest";import{render,screen}from"@testing-library/react";
import{rewardFor,rewardDefaults,RewardEffect}from"./rewards";import{defaults,tone,type Pull}from"./model";
const card=(price:string,quantity=1)=>({price,quantity}as Pull);
describe("prize tiers",()=>{
 it.each([["$4.99",undefined],["$5.00",5],["$9.99",5],["$10",10],["$20.00",20],["$50",50],["$100",100],["$1,200.00",100]])("uses the highest USD tier for %s",(price,threshold)=>{expect(rewardFor(defaults,card(price))?.threshold).toBe(threshold);});
 it("does not multiply quantity, infer currencies, or celebrate unavailable prices",()=>{expect(rewardFor(defaults,card("$2",100))).toBeUndefined();for(const p of ["Price unavailable","€100","100","$NaN"])expect(rewardFor(defaults,card(p))).toBeUndefined();});
 it("respects disabled celebrations and per-tier preferences",()=>{expect(rewardFor({...defaults,rewards:false},card("$100"))).toBeUndefined();const tiers=rewardDefaults.map(t=>({...t,enabled:t.threshold!==100}));expect(rewardFor({...defaults,reward_tiers:tiers},card("$100"))?.threshold).toBe(50);});
 it("shows a message without particles when requested",()=>{const{container}=render(<RewardEffect tier={rewardDefaults[0]} eventKey="one" particles={false}/>);expect(screen.getByText("Nice pull!")).toBeVisible();expect(container.querySelectorAll("i")).toHaveLength(0);});
 it("master mute prevents both recognition and prize sounds",()=>{const context={state:"running",createOscillator:vi.fn()}as unknown as AudioContext;tone(context,{...defaults,muted:true},"found");tone(context,{...defaults,muted:true},"confirm",undefined,card("$100"));expect(context.createOscillator).not.toHaveBeenCalled();});
});

it("uses distinct found, accepted, and increasing prize jingles",()=>{
 const played:number[]=[];const context={state:"running",currentTime:0,destination:{},createOscillator:()=>{const o={type:"sine",frequency:{value:0},connect:()=>{},disconnect:()=>{},start:()=>played.push(o.frequency.value),stop:()=>{},onended:null};return o;},createGain:()=>({gain:{setValueAtTime:()=>{},linearRampToValueAtTime:()=>{},exponentialRampToValueAtTime:()=>{}},connect:()=>{},disconnect:()=>{}})}as unknown as AudioContext;
 tone(context,defaults,"found");expect(played.splice(0)).toEqual([440,660]);tone(context,defaults,"confirm");expect(played.splice(0)).toEqual([659,880]);
 let previous=2;for(const value of [5,10,20,50,100]){tone(context,defaults,"confirm",undefined,card(`$${value}`));expect(played.length).toBeGreaterThan(previous);previous=played.length;played.length=0;}
});
