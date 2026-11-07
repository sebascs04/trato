import {uiText} from './i18n.mjs';

// One wording for every screen that waits for an uploaded document: the step comes from the backend
// (processing_stage/step/steps in /sources), never guessed in the browser.
const STAGES=new Set(['extracting','analyzing','chunking','summarizing','indexing']);

export function documentProgressLabel(file){
 if(!file||!STAGES.has(file.processing_stage)||!Number.isInteger(file.processing_step)||!Number.isInteger(file.processing_steps))return null;
 return uiText(`docProgress.${file.processing_stage}`,{step:file.processing_step,total:file.processing_steps});
}
