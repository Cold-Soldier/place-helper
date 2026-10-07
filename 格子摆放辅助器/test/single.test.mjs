/*!
 * test/single.test.mjs —— 验证「单文件版」能用
 *
 * 做法：从单文件 HTML 里把内联脚本按顺序抽出来，在 mini-DOM 里执行，
 * 然后跑同一套界面自检。这样能确认内联后没有丢脚本、没有转义出错。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const singlePath = process.argv[2] || join(root, 'single', 'index.html');
const html = readFileSync(singlePath, 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? '  -> ' + extra : '')); }
}

check('单文件里没有外部 css/js 引用', !/<link rel="stylesheet"|<script src=/.test(html));
check('单文件自带样式', /<style>/.test(html));

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
check('抽到 4 段内联脚本（pieces/solver/selftest/app）', scripts.length === 4, 'scripts=' + scripts.length);

/* ---- 复用 ui.test.mjs 的垫片 ---- */
const uiSrc = readFileSync(join(here, 'ui.test.mjs'), 'utf8');
const shimSrc = uiSrc.split('/* ============================ 运行')[0]
  .replace(/^import .*$/gm, '')
  .replace(/^const here = .*$/gm, '')
  .replace(/^const root = .*$/gm, '');
const shimFile = join(here, '_shim_tmp.mjs');
(await import('node:fs')).writeFileSync(shimFile, shimSrc + '\nexport { Doc, El, Ev, buildDom };\n');
const shimMod = await import('./_shim_tmp.mjs?v=' + Date.now());
const { Doc, Ev, buildDom } = shimMod;

const doc = new Doc();
buildDom(doc);
const store = new Map();
const sandbox = {
  document: doc,
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear()
  },
  console,
  setTimeout: fn => { fn(); return 0; },
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  performance: { now: () => Date.now() },
  navigator: {},
  location: { hash: '#selftest', href: 'file:///single/index.html#selftest' },
  MouseEvent: Ev,
  Event: Ev,
  alert: () => {}, confirm: () => true, prompt: () => null
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
check('测试垫片导出了事件类', typeof Ev === 'function', 'typeof Ev=' + typeof Ev);

try {
  scripts.forEach((code, i) => {
    vm.runInContext(code, sandbox, { filename: 'inline-' + (i + 1) + '.js' });
  });
  check('四段脚本都能执行', true);
} catch (e) {
  check('四段脚本都能执行', false, e && e.message);
}

if (typeof sandbox.__runSelfTest === 'function') {
  const report = sandbox.__runSelfTest();
  const fails = report.split('\n').filter(l => l.startsWith('FAIL'));
  const passes = report.split('\n').filter(l => l.startsWith('PASS'));
  check('单文件版界面自检全过', fails.length === 0, fails.join(' | '));
  console.log('    （单文件版自检：通过 ' + passes.length + ' 项）');
} else {
  check('单文件版注册了自检函数', false);
}

(await import('node:fs')).unlinkSync(shimFile);
console.log('\n单文件版测试：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail === 0 ? 0 : 1);
