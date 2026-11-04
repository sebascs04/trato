import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir(new URL('../assets/vendor/',import.meta.url),{recursive:true});
await build({entryPoints:[new URL('../project-grid-vendor.mjs',import.meta.url).pathname],outfile:new URL('../assets/vendor/project-grid-vendor.mjs',import.meta.url).pathname,bundle:true,minify:true,format:'esm',target:'es2022',legalComments:'eof'});
await copyFile(new URL('../node_modules/ag-grid-community/LICENSE.txt',import.meta.url),new URL('../docs/ag-grid-LICENSE.txt',import.meta.url));
