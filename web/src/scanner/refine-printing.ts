import {recognizeCardPhoto} from '../lib/scanner';
import {getScanCandidates,expandScanCandidates} from '../lib/catalog';
import {filterConfidentScanCandidates} from './title-confidence';
import {rankScanCandidates,uniqueDetectedPrintingId} from './printing-match';

// Keep the original review choices unless a deeper read identifies one printing.
export async function refinePrinting(photo:Blob,signal:AbortSignal,preferredSet?:string,preferredGame?:string,game?:string) {
 const hints=await recognizeCardPhoto(photo,signal,true);
 const titles=[...new Set([hints.name,...hints.titleCandidates].map(n=>n.trim()).filter(Boolean))].slice(0,8);
 for(const name of titles){
  const match={name,set:hints.set,collector:hints.collector};
  const result=await getScanCandidates({...match,preferredSet,preferredGame,game},signal);
  const confident=filterConfidentScanCandidates(name,result);
  if(!confident.length)continue;
  const candidates=rankScanCandidates(await expandScanCandidates(confident,signal,game),match,preferredSet,preferredGame);
  if(uniqueDetectedPrintingId(candidates,match,preferredSet,preferredGame))return {candidates,hints:match};
 }
 return null;
}
