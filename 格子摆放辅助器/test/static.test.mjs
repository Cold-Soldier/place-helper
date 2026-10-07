/* 静态一致性检查：index.html 的元素 id 与资源引用，是否和 JS 里的引用对得上。 */
import { readFileSync, existsSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
// 这些 id 是运行时由 JS 动态创建的，不出现在 index.html 里
const DYNAMIC_IDS = new Set(['resultGrid', 'selftest']);

let bad = 0;
for (const f of ['js/app.js', 'js/selftest.js']) {
  const src = readFileSync(f, 'utf8');
  const refs = new Set([...src.matchAll(/(?:getElementById|\$)\(\s*'([^']+)'\s*\)/g)].map(m => m[1]));
  for (const r of refs) {
    if (!ids.has(r) && !DYNAMIC_IDS.has(r)) { console.log('  缺失 id: ' + r + '  ← ' + f); bad++; }
  }
}
console.log('HTML 中 id 共 ' + ids.size + ' 个，JS 里找不到的引用 ' + bad + ' 个');

const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(u => !/^https?:/.test(u));
let miss = 0;
for (const a of assets) {
  const ok = existsSync(a);
  console.log((ok ? '  OK   ' : '  缺失 ') + a);
  if (!ok) miss++;
}
console.log(miss === 0 ? '所有资源文件都存在' : ('有 ' + miss + ' 个资源缺失'));
process.exit(bad + miss === 0 ? 0 : 1);
