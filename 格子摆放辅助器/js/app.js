/*!
 * app.js —— 界面逻辑
 * 依赖 pieces.js（Pieces）与 solver.js（Solver），均为浏览器全局。
 */
(function () {
  'use strict';

  var P = window.Pieces, SolverApi = window.Solver;
  var STORE_KEY = 'gridPacker.v1';
  var PALETTE = ['#4f8cff', '#3ecf8e', '#ffb454', '#ff7a90', '#b48cff', '#4fd8e0',
                 '#f6d743', '#ff9f6b', '#8ce99a', '#a0aec0'];

  /* ============================ 状态 ============================ */
  var state = {
    size: 6,
    locked: [],                 // 未解锁格索引
    types: [],                  // {id,name,color,cells:[[r,c]],count,allowMirror}
    solveMode: 'exact',
    timeLimit: 4000,
    allowMirror: true,
    draw: []                    // 画布选中的格子
  };
  var lastResult = null;

  var $ = function (id) { return document.getElementById(id); };
  var boardEl = $('board'), typeListEl = $('typeList'), paletteEl = $('palette'), drawGridEl = $('drawGrid');

  /* ============================ 工具 ============================ */
  function uid() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function nextColor() { return PALETTE[state.types.length % PALETTE.length]; }
  function normCells(cells) { return P.normalize(cells); }
  function cellKey(r, c) { return r + ',' + c; }

  /** 默认「初始 4×4」：只解锁中间 (size-2)×(size-2)，外面一圈锁定 */
  function defaultLocked(size) {
    var locked = [];
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (r === 0 || c === 0 || r === size - 1 || c === size - 1) locked.push(r * size + c);
      }
    }
    return locked;
  }
  function unlockedList() {
    var lockedSet = {};
    for (var i = 0; i < state.locked.length; i++) lockedSet[state.locked[i]] = 1;
    var out = [];
    for (var p = 0; p < state.size * state.size; p++) if (!lockedSet[p]) out.push(p);
    return out;
  }
  function ringSize() { return Math.max(1, state.size - 2); }

  /* ============================ 迷你形状预览 ============================ */
  function miniGrid(cells, cls) {
    var b = P.bounds(cells);
    var on = {};
    for (var i = 0; i < cells.length; i++) on[cells[i][0] + ',' + cells[i][1]] = 1;
    var el = document.createElement('div');
    el.className = 'mini-grid' + (cls ? ' ' + cls : '');
    el.style.gridTemplateColumns = 'repeat(' + b.w + ', auto)';
    for (var r = 0; r < b.h; r++) {
      for (var c = 0; c < b.w; c++) {
        var i2 = document.createElement('i');
        if (on[r + ',' + c]) i2.className = 'on';
        el.appendChild(i2);
      }
    }
    return el;
  }

  /* ============================ 棋盘渲染 ============================ */
  function renderBoard() {
    var size = state.size;
    var lockedSet = {};
    for (var i = 0; i < state.locked.length; i++) lockedSet[state.locked[i]] = 1;
    boardEl.style.gridTemplateColumns = 'repeat(' + size + ', auto)';
    boardEl.innerHTML = '';
    for (var p = 0; p < size * size; p++) {
      var cell = document.createElement('div');
      cell.className = 'cell' + (lockedSet[p] ? ' locked' : '');
      cell.dataset.index = p;
      cell.title = '第 ' + (Math.floor(p / size) + 1) + ' 行 第 ' + (p % size + 1) + ' 列（点击切换解锁）';
      cell.addEventListener('click', onCellClick);
      boardEl.appendChild(cell);
    }
    $('statUnlocked').textContent = size * size - state.locked.length;
    $('statLocked').textContent = state.locked.length;
    $('ringLabel').textContent = ringSize() + '×' + ringSize();
  }
  function onCellClick(e) {
    var p = parseInt(e.currentTarget.dataset.index, 10);
    var at = state.locked.indexOf(p);
    if (at >= 0) state.locked.splice(at, 1);
    else state.locked.push(p);
    renderBoard();
    save(); refreshStats();
  }

  /* ============================ 形状调色板 ============================ */
  function renderPalette() {
    paletteEl.innerHTML = '';
    var presets = P.presets();
    presets.forEach(function (ps) {
      var b = document.createElement('button');
      b.className = 'pal-btn';
      b.appendChild(miniGrid(ps.cells));
      var span = document.createElement('span');
      span.textContent = ps.name;
      b.appendChild(span);
      b.title = '加入「' + ps.name + '」';
      b.addEventListener('click', function () {
        addType(ps.cells, ps.name);
      });
      paletteEl.appendChild(b);
    });
  }

  /* ============================ 自己画形状 ============================ */
  function renderDrawGrid() {
    var N = 6;
    var on = {};
    for (var i = 0; i < state.draw.length; i++) on[cellKey(state.draw[i][0], state.draw[i][1])] = 1;
    drawGridEl.innerHTML = '';
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        var d = document.createElement('div');
        d.className = 'dc' + (on[cellKey(r, c)] ? ' on' : '');
        (function (rr, cc) {
          d.addEventListener('click', function () {
            var idx = -1;
            for (var k = 0; k < state.draw.length; k++) {
              if (state.draw[k][0] === rr && state.draw[k][1] === cc) { idx = k; break; }
            }
            if (idx >= 0) state.draw.splice(idx, 1);
            else state.draw.push([rr, cc]);
            renderDrawGrid();
          });
        })(r, c);
        drawGridEl.appendChild(d);
      }
    }
    var info = $('drawInfo');
    if (state.draw.length === 0) info.textContent = '点击格子拼出形状';
    else {
      var b = P.bounds(state.draw);
      info.textContent = state.draw.length + ' 格 · 外框 ' + b.w + '×' + b.h;
    }
  }
  $('drawClear').addEventListener('click', function () { state.draw = []; renderDrawGrid(); });
  $('drawTrim').addEventListener('click', function () {
    state.draw = normCells(state.draw);
    renderDrawGrid();
  });
  $('drawAdd').addEventListener('click', function () {
    if (!state.draw.length) { flashStatus('先在左边格子里画出形状'); return; }
    var name = $('drawName').value.trim();
    addType(normCells(state.draw.slice()), name || (state.draw.length + ' 格自定义'));
    $('drawName').value = '';
  });

  /* ============================ 物品清单 ============================ */
  function addType(cells, name) {
    if (!cells || !cells.length) return;
    var n = normCells(cells);
    state.types.push({
      id: uid(),
      name: name || (n.length + ' 格'),
      color: nextColor(),
      cells: n,
      count: 1,
      allowMirror: true
    });
    renderTypes(); save(); refreshStats();
  }

  function renderTypes() {
    typeListEl.innerHTML = '';
    $('typeCount').textContent = state.types.length + ' 种';
    if (!state.types.length) {
      var tip = document.createElement('div');
      tip.className = 'empty-tip';
      tip.textContent = '还没有物品：点上面形状库里任意形状，或用「自己画一个形状」';
      typeListEl.appendChild(tip);
      return;
    }
    state.types.forEach(function (t, i) {
      var row = document.createElement('div');
      row.className = 'item';

      var top = document.createElement('div');
      top.className = 'top';
      var prev = miniGrid(t.cells, 'lg');
      prev.style.color = t.color;
      top.appendChild(prev);

      var name = document.createElement('input');
      name.type = 'text';
      name.value = t.name;
      name.maxLength = 12;
      name.addEventListener('input', function () { t.name = name.value; save(); });
      top.appendChild(name);

      var cnt = document.createElement('input');
      cnt.type = 'number';
      cnt.className = 'qty';
      cnt.min = '0';
      cnt.max = String(state.size * state.size);
      cnt.value = String(t.count);
      cnt.title = '数量';
      cnt.addEventListener('input', function () {
        var v = parseInt(cnt.value, 10);
        t.count = isNaN(v) ? 0 : Math.max(0, Math.min(999, v));
        save(); refreshStats();
      });
      top.appendChild(cnt);

      var color = document.createElement('input');
      color.type = 'color';
      color.value = t.color;
      color.title = '颜色';
      color.addEventListener('input', function () { t.color = color.value; prev.style.color = color.value; save(); });
      top.appendChild(color);

      var del = document.createElement('button');
      del.className = 'mini ghost';
      del.textContent = '✕';
      del.title = '删除该物品';
      del.addEventListener('click', function () {
        state.types.splice(i, 1);
        renderTypes(); save(); refreshStats();
      });
      top.appendChild(del);
      row.appendChild(top);

      var desc = document.createElement('div');
      desc.className = 'desc';
      var txt = document.createElement('span');
      txt.textContent = P.describe(t.cells);
      desc.appendChild(txt);

      var mir = document.createElement('label');
      mir.className = 'f';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = t.allowMirror !== false;
      cb.addEventListener('change', function () { t.allowMirror = cb.checked; save(); refreshStats(); });
      mir.appendChild(cb);
      mir.appendChild(document.createTextNode('可镜像'));
      desc.appendChild(mir);
      row.appendChild(desc);

      typeListEl.appendChild(row);
    });
  }

  $('addRect').addEventListener('click', function () {
    var w = parseInt(prompt('矩形宽度（格）', '2'), 10);
    if (!w) return;
    var h = parseInt(prompt('矩形高度（格）', '2'), 10);
    if (!h) return;
    addType(P.rect(Math.max(1, Math.min(8, w)), Math.max(1, Math.min(8, h))), w + '×' + h);
  });
  $('addL').addEventListener('click', function () {
    var a = parseInt($('lA').value, 10), b = parseInt($('lB').value, 10);
    addType(P.lShape(a, b), 'L 形 ' + a + '×' + b);
  });
  $('clearTypes').addEventListener('click', function () {
    if (!state.types.length) return;
    if (!confirm('清空物品清单？')) return;
    state.types = [];
    renderTypes(); save(); refreshStats();
  });

  /* ============================ 统计 ============================ */
  function refreshStats() {
    var size = state.size, total = size * size;
    var unlocked = total - state.locked.length;
    var pieceArea = 0;
    for (var i = 0; i < state.types.length; i++) pieceArea += state.types[i].cells.length * state.types[i].count;
    $('statPieceArea').textContent = pieceArea;
    var fit = $('statFit');
    if (!state.types.length) { fit.textContent = '-'; }
    else if (pieceArea <= unlocked) { fit.textContent = '够放（占 ' + Math.round(pieceArea / unlocked * 100) + '%）'; }
    else { fit.textContent = '超出 ' + (pieceArea - unlocked) + ' 格'; }
    var lockedTooBig = state.types.some(function (t) { return P.bounds(t.cells).w > size || P.bounds(t.cells).h > size; });
    if (lockedTooBig) fit.textContent = '有物品放不进棋盘';
  }

  /* ============================ 存档 ============================ */
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(serialize())); } catch (e) { /* 忽略 */ }
  }
  function serialize() {
    return {
      v: 1, size: state.size, locked: state.locked, types: state.types,
      solveMode: state.solveMode, timeLimit: state.timeLimit, allowMirror: state.allowMirror
    };
  }
  function applyData(data, keepDraw) {
    if (!data || typeof data !== 'object') return false;
    if (data.size >= 4 && data.size <= 9) state.size = data.size;
    state.locked = Array.isArray(data.locked) ? data.locked.filter(function (x) {
      return typeof x === 'number' && x >= 0 && x < state.size * state.size;
    }) : defaultLocked(state.size);
    state.types = Array.isArray(data.types) ? data.types.map(function (t) {
      return {
        id: t.id || uid(),
        name: String(t.name || '物品').slice(0, 12),
        color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : nextColor(),
        cells: normCells(t.cells || []),
        count: Math.max(0, Math.min(999, parseInt(t.count, 10) || 0)),
        allowMirror: t.allowMirror !== false
      };
    }).filter(function (t) { return t.cells.length; }) : [];
    if (data.solveMode === 'beam' || data.solveMode === 'exact') state.solveMode = data.solveMode;
    if (data.timeLimit) state.timeLimit = data.timeLimit;
    if (typeof data.allowMirror === 'boolean') state.allowMirror = data.allowMirror;
    if (!keepDraw) state.draw = [];
    return true;
  }
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { /* 忽略 */ }
    if (raw) { try { if (applyData(JSON.parse(raw))) return; } catch (e) { /* 继续用默认 */ } }
    applyDefault();
  }
  function applyDefault() {
    state.size = 6;
    state.locked = defaultLocked(6);
    // 默认配置正好能铺满初始解锁的中心 4×4（16 格）
    state.types = [
      { id: uid(), name: '2×2', color: PALETTE[0], cells: P.rect(2, 2), count: 6, allowMirror: true },
      { id: uid(), name: '1×2', color: PALETTE[1], cells: P.rect(2, 1), count: 2, allowMirror: true }
    ];
    state.solveMode = 'exact';
    state.timeLimit = 4000;
    state.allowMirror = true;
    state.draw = [];
  }
  $('resetBtn').addEventListener('click', function () {
    if (!confirm('恢复到默认配置？当前配置会被覆盖。')) return;
    applyDefault(); syncControls(); renderAll(); save();
  });
  $('exportBtn').addEventListener('click', function () {
    var text = JSON.stringify(serialize(), null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        flashStatus('配置已复制到剪贴板');
      }, function () { window.prompt('复制下面的配置：', text); });
    } else { window.prompt('复制下面的配置：', text); }
  });
  $('importBtn').addEventListener('click', function () {
    var text = window.prompt('粘贴之前导出的配置 JSON：');
    if (!text) return;
    try {
      applyData(JSON.parse(text));
      syncControls(); renderAll(); save();
      flashStatus('配置已导入');
    } catch (e) { flashStatus('导入失败：不是合法的 JSON'); }
  });

  /* ============================ 控件同步 ============================ */
  function syncControls() {
    $('boardSize').value = String(state.size);
    $('solveMode').value = state.solveMode;
    $('timeLimit').value = String(state.timeLimit);
    $('allowMirror').checked = !!state.allowMirror;
  }
  $('boardSize').addEventListener('change', function () {
    var size = parseInt(this.value, 10);
    state.size = size;
    state.locked = defaultLocked(size);
    // 超出棋盘范围的物品直接去掉
    state.types = state.types.filter(function (t) {
      var b = P.bounds(t.cells);
      return b.w <= size && b.h <= size;
    });
    renderAll(); save();
  });
  $('presetRing').addEventListener('click', function () {
    state.locked = defaultLocked(state.size);
    renderBoard(); save(); refreshStats();
  });
  $('presetAll').addEventListener('click', function () {
    state.locked = []; renderBoard(); save(); refreshStats();
  });
  $('presetNone').addEventListener('click', function () {
    var all = [];
    for (var p = 0; p < state.size * state.size; p++) all.push(p);
    state.locked = all; renderBoard(); save(); refreshStats();
  });
  $('solveMode').addEventListener('change', function () { state.solveMode = this.value; save(); });
  $('timeLimit').addEventListener('change', function () { state.timeLimit = parseInt(this.value, 10); save(); });
  $('allowMirror').addEventListener('change', function () {
    state.allowMirror = this.checked;
    state.types.forEach(function (t) { t.allowMirror = state.allowMirror; });
    renderTypes(); save();
  });

  /* ============================ 标签页 ============================ */
  var tabs = document.querySelectorAll('#tabs button[data-view]');
  Array.prototype.forEach.call(tabs, function (b) {
    b.addEventListener('click', function () { setView(b.dataset.view); });
  });
  function setView(v) {
    Array.prototype.forEach.call(tabs, function (b) { b.classList.toggle('on', b.dataset.view === v); });
    $('viewBoard').classList.toggle('hidden', v !== 'board');
    $('viewResult').classList.toggle('hidden', v !== 'result');
  }

  /* ============================ 求解 ============================ */
  function flashStatus(msg, isErr) {
    var el = $('solveStatus');
    el.className = 'hint';
    el.innerHTML = '';
    if (isErr) {
      var d = document.createElement('div');
      d.className = 'err';
      d.textContent = msg;
      el.appendChild(d);
    } else {
      el.textContent = msg;
    }
  }

  function solveNow() {
    var types = state.types.filter(function (t) { return t.count > 0 && t.cells.length; });
    if (!types.length) { flashStatus('请先添加至少一种物品（数量要大于 0）', true); return; }
    var unlocked = unlockedList();
    if (!unlocked.length) { flashStatus('请先解锁至少一个格子', true); return; }

    $('solveBtn').disabled = true;
    flashStatus('正在求解…');
    var el = $('solveStatus');
    el.innerHTML = '';
    var busy = document.createElement('div');
    busy.className = 'busy';
    var sp = document.createElement('span'); sp.className = 'spinner';
    busy.appendChild(sp);
    busy.appendChild(document.createTextNode(' 正在计算最优摆放（预算 ' + (state.timeLimit / 1000) + ' 秒）…'));
    el.appendChild(busy);

    // 让界面先画出“忙碌”状态，再开始计算
    setTimeout(function () {
      var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
      var res;
      try {
        res = SolverApi.solve({
          size: state.size,
          unlocked: unlocked,
          mode: state.solveMode,
          timeLimit: state.timeLimit,
          types: types.map(function (t) {
            return { id: t.id, name: t.name, cells: t.cells, count: t.count, allowMirror: t.allowMirror !== false };
          })
        });
      } catch (e) {
        res = { ok: false, error: '求解出错：' + (e && e.message ? e.message : e) };
      }
      var ms = Math.round(((window.performance && performance.now) ? performance.now() : Date.now()) - t0);
      $('solveBtn').disabled = false;
      if (!res.ok) { flashStatus(res.error || '求解失败', true); return; }
      lastResult = res;
      renderResult(res, types, unlocked, ms);
      setView('result');
      $('solveStatus').textContent = '完成 · 用时 ' + ms + 'ms';
    }, 30);
  }
  $('solveBtn').addEventListener('click', solveNow);

  function typeColorMap(types) {
    var map = {};
    for (var i = 0; i < types.length; i++) map[types[i].id] = types[i].color;
    return map;
  }

  function renderResult(res, types, unlocked, ms) {
    var area = $('resultArea');
    area.innerHTML = '';
    var size = res.size;
    var colors = typeColorMap(types);

    /* --- 概览徽章 --- */
    var head = document.createElement('div');
    head.className = 'res-head';
    var pct = Math.round(res.utilization * 100);
    function badge(text, cls) {
      var b = document.createElement('span');
      b.className = 'badge' + (cls ? ' ' + cls : '');
      b.textContent = text;
      head.appendChild(b);
    }
    badge('填入 ' + res.placedArea + ' / ' + res.availableCells + ' 格（' + pct + '%）',
      res.placedArea === res.availableCells ? 'ok' : 'warn');
    badge('放置 ' + res.placedCount + ' 件', 'info');
    if (res.optimalProven) badge('已证明最优', 'ok');
    else if (res.optimal) badge('最优（全填满）', 'ok');
    else badge('当前找到的最好方案', 'warn');
    badge(res.method === 'exact' ? '精确搜索' : (res.method === 'beam' ? '快速启发式' : '精确搜索超时→启发式'));
    badge('搜索节点 ' + res.stats.nodes + ' · ' + ms + 'ms');
    area.appendChild(head);

    /* --- 摆放图 --- */
    var grid = document.createElement('div');
    grid.id = 'resultGrid';
    grid.style.gridTemplateColumns = 'repeat(' + size + ', auto)';
    var cellColor = {}, cellLabel = {}, number = {};
    var lockedSet = {};
    for (var k = 0; k < size * size; k++) lockedSet[k] = true;
    for (k = 0; k < unlocked.length; k++) lockedSet[unlocked[k]] = false;
    res.placements.forEach(function (p, pi) {
      var ch = String(pi + 1);
      for (var i = 0; i < p.cells.length; i++) {
        var idx = p.cells[i][0] * size + p.cells[i][1];
        cellColor[idx] = colors[p.id] || '#4f8cff';
        // 只在「该物品的最小格」写编号，画面更干净
        if (!(idx in cellLabel)) cellLabel[idx] = ch;
      }
      number[p.id] = (number[p.id] || 0) + 1;
    });
    for (var p2 = 0; p2 < size * size; p2++) {
      var cell = document.createElement('div');
      cell.className = 'cell';
      if (lockedSet[p2]) cell.classList.add('locked');
      else if (cellColor[p2]) {
        cell.classList.add('filled');
        cell.style.background = cellColor[p2];
      } else cell.classList.add('empty-open');
      if (cellColor[p2] && cellLabel[p2]) {
        var lb = document.createElement('span');
        lb.className = 'lbl';
        lb.textContent = cellLabel[p2];
        cell.appendChild(lb);
      }
      grid.appendChild(cell);
    }
    area.appendChild(grid);

    /* --- 物品明细 --- */
    var list = document.createElement('div');
    list.className = 'res-pieces';
    var placedCount = {};
    res.placements.forEach(function (p) { placedCount[p.id] = (placedCount[p.id] || 0) + 1; });
    types.forEach(function (t, i) {
      var put = placedCount[t.id] || 0;
      if (!put) return;
      var d = document.createElement('div');
      d.className = 'res-piece';
      var dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = t.color;
      d.appendChild(dot);
      var name = document.createElement('span');
      name.textContent = t.name;
      d.appendChild(name);
      var n = document.createElement('span');
      n.className = 'n';
      n.textContent = '× ' + put + (put < t.count ? '（' + t.count + ' 中放不下 ' + (t.count - put) + '）' : '');
      d.appendChild(n);
      list.appendChild(d);
    });
    area.appendChild(list);

    /* --- 剩余 / 空洞说明 --- */
    var left = document.createElement('div');
    left.className = 'leftover';
    var parts = [];
    if (res.leftover.length) {
      parts.push('放不下：' + res.leftover.map(function (l) { return l.name + ' ×' + l.count; }).join('、'));
    }
    if (res.leftoverArea > 0) parts.push('空着 ' + res.leftoverArea + ' 格');
    left.textContent = parts.length ? parts.join(' · ') : '全部物品都放下了，且没有空格';
    area.appendChild(left);

    /* --- 纯文本方案（复制用） --- */
    var pre = document.createElement('pre');
    pre.className = 'plan';
    pre.textContent = planText(res, types, unlocked);
    area.appendChild(pre);
  }

  function planText(res, types, unlocked) {
    var size = res.size;
    var grid = [];
    for (var r = 0; r < size; r++) {
      var row = [];
      for (var c = 0; c < size; c++) row.push(null);
      grid.push(row);
    }
    // 未解锁格标 X
    var open = {};
    for (var i = 0; i < unlocked.length; i++) open[unlocked[i]] = 1;
    for (var p = 0; p < size * size; p++) {
      if (!open[p]) grid[Math.floor(p / size)][p % size] = 'X';
    }
    var chars = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    res.placements.forEach(function (pl, idx) {
      var ch = idx < chars.length ? chars[idx] : '?';
      pl.cells.forEach(function (rc) { grid[rc[0]][rc[1]] = ch; });
    });
    var lines = [];
    lines.push('格子摆放方案（' + size + '×' + size + '，X = 未解锁格，· = 空着）');
    lines.push('填入 ' + res.placedArea + '/' + res.availableCells + ' 格（' +
      Math.round(res.utilization * 100) + '%），' +
      (res.optimalProven ? '已证明最优' : (res.optimal ? '最优（全填满）' : '当前找到的最好方案')));
    lines.push('');
    for (var r2 = 0; r2 < size; r2++) {
      var s = [];
      for (var c2 = 0; c2 < size; c2++) s.push(grid[r2][c2] === null ? '·' : String(grid[r2][c2]));
      lines.push(s.join(' '));
    }
    lines.push('');
    res.placements.forEach(function (pl, idx) {
      var ch = idx < chars.length ? chars[idx] : '?';
      lines.push(ch + '  ' + pl.name + '  左上角 (' + (pl.cells[0][0] + 1) + ',' + (pl.cells[0][1] + 1) + ')');
    });
    if (res.leftover.length) {
      lines.push('');
      lines.push('放不下：' + res.leftover.map(function (l) { return l.name + ' ×' + l.count; }).join('、'));
    }
    void types;
    return lines.join('\n');
  }

  $('copyBtn').addEventListener('click', function () {
    if (!lastResult) { flashStatus('先点「开始求解」'); return; }
    var text = planText(lastResult, state.types, unlockedList());
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flashStatus('方案已复制到剪贴板'); },
        function () { window.prompt('复制下面的方案：', text); });
    } else { window.prompt('复制下面的方案：', text); }
  });

  /* ============================ 启动 ============================ */
  function renderAll() {
    renderBoard(); renderPalette(); renderDrawGrid(); renderTypes(); refreshStats();
  }
  load();
  syncControls();
  renderAll();
  setView('board');

  // 键盘快捷键：Ctrl/Cmd + Enter 求解
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); solveNow(); }
  });

  // 暴露给自检脚本 / 控制台调试用（不影响正常使用）
  window.GridApp = {
    state: state,
    unlockedList: unlockedList,
    renderResult: renderResult,
    planText: planText,
    solveNow: solveNow,
    setView: setView,
    solveSync: function () {
      return SolverApi.solve({
        size: state.size,
        unlocked: unlockedList(),
        mode: state.solveMode,
        timeLimit: state.timeLimit,
        types: state.types.filter(function (t) { return t.count > 0; })
      });
    }
  };

  // 自检模式：地址栏加 #selftest 时运行（selftest.js）
  if (location.hash === '#selftest' && typeof window.__runSelfTest === 'function') {
    var box = document.createElement('pre');
    box.id = 'selftest';
    try {
      box.textContent = window.__runSelfTest();
    } catch (e) {
      box.textContent = 'SELFTEST-FAILED\nFAIL 自检脚本异常 :: ' + (e && e.stack ? e.stack : e);
    }
    document.body.appendChild(box);
  }
})();
