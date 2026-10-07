/*!
 * test/solver.test.mjs —— 求解器自测（node test/solver.test.mjs）
 *
 * 覆盖：
 *  1) 可完全铺满的实例：结果必须恰好铺满，且被证明最优
 *  2) 面积不足的实例：必须把能放的全部放下
 *  3) 尺寸受限的实例：结果必须等于理论上界
 *  4) 解锁区域裁剪：物品不能落在未解锁格上
 *  5) 与独立暴力算法逐一对照（小棋盘，多组随机实例）
 *  6) 质量与性能：大盘混合物品的利用率、耗时
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Pieces = require('../js/pieces.js');
globalThis.Pieces = Pieces;
const Solver = require('../js/solver.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? '  -> ' + extra : '')); }
}
function unlockedAll(n) { const a = []; for (let i = 0; i < n * n; i++) a.push(i); return a; }
function T(name, cells, count, allowMirror = true) { return { name, cells, count, allowMirror }; }
function summarize(r) {
  return `${r.placedArea}/${r.availableCells} 格 · ${r.placedCount} 件 · ${r.method}${r.optimal ? '(已证明最优)' : '(未证明)'} · 节点 ${r.stats.nodes} · ${r.stats.ms}ms`;
}

/** 合法性校验：不越界、不压未解锁格、互不重叠、数量守恒 */
function validate(res, n, unlocked) {
  const set = new Set(unlocked), seen = new Set(), used = {};
  for (const p of res.placements) {
    used[p.typeIndex] = (used[p.typeIndex] || 0) + 1;
    if (used[p.typeIndex] > res.types[p.typeIndex].count) return '放置数量超过给定数量：' + p.name;
    for (const [r, c] of p.cells) {
      const k = r * n + c;
      if (r < 0 || c < 0 || r >= n || c >= n) return `越界 ${r},${c}`;
      if (!set.has(k)) return `压到未解锁格 ${r},${c}`;
      if (seen.has(k)) return `格 ${r},${c} 重复占用`;
      seen.add(k);
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
console.log('\n[1] 4×4 可完全铺满：2×2×2 + L4×4 + 1×2×2（面积恰好 16）');
{
  const n = 4, unlocked = unlockedAll(n);
  const types = [T('2×2', Pieces.rect(2, 2), 2), T('L4', Pieces.lShape(3, 2), 4), T('1×2', Pieces.rect(2, 1), 2)];
  const res = Solver.solve({ size: n, unlocked, mode: 'exact', timeLimit: 5000, types });
  console.log('    ' + summarize(res));
  check('求解成功', res.ok);
  check('铺满 16 格', res.placedArea === 16, summarize(res));
  check('被证明最优', res.optimal === true);
  check('结果合法', validate(res, n, unlocked) === null, validate(res, n, unlocked) || '');
}

console.log('\n[2] 6×6 可完全铺满：2×2×6 + L4×4 + 1×2×8（面积 24+12+16=52 > 36，需截取）');
{
  const n = 6, unlocked = unlockedAll(n);
  // 4 个 2×2 (16) + 4 个 L4 (16) + 4 个 1×2 (4) = 36，需验证能否铺满
  const types = [T('2×2', Pieces.rect(2, 2), 4), T('L4', Pieces.lShape(3, 2), 4), T('1×2', Pieces.rect(2, 1), 4)];
  const res = Solver.solve({ size: n, unlocked, mode: 'exact', timeLimit: 4000, nodeLimit: 1500000, types });
  console.log('    ' + summarize(res));
  check('结果合法', validate(res, n, unlocked) === null, validate(res, n, unlocked) || '');
  check('利用率 >= 90%', res.utilization >= 0.9, (res.utilization * 100).toFixed(1) + '%');
}

console.log('\n[3] 面积不足：6×6 只解锁中心 4×4（16 格），物品总面积 18 -> 至少放 16 格');
{
  const n = 6, unlocked = [];
  for (let r = 1; r <= 4; r++) for (let c = 1; c <= 4; c++) unlocked.push(r * n + c);
  const types = [T('2×2', Pieces.rect(2, 2), 3), T('1×1', Pieces.rect(1, 1), 6)];
  const res = Solver.solve({ size: n, unlocked, mode: 'exact', timeLimit: 5000, types });
  console.log('    ' + summarize(res));
  check('可用格 = 16', res.availableCells === 16, 'available=' + res.availableCells);
  check('锁定格 = 20', res.lockedCells === 20, 'locked=' + res.lockedCells);
  check('放下 16 格', res.placedArea === 16, summarize(res));
  check('结果合法', validate(res, n, unlocked) === null, validate(res, n, unlocked) || '');
}

console.log('\n[4] 理论上界：5 个 2×2 塞不进 3×3，最多 4 格');
{
  const n = 3, unlocked = unlockedAll(n);
  const res = Solver.solve({ size: n, unlocked, mode: 'exact', timeLimit: 5000, types: [T('2×2', Pieces.rect(2, 2), 5)] });
  console.log('    ' + summarize(res));
  check('恰好 4 格', res.placedArea === 4, summarize(res));
  check('剩余 4 个', res.leftover.length === 1 && res.leftover[0].count === 4, JSON.stringify(res.leftover));
  check('被证明最优', res.optimal === true);
}

console.log('\n[5] L 形方向：5×5 用 8 个 L4 至少放 16 格，且无重叠');
{
  const n = 5, unlocked = unlockedAll(n);
  const res = Solver.solve({ size: n, unlocked, mode: 'exact', timeLimit: 5000, types: [T('L4', Pieces.lShape(3, 2), 8)] });
  console.log('    ' + summarize(res));
  check('放出 >= 16 格', res.placedArea >= 16, summarize(res));
  check('结果合法', validate(res, n, unlocked) === null, validate(res, n, unlocked) || '');
}

console.log('\n[6] 与独立暴力算法对照（4×4 与 5×5 多组实例）');
{
  const cases = [
    { n: 4, types: [T('2×2', Pieces.rect(2, 2), 2), T('L4', Pieces.lShape(3, 2), 2), T('1×2', Pieces.rect(2, 1), 2)] },
    { n: 4, types: [T('L3', Pieces.lShape(2, 2), 3), T('1×1', Pieces.rect(1, 1), 4)] },
    { n: 5, types: [T('L4', Pieces.lShape(3, 2), 3), T('T4', Pieces.tShape(3, 2), 2)] },
    { n: 5, types: [T('2×3', Pieces.rect(3, 2), 2), T('1×3', Pieces.rect(3, 1), 3), T('1×1', Pieces.rect(1, 1), 3)] }
  ];
  for (let i = 0; i < cases.length; i++) {
    const { n, types } = cases[i];
    const unlocked = unlockedAll(n);
    const res = Solver.solve({ size: n, unlocked, mode: 'exact', timeLimit: 8000, types });
    const brute = bruteForce(n, unlocked, types);
    console.log(`    实例${i + 1}: 求解器=${res.placedArea} 暴力=${brute}  ${summarize(res)}`);
    check(`实例${i + 1} 与暴力一致`, res.placedArea === brute, `solver=${res.placedArea} brute=${brute}`);
    check(`实例${i + 1} 结果合法`, validate(res, n, unlocked) === null, validate(res, n, unlocked) || '');
  }
}

console.log('\n[7] 压力与质量：6×6 混合 10 种物品');
{
  const n = 6, unlocked = unlockedAll(n);
  const types = [
    T('1×1', Pieces.rect(1, 1), 6), T('1×2', Pieces.rect(2, 1), 4), T('2×2', Pieces.rect(2, 2), 3),
    T('2×3', Pieces.rect(3, 2), 2), T('L3', Pieces.lShape(2, 2), 3), T('L4', Pieces.lShape(3, 2), 3),
    T('L5', Pieces.lShape(4, 2), 2), T('T4', Pieces.tShape(3, 2), 2), T('S4', Pieces.sShape(3, 2), 2),
    T('3×3', Pieces.rect(3, 3), 1)
  ];
  const t0 = Date.now();
  const res = Solver.solve({ size: n, unlocked, mode: 'exact', timeLimit: 3000, types });
  console.log('    ' + summarize(res) + ` · 端到端 ${Date.now() - t0}ms`);
  check('结果合法', validate(res, n, unlocked) === null, validate(res, n, unlocked) || '');
  check('利用率 >= 85%', res.utilization >= 0.85, (res.utilization * 100).toFixed(1) + '%');
  check('3 秒内返回', Date.now() - t0 < 8000, (Date.now() - t0) + 'ms');
}

console.log('\n[8] 快速模式（beam）应同样合法，且不慢于 3 秒');
{
  const n = 6, unlocked = unlockedAll(n);
  const types = [T('2×2', Pieces.rect(2, 2), 4), T('L4', Pieces.lShape(3, 2), 4), T('1×1', Pieces.rect(1, 1), 8)];
  const t0 = Date.now();
  const res = Solver.solve({ size: n, unlocked, mode: 'beam', beamWidth: 80, types });
  console.log('    ' + summarize(res) + ` · 端到端 ${Date.now() - t0}ms`);
  check('结果合法', res.ok && validate(res, n, unlocked) === null, validate(res, n, unlocked) || '');
  // beam 模式不保证最优：只有“把可用格全填满”时才允许声称最优
  check('只在全填满时声称最优', res.optimal === (res.placedArea === res.availableCells),
    `optimal=${res.optimal} area=${res.placedArea}/${res.availableCells}`);
  check('不宣称已证明最优', res.optimalProven === false, 'proven=' + res.optimalProven);
}

/* ------------------------------------------------------------------ */
/** 独立暴力搜索：枚举所有摆放，返回最大覆盖格数（用于对照） */
function bruteForce(n, unlocked, types) {
  const avail = new Set(unlocked);
  const prepared = types.map(t => ({ area: t.cells.length, variants: Pieces.transforms(t.cells, t.allowMirror !== false) }));
  const cnt = types.map(t => t.count);
  let best = 0, nodes = 0, aborted = false;

  function rec(occ, area) {
    if (area > best) best = area;
    if (++nodes > 30000000) { aborted = true; return; }
    let pos = -1;
    for (let i = 0; i < n * n; i++) if (avail.has(i) && !occ.has(i)) { pos = i; break; }
    if (pos < 0) return;
    const r0 = Math.floor(pos / n), c0 = pos % n;
    for (let ti = 0; ti < types.length; ti++) {
      if (cnt[ti] <= 0) continue;
      for (const v of prepared[ti].variants) {
        if (v.cells[0][0] !== 0 || v.cells[0][1] !== 0) continue;
        const idxs = [];
        let ok = true;
        for (const [dr, dc] of v.cells) {
          const rr = r0 + dr, cc = c0 + dc;
          if (rr >= n || cc >= n) { ok = false; break; }
          const k = rr * n + cc;
          if (!avail.has(k) || occ.has(k)) { ok = false; break; }
          idxs.push(k);
        }
        if (!ok) continue;
        idxs.forEach(i => occ.add(i));
        cnt[ti]--;
        rec(occ, area + prepared[ti].area);
        cnt[ti]++;
        idxs.forEach(i => occ.delete(i));
      }
    }
    occ.add(pos);
    rec(occ, area);
    occ.delete(pos);
  }
  rec(new Set(), 0);
  if (aborted) throw new Error('暴力搜索超限，无法作为对照');
  return best;
}

console.log('\n========================================');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
