import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Studio } from "./Studio";
import { Stage } from "./Stage";
import { defaults, recapCards, savedPull, type Presentation } from "./model";
import { apiRequest } from "../lib/api";
vi.mock("../app/auth",()=>({useAuth:()=>({user:{id:"owner"}})}));
vi.mock("../lib/api",()=>({apiRequest:vi.fn()}));
const card={id:"one",name:"Example",printing_id:"p",image:"",set:"Test set",number:"42",language:"en",finish:"foil",price:"$2",rarity:"rare",quantity:2,highlight:false};
const state:Presentation={settings:defaults,cards:[card],finished:false,revision:1,event:{id:"one",kind:"confirm"}};
beforeEach(()=>{vi.mocked(apiRequest).mockReset();vi.mocked(apiRequest).mockResolvedValue(state);});
describe("streamer presentation",()=>{
 it("preserves printing details in plain mode and can hide them",()=>{const {rerender}=render(<Stage state={state}/>);expect(screen.getByText("Test set")).toBeVisible();expect(screen.getByText("$2")).toBeVisible();rerender(<Stage state={{...state,settings:{...defaults,details:false,prices:false}}}/>);expect(screen.queryByText("Test set")).toBeNull();expect(screen.queryByText("$2")).toBeNull();});
 it("keeps duplicates and falls back to all cards when no highlights exist",()=>{const s={...state,settings:{...defaults,highlights:true},cards:[card,{...card,id:"two"}]};expect(recapCards(s)).toHaveLength(2);expect(recapCards({...s,cards:[card,{...card,id:"two",highlight:true}]})).toHaveLength(1);});
 it("saves mute preferences to the account and does not issue collection writes",async()=>{render(<Studio account/>);await screen.findByText("Save presentation settings");fireEvent.click(screen.getByLabelText("Account master mute"));fireEvent.click(screen.getByText("Save presentation settings"));await waitFor(()=>expect(apiRequest).toHaveBeenCalledWith("/api/v1/presentation/settings",expect.objectContaining({method:"PUT",body:expect.stringContaining('"muted":true')})));});
 it("ignores pull events while capture is disabled",async()=>{render(<Studio/>);await screen.findByText("Save presentation settings");window.dispatchEvent(new CustomEvent("cardvault-presentation",{detail:{id:"x",kind:"confirm",card}}));expect(apiRequest).toHaveBeenCalledTimes(1);});
 it("publishes a saved pull only to presentation listeners",()=>{const listener=vi.fn();window.addEventListener("cardvault-presentation",listener);savedPull({name:"Example",printing_id:"p",image_uris:{},set:{name:"Test set"},collector_number:"42",language:"en",prices:{usd:"2.00"},rarity:"rare"} as any,"nonfoil",2);expect(listener.mock.calls[0][0].detail.card.quantity).toBe(2);expect(apiRequest).not.toHaveBeenCalled();window.removeEventListener("cardvault-presentation",listener);});
});

it("saves extended looks and renders a custom flip back with printing details", async()=>{
 render(<Studio account/>);await screen.findByText("Save presentation settings");
 fireEvent.change(screen.getByLabelText("Reveal"),{target:{value:"pop"}});
 fireEvent.change(screen.getByLabelText("Background"),{target:{value:"spotlight"}});
 fireEvent.change(screen.getByLabelText("Layout"),{target:{value:"square"}});
 fireEvent.click(screen.getByText("Save presentation settings"));
 await waitFor(()=>expect(apiRequest).toHaveBeenCalledWith("/api/v1/presentation/settings",expect.objectContaining({body:expect.stringContaining('"reveal":"pop"')})));
});
it("uses the saved card back and preserves card details in alternate layouts",()=>{
 const back="data:image/png;base64,iVBORw0KGgo=";
 const {container}=render(<Stage state={{...state,settings:{...defaults,reveal:"flip",layout:"reverse",card_back:back}}}/>);
 expect(screen.getByAltText("Custom card back")).toHaveAttribute("src",back);
 expect(container.querySelector(".presentation-stage.reverse")).not.toBeNull();
 expect(screen.getByText("Test set")).toBeVisible();
});

it("recognizes each capture once without duplicating feedback on quantity changes",async()=>{
 render(<Studio/>);await screen.findByText("Save presentation settings");const feedback=vi.fn();window.addEventListener("cardvault-pull-feedback",feedback);
 const found=(key:string,quantity:number)=>window.dispatchEvent(new CustomEvent("cardvault-selected-preview",{detail:{...card,printing_id:"same-printing",preview_key:key,quantity}}));
 found("capture-a",1);found("capture-a",2);found("capture-b",1);
 expect(feedback).toHaveBeenCalledTimes(2);expect(feedback.mock.calls[0][0].detail.kind).toBe("found");expect(apiRequest).toHaveBeenCalledTimes(1);
 window.removeEventListener("cardvault-pull-feedback",feedback);
});
