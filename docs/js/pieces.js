/*!
 * pieces.js —— 形状（多联骨牌）工具库
 * 负责：形状归一化、旋转/翻转、预设形状（含 L 形）、形状间比较。
 * 同时兼容浏览器（window.Pieces）与 Node（module.exports）。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Pieces = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  /** 归一化：把格子整体平移到左上角贴边，并按「行优先」排序 */
  function normalize(cells) {
    if (!Array.isArray(cells) || cells.length === 0) return [];
    var minR = Infinity, minC = Infinity, i;
    for (i = 0; i < cells.length; i++) {
      if (cells[i][0] < minR) minR = cells[i][0];
      if (cells[i][1] < minC) minC = cells[i][1];
    }
    var out = [];
    for (i = 0; i < cells.length; i++) out.push([cells[i][0] - minR, cells[i][1] - minC]);
    out.sort(cmpCell);
    // 去重
    var uniq = [];
    for (i = 0; i < out.length; i++) {
      if (i === 0 || out[i][0] !== out[i - 1][0] || out[i][1] !== out[i - 1][1]) uniq.push(out[i]);
    }
    return uniq;
  }

  function cmpCell(a, b) { return a[0] - b[0] || a[1] - b[1]; }

  function key(cells) {
    var s = '';
    for (var i = 0; i < cells.length; i++) s += cells[i][0] + ',' + cells[i][1] + ';';
    return s;
  }

  /** 顺时针旋转 90° */
  function rotate(cells) {
    var out = [];
    for (var i = 0; i < cells.length; i++) out.push([cells[i][1], -cells[i][0]]);
    return normalize(out);
  }

  /** 左右镜像 */
  function mirrorH(cells) {
    var out = [];
    for (var i = 0; i < cells.length; i++) out.push([cells[i][0], -cells[i][1]]);
    return normalize(out);
  }

  function bounds(cells) {
    var w = 0, h = 0;
    for (var i = 0; i < cells.length; i++) {
      if (cells[i][1] + 1 > w) w = cells[i][1] + 1;
      if (cells[i][0] + 1 > h) h = cells[i][0] + 1;
    }
    return { w: w, h: h };
  }

  /**
   * 生成一个形状的所有可摆放朝向。
   * @param {number[][]} cells 形状格子
   * @param {boolean|{rotate?:boolean, mirror?:boolean}} opts
   *        传布尔值时表示“是否允许镜像”（兼容旧写法）；
   *        传对象时可分别控制 rotate（是否允许旋转，默认 true）与 mirror（是否允许镜像，默认 true）。
   * @returns {{cells:number[][], key:string, rot:number, mirrored:boolean, allowMirror:boolean}[]}
   */
  function transforms(cells, opts) {
    var base = normalize(cells);
    if (base.length === 0) return [];

    var allowRotate = true, allowMirror = true;
    if (typeof opts === 'boolean') allowMirror = opts;
    else if (opts && typeof opts === 'object') {
      allowMirror = opts.mirror !== false;
      allowRotate = opts.rotate !== false;
    } else if (opts === false) allowMirror = false;

    var seen = Object.create(null), out = [];
    var variants = allowMirror ? [base, mirrorH(base)] : [base];
    for (var v = 0; v < variants.length; v++) {
      var cur = variants[v];
      var rounds = allowRotate ? 4 : 1;
      for (var r = 0; r < rounds; r++) {
        var k = key(cur);
        if (!seen[k]) {
          seen[k] = 1;
          // 标签按「能否只用旋转达到」来判定：非手性形状的镜像会标成旋转（这是准确的）
          var ori = orientationOf(cur, base) || { rot: r, mirrored: v > 0 };
          out.push({
            cells: cur,
            key: k,
            rot: ori.rot,
            mirrored: ori.mirrored,
            allowMirror: !!allowMirror
          });
        }
        cur = rotate(cur);
      }
    }
    return out;
  }

  /**
   * 判断某个朝向相对原始形状是「转了几度」还是「必须镜像」。
   * 优先匹配旋转：只有旋转做不到时才算镜像。
   * @returns {{rot:number, mirrored:boolean}|null} rot = 顺时针 90° 的次数（0~3）
   */
  function orientationOf(cells, baseCells) {
    var target = normalize(cells);
    var base = normalize(baseCells);
    if (!target.length || !base.length) return null;
    var tk = key(target);
    var cur = base;
    for (var r = 0; r < 4; r++) {
      if (key(cur) === tk) return { rot: r, mirrored: false };
      cur = rotate(cur);
    }
    cur = mirrorH(base);
    for (var r2 = 0; r2 < 4; r2++) {
      if (key(cur) === tk) return { rot: r2, mirrored: true };
      cur = rotate(cur);
    }
    return null;
  }

  /** 把朝向变成人能读的文字，例如「原朝向」「顺时针 180°」「镜像」 */
  function describeOrientation(ori) {
    if (!ori) return '未知朝向';
    var turn = ['原朝向', '顺时针 90°', '顺时针 180°', '顺时针 270°'][ori.rot] || ('旋转 ' + ori.rot + '×90°');
    return ori.mirrored ? (ori.rot === 0 ? '镜像' : '镜像 + ' + turn) : turn;
  }

  /** 形状面积（格子数） */
  function area(cells) { return cells.length; }

  /** 形状外接矩形是否为正方形 */
  function isSquare(cells) { var b = bounds(cells); return b.w === b.h; }

  /* ------------------------------ 预设形状 ------------------------------ */

  function rect(w, h) {
    var cells = [];
    for (var r = 0; r < h; r++) for (var c = 0; c < w; c++) cells.push([r, c]);
    return cells;
  }

  /**
   * L 形：竖臂长 a、横臂长 b（拐角格共用），a、b 均 ≥ 2。
   * 例：L(3,2) = 竖着 3 格 + 底边向右多 1 格（经典 3 格 L）。
   */
  function lShape(a, b) {
    a = Math.max(2, a | 0); b = Math.max(2, b | 0);
    var cells = [];
    for (var r = 0; r < a; r++) cells.push([r, 0]);
    for (var c = 1; c < b; c++) cells.push([a - 1, c]);
    return normalize(cells);
  }

  /** T 形：顶部横梁宽 w，中间竖臂长 h */
  function tShape(w, h) {
    w = Math.max(2, w | 0); h = Math.max(2, h | 0);
    var cells = [], mid = Math.floor((w - 1) / 2);
    for (var c = 0; c < w; c++) cells.push([0, c]);
    for (var r = 1; r < h; r++) cells.push([r, mid]);
    return normalize(cells);
  }

  /** S/Z 形（默认 2×3 的经典 4 格形状，flip=true 时取镜像） */
  function sShape(w, h, flip) {
    w = Math.max(2, w | 0); h = Math.max(2, h | 0);
    var cells;
    if (w === 3 && h === 2) {
      cells = flip ? [[0, 1], [0, 2], [1, 0], [1, 1]] : [[0, 0], [0, 1], [1, 1], [1, 2]];
    } else {
      // 通用：上行取左半，之后每行错开
      cells = [];
      for (var c = 0; c <= Math.floor((w - 1) / 2); c++) cells.push([0, c]);
      for (var r = 1; r < h; r++) {
        for (var d = 0; d < Math.ceil(w / 2); d++) cells.push([r, d + (flip ? 0 : Math.floor((w - 1) / 2))]);
      }
    }
    return normalize(cells);
  }

  /** 直角三角（阶梯）形 */
  function stair(n) {
    n = Math.max(1, n | 0);
    var cells = [];
    for (var r = 0; r < n; r++) for (var c = 0; c <= r; c++) cells.push([r, c]);
    return normalize(cells);
  }

  /** 预设调色板：供界面「快捷添加」使用 */
  function presets() {
    return [
      { id: 'r1x1', name: '1×1', cells: rect(1, 1) },
      { id: 'r2x1', name: '1×2', cells: rect(2, 1) },
      { id: 'r2x2', name: '2×2', cells: rect(2, 2) },
      { id: 'r3x1', name: '1×3', cells: rect(3, 1) },
      { id: 'r3x2', name: '2×3', cells: rect(3, 2) },
      { id: 'r3x3', name: '3×3', cells: rect(3, 3) },
      { id: 'l3', name: 'L 形(3格)', cells: lShape(2, 2) },
      { id: 'l4', name: 'L 形(4格)', cells: lShape(3, 2) },
      { id: 'l5', name: 'L 形(5格)', cells: lShape(4, 2) },
      { id: 't4', name: 'T 形(4格)', cells: tShape(3, 2) },
      { id: 's4', name: 'S 形(4格)', cells: sShape(3, 2, false) },
      { id: 'st6', name: '阶梯(6格)', cells: stair(3) }
    ];
  }

  /** 描述形状：如 “5 格 · 4×2” */
  function describe(cells) {
    var b = bounds(cells);
    return cells.length + ' 格 · ' + b.w + '×' + b.h;
  }

  return {
    normalize: normalize,
    rotate: rotate,
    mirrorH: mirrorH,
    transforms: transforms,
    orientationOf: orientationOf,
    describeOrientation: describeOrientation,
    bounds: bounds,
    area: area,
    isSquare: isSquare,
    key: key,
    rect: rect,
    lShape: lShape,
    tShape: tShape,
    sShape: sShape,
    stair: stair,
    presets: presets,
    describe: describe
  };
});
