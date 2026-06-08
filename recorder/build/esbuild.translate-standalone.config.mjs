/**
 * esbuild.translate-standalone.config.mjs - 独立翻译 EXE 打包配置
 *
 * 将 src/case_translate/standalone-cli.js 打包为 dist/translate-standalone.bundle.cjs
 * 供 pkg 进一步打包为 translate-standalone.exe
 *
 * 说明：build/ 位于 recorder/build/,recorder/ 即工程根。
 */

import * as esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname 是 recorder/build/,工程根是它的上一级 recorder/
const projectRoot = path.resolve(__dirname, '..');

await esbuild.build({
  entryPoints: [path.join(projectRoot, 'src/case_translate/standalone-cli.js')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: path.join(projectRoot, 'dist/translate-standalone.bundle.cjs'),
  format: 'cjs',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
});

console.log('Bundle created: dist/translate-standalone.bundle.cjs');
