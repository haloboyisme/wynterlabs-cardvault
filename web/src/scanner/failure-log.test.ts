import {beforeEach,expect,it,vi} from "vitest";
import {apiRequest} from "../lib/api";
import {createScanTrace,qualityTags,setScanLogAccount} from "./failure-log";
vi.mock("../lib/api",()=>({apiRequest:vi.fn(async()=>({saved:true}))}));
beforeEach(()=>{vi.clearAllMocks();setScanLogAccount(crypto.randomUUID());});
it.each(["single","multiple","diy"] as const)("keeps first failure and retry recovery for %s",async(mode)=>{
 const trace=createScanTrace(mode);trace.hint(qualityTags("check focus"));trace.fail("no_catalog_match");trace.retry();trace.resolve("recovered_by_retry");await trace.flush();
 const bodies=vi.mocked(apiRequest).mock.calls.map(call=>JSON.parse(String(call[1]?.body)));
 expect(bodies[0]).toMatchObject({mode,attempts:1,outcome:"unresolved",reasons:["no_catalog_match"],suspected:["blur"]});
 expect(bodies[1]).toMatchObject({attempts:2,outcome:"recovered_by_retry",reasons:["no_catalog_match"]});
 expect(vi.mocked(apiRequest).mock.calls[0][0]).toBe(vi.mocked(apiRequest).mock.calls[1][0]);
 expect(Object.keys(bodies[0]).sort()).toEqual(["attempts","diagnostics","mode","outcome","reasons","reported","revision","suspected"]);
});
it("logs manual corrections but not successful first attempts",async()=>{
 const trace=createScanTrace("single");trace.saved();await trace.flush();expect(apiRequest).not.toHaveBeenCalled();
 trace.fail("wrong_match",true);trace.manual();trace.saved();await trace.flush();
 expect(JSON.parse(String(vi.mocked(apiRequest).mock.calls.at(-1)?.[1]?.body))).toMatchObject({outcome:"corrected_manually",reported:["wrong_match"]});
});
it("retries the same revision and suppresses writes after account changes",async()=>{
 vi.mocked(apiRequest).mockRejectedValueOnce(new Error("offline"));
 const trace=createScanTrace("single");trace.fail("timeout");await trace.flush();
 expect(vi.mocked(apiRequest).mock.calls[0][1]?.body).toBe(vi.mocked(apiRequest).mock.calls[1][1]?.body);
 setScanLogAccount("another-user");trace.resolve("skipped");await trace.flush();expect(apiRequest).toHaveBeenCalledTimes(2);
});

const card=(id:string,name:string)=>({printing_id:id,oracle_id:'oracle',name,set:{code:'dsk',name:'Duskmourn',game:'mtg'},collector_number:'12',language:'en',finishes:['nonfoil','foil']});
it('keeps original suggestion and actual accepted finish after correction',async()=>{
 const trace=createScanTrace('multiple');trace.suggest(card('a','Wrong card'),true);trace.suggest(card('b','Right card'),true);trace.saved(card('b','Right card'),'foil');await trace.flush();
 const body=JSON.parse(String(vi.mocked(apiRequest).mock.calls.at(-1)?.[1]?.body));
 expect(body.diagnostics.suggested.name).toBe('Wrong card');expect(body.diagnostics.accepted).toMatchObject({name:'Right card',finish:'foil'});expect(body.reported).toContain('wrong_match');
});
it('records finish changes as default corrections, not camera foil detection',async()=>{
 const trace=createScanTrace('single');trace.suggest(card('a','Card'),true);trace.saved(card('a','Card'),'foil');await trace.flush();
 const body=JSON.parse(String(vi.mocked(apiRequest).mock.calls.at(-1)?.[1]?.body));expect(body.reported).toContain('finish_changed');expect(body.diagnostics.suggested.finish_source).toBe('default');
});

it('choosing among ambiguous candidates is not reported as a wrong automatic selection',async()=>{
 const trace=createScanTrace('multiple');trace.suggest(card('a','Candidate'),false);trace.fail('ambiguous_printing');trace.manual();trace.saved(card('b','Chosen card'),'nonfoil');await trace.flush();
 const body=JSON.parse(String(vi.mocked(apiRequest).mock.calls.at(-1)?.[1]?.body));expect(body.reported).not.toContain('wrong_match');expect(body.diagnostics.accepted.name).toBe('Chosen card');
});
