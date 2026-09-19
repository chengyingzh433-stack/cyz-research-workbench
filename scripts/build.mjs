import { build as bundle } from 'esbuild';
import { build as vite } from 'vite';
import react from '@vitejs/plugin-react';
await bundle({entryPoints:['apps/desktop/src/main/main.ts'],bundle:true,platform:'node',target:'node24',format:'cjs',outfile:'dist/main.cjs',external:['electron','better-sqlite3']});
await bundle({entryPoints:['apps/desktop/src/preload/bridge.ts'],bundle:true,platform:'node',format:'cjs',outfile:'dist/preload.cjs',external:['electron']});
await vite({root:'apps/desktop',base:'./',plugins:[react()],build:{outDir:'../../dist/renderer',emptyOutDir:true},logLevel:'warn'});
console.log('DESKTOP_BUILT');
