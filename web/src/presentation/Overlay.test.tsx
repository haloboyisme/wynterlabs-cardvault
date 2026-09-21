import {act,render,screen} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {apiRequest} from "../lib/api";
import {defaults,tone} from "./model";
import {Overlay} from "./Overlay";
vi.mock("../lib/api",()=>({apiRequest:vi.fn()}));
vi.mock("./Stage",()=>({Stage:()=>null}));
vi.mock("./model",async original=>({...await original<typeof import('./model')>(),tone:vi.fn()}));
const resume=vi.fn(()=>Promise.resolve());const close=vi.fn(()=>Promise.resolve());const create=vi.fn();
const snapshot=(revision=1,muted=false,audio="overlay")=>({revision,settings:{...defaults,muted,audio},cards:[],event:{kind:"confirm"}});
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();vi.stubGlobal("AudioContext",class {state="running";resume=resume;close=close;constructor(){create();}});vi.mocked(apiRequest).mockResolvedValue(snapshot());});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
async function mount(){const view=render(<Overlay/>);await act(async()=>{});return view;}
async function next(value:unknown){vi.mocked(apiRequest).mockResolvedValue(value as never);await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});}
it("starts OBS audio without a button and does not replay the initial event",async()=>{await mount();expect(create).toHaveBeenCalledTimes(1);expect(resume).toHaveBeenCalled();expect(screen.queryByRole("button")).toBeNull();expect(tone).not.toHaveBeenCalled();await next(snapshot(2));expect(tone).toHaveBeenCalledTimes(1);});
it("respects webpage mute, stops active audio, and resumes only for new events",async()=>{await mount();await next(snapshot(2,true));expect(close).toHaveBeenCalledTimes(1);expect(tone).not.toHaveBeenCalled();await next({...snapshot(3),event:null});expect(create).toHaveBeenCalledTimes(2);expect(tone).not.toHaveBeenCalled();await next(snapshot(4));expect(tone).toHaveBeenCalledTimes(1);});
it("stays silent while explicitly routed to the scanner",async()=>{vi.mocked(apiRequest).mockResolvedValue(snapshot(1,false,"scanner") as never);await mount();expect(create).not.toHaveBeenCalled();expect(screen.queryByRole("button")).toBeNull();});
it("does not block polling when autoplay needs a gesture",async()=>{resume.mockImplementationOnce(()=>new Promise<void>(()=>{}));await mount();await next(snapshot(2));expect(apiRequest).toHaveBeenCalledTimes(2);expect(screen.queryByRole("button")).toBeNull();});
it("closes audio on unmount and ignores unchanged revisions",async()=>{const view=await mount();await next(snapshot());expect(tone).not.toHaveBeenCalled();view.unmount();expect(close).toHaveBeenCalledTimes(1);});
