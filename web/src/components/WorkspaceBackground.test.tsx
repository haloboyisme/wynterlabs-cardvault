import {render,fireEvent} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import {it,expect,vi,afterEach} from "vitest";
import {WorkspaceBackground} from "./WorkspaceBackground";
import {EFFECTS_KEY} from "../lib/workspace-effects";
const state=vi.hoisted(()=>({user:{id:"one"},background:{preset:"none",upload:"data:image/gif;base64,R0lGODlh",still:"data:image/png;base64,aGVsbG8=",opacity:.3}}));
vi.mock("../app/auth",()=>({useAuth:()=>({user:state.user})}));
vi.mock("../app/branding",()=>({useBranding:()=>({branding:{design:{background:state.background}}})}));
afterEach(()=>{localStorage.clear();vi.unstubAllGlobals();state.user={id:"one"};});
it("uses a still during scanning and low power, animating only when enabled",()=>{
 localStorage.setItem(EFFECTS_KEY,JSON.stringify({lowPower:false,motion:true}));
 const {container,unmount}=render(<MemoryRouter initialEntries={["/scan"]}><WorkspaceBackground/></MemoryRouter>);
 expect(container.querySelector("img")?.src).toBe(state.background.still);unmount();
 const view=render(<MemoryRouter><WorkspaceBackground/></MemoryRouter>);
 expect(view.container.querySelector("img")?.src).toBe(state.background.upload);
 localStorage.setItem(EFFECTS_KEY,JSON.stringify({lowPower:true,motion:true}));fireEvent(window,new Event("workspace-effects"));
 expect(view.container.querySelector("img")?.src).toBe(state.background.still);
});
it("keeps personal backgrounds isolated by account",()=>{
 localStorage.setItem("wynterlabs.background.v277.one",JSON.stringify({preset:"anime"}));
 const {container,rerender}=render(<MemoryRouter><WorkspaceBackground/></MemoryRouter>);
 expect(container.querySelector("img")?.src).toContain("neon-evening.png");
 state.user={id:"two"};rerender(<MemoryRouter><WorkspaceBackground/></MemoryRouter>);
 expect(container.querySelector("img")?.src).toBe(state.background.still);
});
