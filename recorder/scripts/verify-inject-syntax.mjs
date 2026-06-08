/**
 * 回归：确保 buildInjectedScript() 产出可被浏览器解析的合法 JS。
 * 用法：node scripts/verify-inject-syntax.mjs
 */
import { buildInjectedScript } from '../src/recorder/inject-script.js';

const s = buildInjectedScript();
try {
  new Function(s);
  console.log('inject-script OK, length=', s.length);
} catch (e) {
  console.error('inject-script FAIL:', e.message);
  process.exit(1);
}
