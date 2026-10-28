import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import es from '../locales/es.mjs';
import en from '../locales/en.mjs';
const keys=Object.keys(es).sort();
assert.deepEqual(Object.keys(en).sort(),keys,'ES/EN must have identical keys');
const params=text=>[...text.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map(match=>match[1]).sort();
for(const key of keys){
 for(const [language,catalog]of [['es',es],['en',en]])assert.ok(typeof catalog[key]==='string'&&catalog[key].trim(),`${language}: empty translation ${key}`);
 assert.deepEqual(params(en[key]),params(es[key]),`Parameter mismatch: ${key}`);
}
for(const file of await readdir(new URL('../',import.meta.url))){
 if(!/\.(?:mjs|js)$/.test(file))continue;
 const source=await readFile(new URL('../'+file,import.meta.url),'utf8');
 for(const match of source.matchAll(/\buiText\(\s*((?:"(?:[^"\\]|\\.)*")|(?:'(?:[^'\\]|\\.)*'))/g)){
  const key=match[1][0]==='"'?JSON.parse(match[1]):match[1].slice(1,-1).replace(/\\'/g,"'").replace(/\\\\/g,'\\');
  assert.ok(Object.hasOwn(es,key),`${file}: missing translation ${key}`);
 }
}
for(const trait of ['patience','flexibility','price'])for(let value=1;value<=5;value++)assert.ok(Object.hasOwn(es,`practice.${trait}.${value}`));
console.log(`ES/EN: ${keys.length} paired translations, parameters and literal references verified.`);
