import {expect,it,vi} from 'vitest';
import {refinePrinting} from './refine-printing';
import {recognizeCardPhoto} from '../lib/scanner';
import {getScanCandidates,expandScanCandidates} from '../lib/catalog';
import type {ScanCandidate} from '../lib/types';
vi.mock('../lib/scanner',()=>({recognizeCardPhoto:vi.fn()}));
vi.mock('../lib/catalog',()=>({getScanCandidates:vi.fn(),expandScanCandidates:vi.fn(async(c)=>c)}));
const candidate={printing_id:'right',name:'Black Lotus',set:{code:'lea',game:'mtg'},collector_number:'233',rank_reason:'exact_printing'} as ScanCandidate;
it('recovers an exact printing from deeper collector information',async()=>{
 vi.mocked(recognizeCardPhoto).mockResolvedValue({name:'Black Lotus',titleCandidates:[],rawText:'',set:'lea',collector:'233'});
 vi.mocked(getScanCandidates).mockResolvedValue([candidate]);
 const result=await refinePrinting(new Blob(),new AbortController().signal);
 expect(result?.candidates[0].printing_id).toBe('right');expect(recognizeCardPhoto).toHaveBeenLastCalledWith(expect.any(Blob),expect.any(AbortSignal),true);
});
it('does not replace original candidates with another ambiguous result',async()=>{
 vi.mocked(getScanCandidates).mockResolvedValue([candidate,{...candidate,printing_id:'other'}]);
 expect(await refinePrinting(new Blob(),new AbortController().signal)).toBeNull();
});
