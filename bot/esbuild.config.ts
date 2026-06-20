/**
 * Zbot — esbuild Bundler Config
 */

import { build, type BuildOptions } from 'esbuild';

const isWatch = process.argv.includes('--watch');

const options: BuildOptions = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/bot.bundle.js',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
  external: [
    'fs', 'path', 'os', 'crypto', 'http', 'https', 'net', 'tls',
    'dns', 'url', 'querystring', 'stream', 'zlib', 'buffer', 'util',
    'events', 'child_process', 'worker_threads',
  ],
};

if (isWatch) {
  const ctx = await (await import('esbuild')).context(options);
  await ctx.watch();
  console.log('[esbuild] watching for changes...');
} else {
  await build(options);
  console.log('[esbuild] build complete -> dist/bot.bundle.js');
}
