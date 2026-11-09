import {readFileSync,writeFileSync} from 'node:fs';
import {textForLanguage} from '../i18n.mjs';
const dir=new URL('../supabase/templates/',import.meta.url);
const layout=readFileSync(new URL('confirmation-layout.html',dir),'utf8');
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
// Client accounts (signup data account_role=client) get their own title, body and footer; the rest is shared.
const clientKeys=new Set(['title','body','footer']);
const render=(lang,role='freelancer')=>layout.replace('lang="es"','lang="'+lang+'"').replace(/@@([a-z]+)@@/g,(_,key)=>escape(textForLanguage(lang,(role==='client'&&clientKeys.has(key)?'authEmail.client.':'authEmail.')+key)));
const byRole=lang=>'{{ if eq .Data.account_role "client" }}'+render(lang,'client')+'{{ else }}'+render(lang)+'{{ end }}';
for(const lang of ['es','en']){writeFileSync(new URL('confirmation-'+lang+'.html',dir),render(lang));writeFileSync(new URL('confirmation-client-'+lang+'.html',dir),render(lang,'client'));}
writeFileSync(new URL('confirmation.html',dir),'{{ if eq .Data.output_language "en" }}'+byRole('en')+'{{ else }}'+byRole('es')+'{{ end }}');
writeFileSync(new URL('confirmation-subject.txt',dir),'{{ if eq .Data.output_language "en" }}'+textForLanguage('en','authEmail.subject')+'{{ else }}'+textForLanguage('es','authEmail.subject')+'{{ end }}');
console.log('Confirmation email generated: ES/EN × freelancer/client');
