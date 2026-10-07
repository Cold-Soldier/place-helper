/*!
 * test/ui.test.mjs —— 界面逻辑测试
 *
 * 做法：用一套很小的 DOM 垫片（片状实现足够 app.js 使用）在 Node 里加载真实的
 * index.html 结构与 js/pieces.js、js/solver.js、js/selftest.js、js/app.js，
 * 然后运行界面自检脚本，验证点击、解锁、增删物品、求解、渲染、错误提示等行为。
 *
 * 运行：node test/ui.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/* ============================ 迷你 DOM 垫片 ============================ */
class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach(x => this.set.add(x)); }
  remove(...c) { c.forEach(x => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) { const on = force === undefined ? !this.set.has(c) : !!force; if (on) this.set.add(c); else this.set.delete(c); return on; }
  get value() { return Array.from(this.set).join(' '); }
}

class El {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc || null;
    this.children = [];
    this.childNodes = this.children;
    this.parentNode = null;
    this.classList = new ClassList();
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this._text = '';
    this._id = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.title = '';
  }
  get className() { return this.classList.value; }
  set className(v) { this.classList = new ClassList(); String(v).split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c)); }
  get textContent() {
    if (this.children.length) return this.children.map(c => c.textContent).join('');
    return this._text;
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return ''; }
  set innerHTML(v) { this.children = []; this._text = ''; }
  get id() { return this._id; }
  set id(v) {
    this._id = String(v);
    this.attributes.id = this._id;
    if (this.ownerDocument) this.ownerDocument._register(this);
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'id') this.id = v;
  }
  getAttribute(k) { return this.attributes[k]; }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.children.push(node);
    return node;
  }
  removeChild(node) { const i = this.children.indexOf(node); if (i >= 0) this.children.splice(i, 1); return node; }
  querySelector(sel) { return this.ownerDocument ? this.ownerDocument.querySelector(sel) : null; }
  querySelectorAll(sel) { return this.ownerDocument ? this.ownerDocument.querySelectorAll(sel) : []; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    const a = this.listeners[type] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
  }
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    ev.currentTarget = this;
    (this.listeners[ev.type] || []).forEach(fn => fn.call(this, ev));
    if (ev.bubbles && this.parentNode) this.parentNode.dispatchEvent(ev);
    return true;
  }
  click() { return this.dispatchEvent(new Ev('click', { bubbles: true })); }
  get firstChild() { return this.children[0] || null; }

  /** 深度优先收集后代 */
  descendants(pred, out) {
    out = out || [];
    this.children.forEach(c => { if (!pred || pred(c)) out.push(c); c.descendants(pred, out); });
    return out;
  }
}

class Ev {
  constructor(type, opts) { this.type = type; Object.assign(this, opts || {}); }
  preventDefault() {}
  stopPropagation() {}
}

class Doc {
  constructor() {
    this.body = new El('body', this);
    this.documentElement = new El('html', this);
    this.listeners = {};
    this._byId = new Map();
    this.readyState = 'complete';
  }
  _register(el) { this._byId.set(el.id, el); }
  createElement(tag) { return new El(tag, this); }
  createTextNode(t) { const e = new El('#text', this); e.textContent = t; return e; }
  getElementById(id) { return this._byId.get(id) || null; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const out = [];
    if (sel === '#tabs button[data-view]') {
      const tabs = this._byId.get('tabs');
      if (tabs) tabs.children.forEach(c => { if (c.tagName === 'BUTTON' && c.dataset.view) out.push(c); });
    } else if (sel === '#typeList .item input.qty') {
      const list = this._byId.get('typeList');
      if (list) list.descendants(c => c.tagName === 'INPUT' && c.classList.contains('qty'), out);
    }
    return out;
  }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
}

/* ============================ 构建 index.html 的骨架 ============================ */
function buildDom(doc) {
  // index.html 里所有被 app.js 引用的 id，按实际层级挂好
  const ids = [
    'app', 'panel', 'panelHead', 'panelBody',
    'boardSize', 'presetRing', 'ringLabel', 'presetAll', 'presetNone',
    'statUnlocked', 'statLocked',
    'palette', 'drawBox', 'drawGrid', 'drawInfo', 'drawName', 'drawClear', 'drawTrim', 'drawAdd',
    'lA', 'lB', 'addL',
    'typeList', 'typeCount', 'addRect', 'clearTypes', 'statPieceArea', 'statFit',
    'solveMode', 'timeLimit', 'allowMirror', 'solveBtn', 'copyBtn', 'solveStatus',
    'exportBtn', 'importBtn', 'resetBtn',
    'tabs', 'hintTag', 'stageMain', 'viewBoard', 'viewResult', 'resultArea', 'board'
  ];
  const map = {};
  ids.forEach(id => { const el = new El('div', doc); el.id = id; map[id] = el; });

  // 标签页按钮
  ['board', 'result'].forEach((v, i) => {
    const b = new El('button', doc);
    b.dataset.view = v;
    if (i === 0) b.classList.add('on');
    map.tabs.appendChild(b);
  });
  // 下拉框的取值能力
  map.boardSize.value = '6';
  map.solveMode.value = 'exact';
  map.timeLimit.value = '4000';
  map.lA.value = '3';
  map.lB.value = '2';
  doc.body.appendChild(map.app);
  return map;
}

/* ============================ 运行 ============================ */
const doc = new Doc();
buildDom(doc);

const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear()
};

const sandbox = {
  document: doc,
  localStorage,
  console,
  setTimeout: (fn) => { fn(); return 0; },     // 自检里不依赖异步
  clearTimeout: () => {},
  performance: { now: () => Date.now() },
  navigator: {},
  location: { hash: '#selftest', href: 'file:///index.html#selftest' },
  MouseEvent: Ev,
  Event: Ev,
  alert: () => {},
  confirm: () => true,
  prompt: () => null
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
// 自检脚本里会 new MouseEvent(...) / new Event(...)，垫片里用同一个 Ev 类顶上
sandbox.MouseEvent = Ev;
sandbox.Event = Ev;
vm.createContext(sandbox);

function loadScript(rel) {
  const code = readFileSync(join(root, rel), 'utf8');
  vm.runInContext(code, sandbox, { filename: rel });
}

let failed = false;
try {
  loadScript('js/pieces.js');
  loadScript('js/solver.js');
  loadScript('js/selftest.js');
  loadScript('js/app.js');
} catch (e) {
  console.error('\n[界面测试] 脚本加载失败：', e && e.stack ? e.stack : e);
  process.exit(1);
}

if (typeof sandbox.__runSelfTest !== 'function') {
  console.error('\n[界面测试] 自检脚本没有注册 window.__runSelfTest');
  process.exit(1);
}

const report = sandbox.__runSelfTest();
const lines = report.split('\n');
console.log('\n===== 界面自检报告 =====');
lines.forEach(l => {
  if (l.startsWith('FAIL')) { failed = true; console.log('  \u2717 ' + l.slice(5)); }
  else if (l.startsWith('PASS')) console.log('  \u2713 ' + l.slice(5));
  else console.log('  ' + l);
});

const passCount = lines.filter(l => l.startsWith('PASS')).length;
const failCount = lines.filter(l => l.startsWith('FAIL')).length;
console.log(`\n界面测试：通过 ${passCount} 项，失败 ${failCount} 项`);

// 额外检查：localStorage 里确实存下了配置
const saved = store.get('gridPacker.v1');
let savedOK = false;
try {
  const parsed = JSON.parse(saved);
  savedOK = parsed && parsed.size === 6 && Array.isArray(parsed.types);
} catch (e) { savedOK = false; }
console.log(savedOK ? '  \u2713 配置已写入本地存储' : '  \u2717 配置未写入本地存储');
if (!savedOK) failed = true;

process.exit(failed ? 1 : 0);
