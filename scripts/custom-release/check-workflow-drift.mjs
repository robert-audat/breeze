#!/usr/bin/env node
// Advisory-only: detect inherited workflow changes that need manual review.
// The baseline is a reviewed upstream Git blob snapshot, not a trusted build input.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const baseline=JSON.parse(readFileSync(new URL('./workflow-baseline.json',import.meta.url),'utf8'));
let drift=0;
for(const [path,expected] of Object.entries(baseline.blobs)){
 let actual;
 try { actual=execFileSync('git',['hash-object','--',path],{encoding:'utf8'}).trim(); }
 catch { actual='missing'; }
 if(actual!==expected){
   drift++;
   console.log('::warning file='+path+',title=Upstream workflow drift::Review original workflow and update matching CUSTOM workflow if needed. Expected '+expected+', found '+actual+'.');
 }
}
console.log('CUSTOM workflow drift: '+drift+' changed original(s) versus '+baseline.upstreamRelease);
if(process.env.GITHUB_STEP_SUMMARY){
 const { appendFileSync }=await import('node:fs');
 appendFileSync(process.env.GITHUB_STEP_SUMMARY,'### Original workflow drift\n'+drift+' original workflow(s) differ from reviewed '+baseline.upstreamRelease+' snapshot. Review warnings before publishing.\n');
}
