import { build } from 'esbuild';
await build({ entryPoints: ['electron/main.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: 'dist-electron/main.cjs', sourcemap: true });
await build({ entryPoints: ['electron/preload.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: 'dist-electron/preload.cjs', sourcemap: true });
