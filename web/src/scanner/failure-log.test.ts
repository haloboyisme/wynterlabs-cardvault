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
 expect(Object.keys(bodies[0]).sort()).toEqual(["attempts","mode","outcome","reasons","reported","revision","suspected"]);
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
