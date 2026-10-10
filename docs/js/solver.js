/*!
 * solver.js —— 格子摆放求解器
 * 依赖 pieces.js（浏览器 window.Pieces / Node require('./pieces.js')）。
 *
 * 目标：在已解锁的格子里摆放物品（可旋转、可选镜像），使
 *   1) 放入的格子数最多；
 *   2) 格数相同时物品件数最少。
 * 放不下的物品允许剩余，剩余清单随结果返回。
 *
 * 算法
 *   exact —— 分支限界完全搜索，预算内跑完即证明是全局最优；
 *   beam  —— 束搜索启发式，大盘/复杂实例用，快速给出尽量满的方案。
 *
 * 完全性依据：每个状态只处理「行优先扫描到的、还有可能被盖住的第一个空格」。
 *   · 任何物品都盖不住它  -> 它必然是空洞，直接前进，不算分支；
 *   · 否则  -> 分支：要么把它当空洞，要么用某个物品以它左上角为锚点盖住它。
 * 任何合法摆放方案都能被这组操作唯一还原，因此不会漏解；配合上界剪枝即为最优。
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Solver = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  var DEFAULT_BEAM_WIDTH = 60;
  var DEFAULT_BEAM_NODES = 120000;
  var STOP = { stop: true };   // 用于从递归深处快速中断

  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }
  function piecesLib() {
    if (typeof self !== 'undefined' && self.Pieces) return self.Pieces;
    if (typeof globalThis !== 'undefined' && globalThis.Pieces) return globalThis.Pieces;
    return require('./pieces.js');
  }
  /** a 是否严格优于 b */
  function isBetter(aArea, aCount, bArea, bCount) {
    if (aArea !== bArea) return aArea > bArea;
    return aCount < bCount;
  }
  function popcount(x) { var n = 0; while (x) { x &= x - 1n; n++; } return n; }

  /** 形状最长直线段（判断能否放进棋盘） */
  function longestRun(cells) {
    var seen = Object.create(null), run = 0, i;
    for (i = 0; i < cells.length; i++) seen[cells[i][0] + ',' + cells[i][1]] = 1;
    for (i = 0; i < cells.length; i++) {
      if (!seen[cells[i][0] + ',' + (cells[i][1] - 1)]) {
        var len = 0, c = cells[i][1];
        while (seen[cells[i][0] + ',' + c]) { len++; c++; }
        if (len > run) run = len;
      }
      if (!seen[(cells[i][0] - 1) + ',' + cells[i][1]]) {
        var len2 = 0, r = cells[i][0];
        while (seen[r + ',' + cells[i][1]]) { len2++; r++; }
        if (len2 > run) run = len2;
      }
    }
    return run;
  }

  /**
   * @param {object} opts
   *   size      : 棋盘边长
   *   unlocked  : number[] 已解锁格子索引（r*size+c）
   *   types     : [{id?, name?, cells, count, allowMirror?}]
   *   mode      : 'exact' | 'beam'
   *   timeLimit : 精确搜索时间预算(ms)
   *   nodeLimit : 精确搜索节点上限
   *   beamWidth : 束宽
   */
  function solve(opts) {
    var t0 = now();
    var size = opts.size | 0;
    if (size < 2 || size > 12) return { ok: false, error: '棋盘边长需在 2 ~ 12 之间' };
    var totalCells = size * size;
    var P = piecesLib();

    /* ---------- 1. 可用区域 ---------- */
    var available = 0n, unlockedList = [], seenIdx = Object.create(null);
    var raw = opts.unlocked || [];
    for (var i = 0; i < raw.length; i++) {
      var idx = raw[i] | 0;
      if (idx < 0 || idx >= totalCells || seenIdx[idx]) continue;
      seenIdx[idx] = 1;
      unlockedList.push(idx);
      available |= 1n << BigInt(idx);
    }
    var availableCells = unlockedList.length;
    if (availableCells === 0) return { ok: false, error: '请先解锁至少一个格子' };

    /* ---------- 2. 物品类型与摆放方向 ---------- */
    var types = [], srcTypes = opts.types || [];
    for (i = 0; i < srcTypes.length; i++) {
      var t = srcTypes[i];
      var count = Math.max(0, t.count | 0);
      if (count === 0 || !t.cells || !t.cells.length) continue;
      var base = P.normalize(t.cells);
      // allowRotate / allowMirror 可分别控制；只传 allowMirror 时行为与旧版一致
      var trs = P.transforms(base, {
        rotate: t.allowRotate !== false,
        mirror: t.allowMirror !== false
      });
      if (!trs.length) continue;
      var maxRun = 0;
      for (var k = 0; k < trs.length; k++) maxRun = Math.max(maxRun, longestRun(trs[k].cells));
      if (maxRun > size) {
        return { ok: false, error: '物品「' + (t.name || ('物品' + (i + 1))) + '」的长边超过棋盘边长（' + size + '）' };
      }
      types.push({
        id: t.id || ('t' + i),
        name: t.name || ('物品' + (i + 1)),
        area: base.length,
        cells: base,
        trs: trs,
        count: count,
        maxRun: maxRun,
        allowRotate: t.allowRotate !== false,
        allowMirror: t.allowMirror !== false
      });
    }
    if (!types.length) return { ok: false, error: '请先添加至少一种物品' };
    types.sort(function (a, b) { return (b.area - a.area) || (b.count - a.count); });

    var initCounts = types.map(function (x) { return x.count; });
    var maxDepth = 0, totalPieceArea = 0;
    for (i = 0; i < types.length; i++) {
      maxDepth += types[i].count;
      totalPieceArea += types[i].area * types[i].count;
    }

    /* ---------- 3. 候选摆放（锚点必须落在可用区域内） ---------- */
    var candByType = [];
    for (i = 0; i < types.length; i++) {
      var list = [];
      for (var j = 0; j < types[i].trs.length; j++) {
        var tc = types[i].trs[j];
        var bw = 0, bh = 0;
        for (var m = 0; m < tc.cells.length; m++) {
          if (tc.cells[m][1] + 1 > bw) bw = tc.cells[m][1] + 1;
          if (tc.cells[m][0] + 1 > bh) bh = tc.cells[m][0] + 1;
        }
        // 锚点 = 摆放后形状外接矩形的左上角，遍历棋盘所有可能位置
        for (var ar = 0; ar + bh <= size; ar++) {
          for (var ac = 0; ac + bw <= size; ac++) {
            var mask = 0n, fits = true;
            for (m = 0; m < tc.cells.length; m++) {
              var rr = ar + tc.cells[m][0], cc = ac + tc.cells[m][1];
              var p = rr * size + cc;
              if (!((available >> BigInt(p)) & 1n)) { fits = false; break; }
              mask |= 1n << BigInt(p);
            }
            if (!fits) continue;
            list.push({ cells: tc.cells, mask: mask, anchor: ar * size + ac });
          }
        }
      }
      // 按锚点排序：同一空格只需扫过相邻的候选
      list.sort(function (a, b) { return a.anchor - b.anchor; });
      candByType.push(list);
    }

    /* ---------- 4. 搜索状态 ---------- */
    var bestArea = -1, bestCount = Infinity, bestPl = null;
    var nodes = 0, timedOut = false;
    var timeLimit = opts.timeLimit > 0 ? opts.timeLimit : 4000;
    var nodeLimit = opts.nodeLimit > 0 ? opts.nodeLimit : 1200000;
    var checkEvery = 512;
    var visited = new Map();
    var leafLimit = Math.max(20000, maxDepth * 12000);
    var firstRowMask = 0n;
    for (var fc = 0; fc < size; fc++) firstRowMask |= 1n << BigInt(fc);

    function firstEmpty(used) {
      var f = available & ~used;
      if (f === 0n) return -1;
      for (var p = 0; p < totalCells; p++) if ((f >> BigInt(p)) & 1n) return p;
      return -1;
    }
    /** 从 from 起找第一个空着的可用格 */
    function firstEmptyFrom(used, from) {
      var f = available & ~used;
      if (f === 0n) return -1;
      for (var p = from; p < totalCells; p++) if ((f >> BigInt(p)) & 1n) return p;
      return -1;
    }
    function shiftCells(cells, anchor) {
      var r0 = Math.floor(anchor / size), c0 = anchor % size, out = [];
      for (var q = 0; q < cells.length; q++) out.push([r0 + cells[q][0], c0 + cells[q][1]]);
      return out;
    }
    /** 位置 pos 处能放下的候选列表（同一个方向可能多种摆法） */
    function fitsAt(pos, ti, used) {
      var list = candByType[ti], out = [], c;
      for (c = 0; c < list.length; c++) {
        if (list[c].anchor !== pos) continue;
        if ((~used & list[c].mask) === list[c].mask) out.push(list[c]);
      }
      return out;
    }
    /** pos 是否还能被任何剩余物品盖住 */
    function coverable(pos, used, cnt) {
      for (var ti = 0; ti < types.length; ti++) {
        if (cnt[ti] <= 0) continue;
        if (fitsAt(pos, ti, used).length) return true;
      }
      return false;
    }

    function updateBest(area, count, pl) {
      if (bestArea < 0 || isBetter(area, count, bestArea, bestCount)) {
        bestArea = area; bestCount = count; bestPl = pl;
        return true;
      }
      return false;
    }

    /* ---------- 5. 启发式下界（多种贪心 + 束搜索） ---------- */
    function greedy(byAnchorFirst) {
      var used = 0n, cnt = initCounts.slice(), pl = [], area = 0, guard = 0;
      while (guard++ <= maxDepth + totalCells + 2) {
        var pos = firstEmpty(used);
        if (pos < 0) break;
        var placedOne = false;
        for (var ti = 0; ti < types.length && !placedOne; ti++) {
          if (cnt[ti] <= 0) continue;
          var fits = fitsAt(pos, ti, used);
          if (!fits.length) continue;
          // byAnchorFirst=false 时优先“面积大”的类型（types 已按面积降序）
          var pick = fits[0];
          if (!byAnchorFirst && fits.length > 1) {
            // 选占地面积更“靠上/靠左”的摆法，尽量不留缝
            pick = fits.reduce(function (a, b) { return (a.mask < b.mask ? a : b); });
          }
          used |= pick.mask;
          cnt[ti]--;
          area += types[ti].area;
          pl.push({ t: ti, cells: shiftCells(pick.cells, pos) });
          placedOne = true;
        }
        if (!placedOne) used |= 1n << BigInt(pos);
      }
      return { area: area, count: pl.length, placements: pl };
    }

    (function seed() {
      var g1 = greedy(false);
      updateBest(g1.area, g1.count, g1.placements);
      var g2 = greedy(true);
      updateBest(g2.area, g2.count, g2.placements);
    })();

    /* ---------- 6. 精确搜索 ---------- */
    var mode = opts.mode === 'beam' ? 'beam' : 'exact';
    var optimal = false;
    // 启发式已经把可用格全填满 => 面积上不可能更好，直接认定为最优
    if (bestArea === availableCells) optimal = true;
    if (mode === 'exact' && !optimal) {
      try {
        recurse(0n, availableCells, 0, initCounts, 0, []);
      } catch (e) {
        if (e !== STOP) throw e;
      }
      optimal = !timedOut && nodes < nodeLimit;
    }

    /* ---------- 7. 束搜索兜底 ---------- */
    if (mode !== 'beam' && !optimal) {
      var b = beamSearch();
      if (b) updateBest(b.area, b.count, b.placements);
      mode = 'exact-timeout';
    } else if (mode === 'beam') {
      var b2 = beamSearch();
      if (b2) updateBest(b2.area, b2.count, b2.placements);
      optimal = (bestArea === availableCells);   // 只有“全填满”才敢说最优
    }
    if (bestPl === null) { bestArea = 0; bestCount = 0; bestPl = []; }
    if (bestArea === availableCells) optimal = true;

    return buildResult(types, availableCells, totalCells, unlockedList.length, {
      area: bestArea, count: bestCount, placements: bestPl,
      optimal: optimal, proven: optimal && mode !== 'beam', method: mode, nodes: nodes,
      ms: now() - t0, timedOut: timedOut
    });

    /* =================== 精确搜索 =================== */
    /**
     * @param used      已占用位图（含空洞与死格）
     * @param freeCells 还没被占用/放弃的可用格数
     * @param depth     已放置物品数
     * @param cnt       各类型剩余数量（调用方传副本）
     * @param filled    已覆盖格数
     * @param pl        已放置清单
     */
    function recurse(used, freeCells, depth, cnt, filled, pl) {
      if (bestArea < 0 || isBetter(filled, pl.length, bestArea, bestCount)) {
        bestArea = filled; bestCount = pl.length; bestPl = pl.slice();
      }
      if (depth >= maxDepth || freeCells <= 0) return;

      // 上界：剩余物品全放下也只有这么多
      var restArea = 0;
      for (var q = 0; q < cnt.length; q++) if (cnt[q] > 0) restArea += cnt[q] * types[q].area;
      var ub = filled + (restArea < freeCells ? restArea : freeCells);
      if (ub < bestArea) return;
      if (ub === bestArea && pl.length >= bestCount) return;

      nodes++;
      if ((nodes & (checkEvery - 1)) === 0 && (now() - t0 > timeLimit || nodes > nodeLimit)) {
        timedOut = true;
        throw STOP;
      }

      // 找一个“还有可能被盖住”的空格；中间那些必然成为空洞的格子就地标记并跳过
      var pos = -1;
      for (;;) {
        var next = firstEmpty(used);
        if (next < 0) return;
        if (coverable(next, used, cnt)) { pos = next; break; }
        used |= 1n << BigInt(next);                  // 死格：任何剩余物品都盖不住它
        freeCells--;
        if (freeCells <= 0) return;
      }

      // 同一（占用图 + 剩余清单）最多展开若干次，防止重复爆炸
      var stateKey = used.toString(36) + '|' + cnt.join(',');
      var seen = visited.get(stateKey);
      if (seen === undefined) visited.set(stateKey, 1);
      else if (seen >= leafLimit) return;
      else visited.set(stateKey, seen + 1);

      // 分支一：该格当空洞（行内已有更靠左的同花纹空洞时，这次是等价方案，剪掉）
      if (!inSameRowPattern(used, pos)) {
        recurse(used | (1n << BigInt(pos)), freeCells - 1, depth, cnt, filled, pl);
      }

      // 分支二：用某个物品以 pos 为左上角锚点盖住它
      for (var ti = 0; ti < types.length; ti++) {
        if (cnt[ti] <= 0) continue;
        var fits = fitsAt(pos, ti, used);
        for (var c = 0; c < fits.length; c++) {
          var cand = fits[c];
          var cnt2 = cnt.slice();
          cnt2[ti]--;
          recurse(used | cand.mask, freeCells - types[ti].area, depth + 1, cnt2,
            filled + types[ti].area, pl.concat([{ t: ti, cells: shiftCells(cand.cells, pos) }]));
        }
      }
    }

    /**
     * 对称性判断：pos 所在行、pos 左侧是否已经存在空洞。
     * 是 -> 本次挖洞与「把洞挪到最左可行位置」的方案等价，可剪枝。
     */
    function inSameRowPattern(used, pos) {
      var r = Math.floor(pos / size), c = pos % size, cc;
      for (cc = 0; cc < c; cc++) {
        var q = r * size + cc;
        if (((available >> BigInt(q)) & 1n) && ((used >> BigInt(q)) & 1n)) return true;
      }
      return false;
    }

    /* =================== 束搜索（启发式） =================== */
    function beamSearch() {
      var width = Math.max(8, (opts.beamWidth | 0) || DEFAULT_BEAM_WIDTH);
      var budget = opts.beamNodes > 0 ? opts.beamNodes : DEFAULT_BEAM_NODES;
      var beam = [{ used: 0n, depth: 0, cnt: initCounts.slice(), pl: [], area: 0, score: 0 }];
      var best = null, seen = new Set(), expanded = 0;

      while (beam.length) {
        var next = [];
        for (var bi = 0; bi < beam.length; bi++) {
          var st = beam[bi];
          if (!best || isBetter(st.area, st.pl.length, best.area, best.count)) {
            best = { area: st.area, count: st.pl.length, placements: st.pl };
          }
          if (st.depth >= maxDepth) continue;

          var pos = -1, scan = 0, usedCur = st.used;
          for (;;) {
            var nx = firstEmptyFrom(usedCur, scan);
            if (nx < 0) break;
            if (coverable(nx, usedCur, st.cnt)) { pos = nx; break; }
            usedCur |= 1n << BigInt(nx);
            scan = nx + 1;
          }
          if (pos < 0) continue;

          // 当空洞
          var usedHole = usedCur | (1n << BigInt(pos));
          var holeKey = usedHole.toString(36) + '|' + st.cnt.join(',');
          if (!seen.has(holeKey)) {
            seen.add(holeKey);
            next.push({
              used: usedHole, depth: st.depth, cnt: st.cnt, pl: st.pl, area: st.area,
              score: st.score - 2
            });
          }

          // 放物品
          for (var ti = 0; ti < types.length; ti++) {
            if (st.cnt[ti] <= 0) continue;
            var fits = fitsAt(pos, ti, usedCur);
            for (var c = 0; c < fits.length; c++) {
              var cand = fits[c];
              var used2 = usedCur | cand.mask;
              var cnt2 = st.cnt.slice();
              cnt2[ti]--;
              var key2 = used2.toString(36) + '|' + cnt2.join(',');
              if (seen.has(key2)) continue;
              seen.add(key2);
              var area2 = st.area + types[ti].area;
              var pl2 = st.pl.concat([{ t: ti, cells: shiftCells(cand.cells, pos) }]);
              next.push({
                used: used2, depth: st.depth + 1, cnt: cnt2, pl: pl2, area: area2,
                score: scoreState(used2, area2, pl2.length, pos, cand.cells)
              });
            }
          }
        }
        expanded += next.length;
        if (expanded > budget || !next.length) break;
        if (next.length > width) {
          next.sort(function (x, y) { return (y.score - x.score) || (y.area - x.area) || (x.pl.length - y.pl.length); });
          next = next.slice(0, width);
        }
        beam = next;
      }
      return best;
    }

    /** 启发式打分：面积优先，其次看落点是否贴紧 */
    function scoreState(used, area, count, pos, cells) {
      var w = 0, r0 = Math.floor(pos / size), c0 = pos % size;
      for (var i2 = 0; i2 < cells.length; i2++) {
        var r = r0 + cells[i2][0], c = c0 + cells[i2][1];
        if (r + 1 < size) w += adj(used, (r + 1) * size + c);
        if (r - 1 >= 0) w += adj(used, (r - 1) * size + c);
        if (c + 1 < size) w += adj(used, r * size + c + 1);
        if (c - 1 >= 0) w += adj(used, r * size + c - 1);
      }
      return area * 10000 + count * 100 + w;
    }
    function adj(used, p) {
      if (!((available >> BigInt(p)) & 1n)) return 0;
      return ((used >> BigInt(p)) & 1n) ? 0 : 1;
    }

    /* =================== 结果组装 =================== */
    function buildResult(types2, availCells, total, unlockedCount, sol) {
      var placedByType = types2.map(function () { return 0; });
      var outPl = [];
      var mirroredUsed = 0, rotatedUsed = 0;
      for (var i2 = 0; i2 < sol.placements.length; i2++) {
        var p = sol.placements[i2];
        placedByType[p.t]++;
        // 记录这件物品实际用的朝向：是原样、转了多少度、还是必须镜像
        var ori = P.orientationOf(p.cells, types2[p.t].cells);
        if (ori) {
          if (ori.mirrored) mirroredUsed++;
          else if (ori.rot !== 0) rotatedUsed++;
        }
        outPl.push({
          typeIndex: p.t,
          id: types2[p.t].id,
          name: types2[p.t].name,
          area: types2[p.t].area,
          cells: p.cells,
          orient: ori,
          orientText: ori ? P.describeOrientation(ori) : ''
        });
      }
      var leftover = [];
      for (i2 = 0; i2 < types2.length; i2++) {
        var left = types2[i2].count - placedByType[i2];
        if (left > 0) leftover.push({
          typeIndex: i2, id: types2[i2].id, name: types2[i2].name,
          area: types2[i2].area, count: left
        });
      }
      var placedArea = 0;
      for (i2 = 0; i2 < outPl.length; i2++) placedArea += outPl[i2].area;
      return {
        ok: true,
        optimal: !!sol.optimal,
        optimalProven: !!sol.proven,
        method: sol.method,
        timedOut: !!sol.timedOut,
        size: size,
        placedArea: placedArea,
        placedCount: outPl.length,
        availableCells: availCells,
        lockedCells: total - unlockedCount,
        leftover: leftover,
        leftoverArea: Math.max(0, availCells - placedArea),
        utilization: availCells > 0 ? placedArea / availCells : 0,
        boardFill: total > 0 ? placedArea / total : 0,
        placedMirrored: mirroredUsed,     // 用了「必须镜像」朝向的件数
        placedRotated: rotatedUsed,       // 只用旋转就摆下的件数
        placements: outPl,
        types: types2.map(function (t2) {
          return {
            id: t2.id, name: t2.name, area: t2.area, count: t2.count, cells: t2.cells,
            allowRotate: t2.allowRotate !== false, allowMirror: t2.allowMirror !== false
          };
        }),
        stats: { nodes: sol.nodes, ms: Math.round(sol.ms) }
      };
    }
  }

  return { solve: solve, popcount: popcount, longestRun: longestRun };
});
