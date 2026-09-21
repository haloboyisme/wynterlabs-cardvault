import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
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
 it("saves mute preferences to the account and does not issue collection writes",async()=>{render(<Studio account/>);await screen.findByText("Save presentation settings");fireEvent.click(screen.getByLabelText("Mute all account sounds"));fireEvent.click(screen.getByText("Save presentation settings"));await waitFor(()=>expect(apiRequest).toHaveBeenCalledWith("/api/v1/presentation/settings",expect.objectContaining({method:"PUT",body:expect.stringContaining('"muted":true')})));});
 it("ignores pull events while capture is disabled",async()=>{render(<Studio/>);await screen.findByText("Save presentation settings");window.dispatchEvent(new CustomEvent("cardvault-presentation",{detail:{id:"x",kind:"confirm",card}}));expect(apiRequest).toHaveBeenCalledTimes(1);});
 it("publishes a saved pull only to presentation listeners",()=>{const listener=vi.fn();window.addEventListener("cardvault-presentation",listener);savedPull({name:"Example",printing_id:"p",image_uris:{},set:{name:"Test set"},collector_number:"42",language:"en",prices:{usd:"2.00"},rarity:"rare"} as any,"nonfoil",2);expect(listener.mock.calls[0][0].detail.card.quantity).toBe(2);expect(apiRequest).not.toHaveBeenCalled();window.removeEventListener("cardvault-presentation",listener);});
});

it("saves extended looks and renders a custom flip back with printing details", async()=>{
 render(<Studio account/>);await screen.findByText("Save presentation settings");
 fireEvent.change(screen.getByLabelText("Card animation"),{target:{value:"pop"}});
 fireEvent.change(screen.getByLabelText("Background"),{target:{value:"spotlight"}});
 fireEvent.change(screen.getByLabelText("Screen shape"),{target:{value:"square"}});
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

it("replays the persisted last session after remount without changing saved cards",async()=>{
 vi.mocked(apiRequest).mockResolvedValue({...state,cards:[],last_session:[{...card,name:"Previous pull"}]});
 const first=render(<Studio/>);await screen.findByText("Replay last session");first.unmount();
 const second=render(<Studio/>);const button=await screen.findByText("Replay last session");
 expect(button).not.toBeDisabled();fireEvent.click(button);
 expect(second.container.querySelector(".presentation-stage")).toHaveTextContent("Previous pull");
 expect(apiRequest).toHaveBeenCalledTimes(2);
});

it("replays beyond 100 pulls through the final card and full summary", () => {
  vi.useFakeTimers();
  try {
    const cards = Array.from({length: 405}, (_, index) => ({...card, id: `pull-${index}`, name: `Pull ${index}`, quantity: 1}));
    const session = {...state, cards, settings: {...defaults, pack: false, highlights: false, hold: 1}};
    expect(recapCards(session)).toHaveLength(405);
    const {unmount} = render(<Stage state={session} replay/>);
    act(() => { vi.advanceTimersByTime(404000); });
    expect(screen.getByRole("heading", {name: "Pull 404"})).toBeVisible();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText("405 cards · Pack complete")).toBeVisible();
    expect(screen.getByText("1× Pull 0")).toBeInTheDocument();
    expect(screen.getByText("1× Pull 404")).toBeInTheDocument();
    unmount();
  } finally { vi.useRealTimers(); }
});

it("defaults a new OBS link to overlay audio without clearing account mute",async()=>{
 const muted={...state,settings:{...defaults,muted:true}};
 vi.mocked(apiRequest).mockImplementation(async(path,options)=>path.endsWith('/link')?{token:'test-view-only'}:options?.method==='PUT'?{...muted,settings:JSON.parse(String(options.body))}:muted);
 render(<Studio/>);await screen.findByText('Create / rotate OBS link');
 fireEvent.click(screen.getByText('Create / rotate OBS link'));
 await waitFor(()=>expect(apiRequest).toHaveBeenCalledWith('/api/v1/presentation/settings',expect.objectContaining({method:'PUT',body:expect.stringContaining('"audio":"overlay"')})));
 const request=vi.mocked(apiRequest).mock.calls.find(([path,options])=>path.endsWith('/settings')&&options?.method==='PUT');
 expect(JSON.parse(String(request?.[1]?.body)).muted).toBe(true);
});


it("keeps detailed controls collapsed but available without losing settings", async()=>{
 render(<Studio account/>);
 await screen.findByText("Save presentation settings");
 const sounds=screen.getByText("2 · Sounds").closest("details")!;
 fireEvent.click(screen.getByRole("button", {name:/2 Sounds/}));
 expect(sounds).toHaveAttribute("open");
 expect(screen.getByLabelText("Mute all account sounds")).toBeVisible();
 const alerts=screen.getByText("Choose each alert sound").closest("details")!;
 expect(alerts).not.toHaveAttribute("open");
 fireEvent.click(screen.getByText("Choose each alert sound"));
 expect(screen.getByLabelText("Card found sound")).toBeVisible();
 expect(screen.getByLabelText("Card found sound").querySelectorAll("option")).toHaveLength(16);
 fireEvent.change(screen.getByLabelText("Card found sound"),{target:{value:"coin"}});
 fireEvent.click(screen.getByRole("button", {name:/1 Look/}));
 fireEvent.click(screen.getByText("Save presentation settings"));
 await waitFor(()=>expect(apiRequest).toHaveBeenCalledWith("/api/v1/presentation/settings",expect.objectContaining({body:expect.stringContaining('"found":"coin"')})));
});


it("switches focused workspaces without discarding a draft",async()=>{
 const {container}=render(<Studio/>);await screen.findByText("Save presentation settings");
 container.querySelector("details")!.open=true;
 fireEvent.change(screen.getByLabelText("Card animation"),{target:{value:"flip"}});
 fireEvent.click(screen.getByRole("button",{name:/3 Replay & OBS/}));
 expect(screen.getByRole("region",{name:"Pack recap controls"})).toBeVisible();
 expect(screen.queryByRole("region",{name:"Preview settings"})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:/1 Look/}));
 expect(screen.getByLabelText("Card animation")).toHaveValue("flip");
});
