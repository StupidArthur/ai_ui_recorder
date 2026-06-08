/**
 * esbuild.config.mjs - 应用打包配置
 *
 * 将 src/app/index.js 打包为 dist/app.bundle.cjs
 * 供 pkg 进一步打包为单 EXE
 *
 * 说明：build/ 位于 recorder/build/,recorder/ 即工程根,
 *       projectRoot = __dirname,无需向上跳一级。
 */

import * as esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname 是 recorder/build/,工程根是它的上一级 recorder/
const projectRoot = path.resolve(__dirname, '..');

await esbuild.build({
  entryPoints: [path.join(projectRoot, 'src/app/index.js')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: path.join(projectRoot, 'dist/app.bundle.cjs'),
  format: 'cjs',
  sourcemap: false,
  minify: false,
  external: [
    'electron',
    'playwright',
    'playwright-core',
    'chromium-bidi',
  ],
  logLevel: 'info',
});

console.log('Bundle created: dist/app.bundle.cjs');
