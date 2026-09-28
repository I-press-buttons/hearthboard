// Bundle the server (and the shared TypeScript package) into one file.
// Runtime dependencies stay external and are installed in node_modules.
import { build } from 'esbuild';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: [new URL('./src/index.ts', import.meta.url).pathname],
  outfile: new URL('./dist/index.js', import.meta.url).pathname,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: Object.keys(pkg.dependencies ?? {}),
  banner: {
    // Some CommonJS dependencies still call require().
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
