/*!
 * selftest.js —— 界面自检脚本
 * 在浏览器里由 index.html#selftest 触发，也可被 Node 测试脚本直接调用。
 * 返回一段纯文本报告（首行为 SELFTEST-OK / SELFTEST-FAILED）。
 */
(function () {
  'use strict';

  function run() {
    var log = [], ok = true;
    function expect(name, cond, extra) {
      if (!cond) ok = false;
      log.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + extra : ''));
    }
    var $ = function (id) { return document.getElementById(id); };

    try {
      var App = window.GridApp, SolverApi = window.Solver;
      if (!App) throw new Error('window.GridApp 不存在（app.js 没加载成功？）');

      /* ---- 默认状态 ---- */
      var initialTypes = App.state.types.length;
      expect('默认棋盘 6×6', App.state.size === 6, 'size=' + App.state.size);
      expect('默认只解锁中心 16 格', App.unlockedList().length === 16, 'unlocked=' + App.unlockedList().length);
      expect('棋盘渲染 36 格', $('board').children.length === 36, 'cells=' + $('board').children.length);
      expect('默认有物品', initialTypes >= 1, 'types=' + initialTypes);
      expect('形状库（含 L 形）不少于 12 个', $('palette').children.length >= 12, 'palette=' + $('palette').children.length);
      expect('画布渲染 36 格', $('drawGrid').children.length === 36, 'draw=' + $('drawGrid').children.length);

      /* ---- 默认配置应当正好铺满初始 4×4 ---- */
      var def = App.solveSync();
      expect('默认配置就能铺满 16 格', def.ok && def.placedArea === 16, 'area=' + def.placedArea + ' ok=' + def.ok);

      /* ---- 点格子解锁 ---- */
      var before = App.unlockedList().length;
      $('board').children[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect('点击外围格可解锁', App.unlockedList().length === before + 1,
        before + ' -> ' + App.unlockedList().length);
      $('board').children[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect('再点一次可重新锁定', App.unlockedList().length === before, 'now=' + App.unlockedList().length);

      /* ---- 全部解锁 / 初始 ---- */
      $('presetAll').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect('「全部解锁」后 36 格可用', App.unlockedList().length === 36, 'unlocked=' + App.unlockedList().length);
      $('presetRing').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect('「初始」后回到中心 4×4', App.unlockedList().length === 16, 'unlocked=' + App.unlockedList().length);

      /* ---- 加 L 形 ---- */
      var n0 = App.state.types.length;
      $('addL').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect('可以加入 L 形物品', App.state.types.length === n0 + 1, 'types=' + App.state.types.length);
      var L = App.state.types[App.state.types.length - 1];
      expect('L 形是 4 格', L.cells.length === 4, 'cells=' + JSON.stringify(L.cells));

      /* ---- 形状库按钮 ---- */
      $('palette').children[6].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect('形状库按钮可加入物品', App.state.types.length === n0 + 2, 'types=' + App.state.types.length);

      /* ---- 自己画形状 ---- */
      var dg = $('drawGrid');
      var savedDraw = App.state.draw.slice();
      App.state.draw = [];              // 让自检可以重复运行而不受上次残留影响
      function clickDraw(i) {
        dg.children[i].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
      clickDraw(0);
      expect('画布点 1 下', App.state.draw.length === 1, 'draw=' + App.state.draw.length);
      clickDraw(1);
      clickDraw(7);
      expect('画布已选中 3 格', App.state.draw.length === 3, 'draw=' + App.state.draw.length);
      $('drawAdd').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect('自定义形状已加入清单', App.state.types.length === n0 + 3, 'types=' + App.state.types.length);
      var custom = App.state.types[App.state.types.length - 1];
      expect('自定义形状被归一化贴边', custom.cells[0][0] === 0 && custom.cells[0][1] === 0,
        JSON.stringify(custom.cells));

      /* ---- 数量控件 ---- */
      var itemCountInput = document.querySelector('#typeList .item input.qty');
      expect('物品行有数量输入框', !!itemCountInput);
      if (itemCountInput) {
        itemCountInput.value = '3';
        itemCountInput.dispatchEvent(new Event('input', { bubbles: true }));
        expect('修改数量生效', App.state.types[0].count === 3, 'count=' + App.state.types[0].count);
      }

      /* ---- 求解（同步） ---- */
      var res = App.solveSync();
      expect('求解器返回成功', res.ok === true, res.error || '');
      expect('有物品被放下', res.placements.length > 0, 'placements=' + res.placements.length);
      var openSet = {}, s = App.state.size;
      App.unlockedList().forEach(function (x) { openSet[x] = 1; });
      var seen = {}, overlap = false, outside = false, overCount = {};
      res.placements.forEach(function (p) {
        overCount[p.id] = (overCount[p.id] || 0) + 1;
        p.cells.forEach(function (rc) {
          var idx = rc[0] * s + rc[1];
          if (seen[idx]) overlap = true;
          seen[idx] = 1;
          if (!openSet[idx]) outside = true;
        });
      });
      expect('摆放无重叠', !overlap);
      expect('没有压到未解锁格', !outside);
      var typesById = {};
      App.state.types.forEach(function (t) { typesById[t.id] = t; });
      var over = false;
      Object.keys(overCount).forEach(function (id) {
        if (typesById[id] && overCount[id] > typesById[id].count) over = true;
      });
      expect('没有超过给定数量', !over);

      /* ---- 渲染结果 / 方案文本 ---- */
      App.renderResult(res, App.state.types, App.unlockedList(), 1);
      expect('结果图已渲染', $('resultGrid') !== null);
      expect('结果图格子数正确', $('resultGrid') && $('resultGrid').children.length === s * s,
        $('resultGrid') ? $('resultGrid').children.length : 'null');
      var txt = App.planText(res, App.state.types, App.unlockedList());
      expect('方案文本以标题开头', txt.indexOf('格子摆放方案') === 0);
      expect('方案文本含行数', txt.split('\n').length > s, 'lines=' + txt.split('\n').length);

      /* ---- 错误分支：没有物品时给提示 ---- */
      var saved = App.state.types.slice();
      App.state.types = [];
      var err = App.solveSync();
      expect('没有物品时求解器报错', err.ok === false && !!err.error, err.error || '');
      App.state.types = saved;

      /* ---- 物品超大时给提示 ---- */
      var err2 = SolverApi.solve({
        size: 4, unlocked: [0, 1, 4, 5], mode: 'exact', timeLimit: 500,
        types: [{ name: '大块', cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], count: 1 }]
      });
      expect('物品长边超出棋盘时报错', err2.ok === false && /长边/.test(err2.error || ''), err2.error || '');
    } catch (e) {
      ok = false;
      log.push('FAIL 抛出异常 :: ' + (e && e.stack ? e.stack : e));
    }

    log.unshift(ok ? 'SELFTEST-OK' : 'SELFTEST-FAILED');
    return log.join('\n');
  }

  window.__runSelfTest = run;
})();
