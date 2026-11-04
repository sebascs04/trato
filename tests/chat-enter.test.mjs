import test from 'node:test';
import assert from 'node:assert/strict';
import {submitChatOnEnter} from '../ai-activity.mjs';
function fixture(extra={}){let sent=0,prevented=false;const button={disabled:false};const event={key:'Enter',target:{matches:()=>true,value:'Hello',form:{querySelector:()=>button,requestSubmit:()=>sent++}},preventDefault(){prevented=true;},...extra};return {event,button,get sent(){return sent},get prevented(){return prevented}};}
test('Enter uses the existing form submission once',()=>{const f=fixture();submitChatOnEnter(f.event,'textarea');assert.equal(f.sent,1);assert.equal(f.prevented,true);});
test('newlines and IME composition do not submit',()=>{for(const extra of [{shiftKey:true},{isComposing:true},{keyCode:229},{ctrlKey:true}]){const f=fixture(extra);submitChatOnEnter(f.event,'textarea');assert.equal(f.sent,0);assert.equal(f.prevented,false);}});
test('held Enter, empty messages and disabled sends do not submit',()=>{for(const mode of ['repeat','empty','disabled']){const f=fixture();if(mode==='repeat')f.event.repeat=true;if(mode==='empty')f.event.target.value='  ';if(mode==='disabled')f.button.disabled=true;submitChatOnEnter(f.event,'textarea');assert.equal(f.sent,0);}});
