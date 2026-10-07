/*!
 * build-single.mjs —— 把 css/js 内联进 index.html，生成单文件版本
 *
 * 用法：node build-single.mjs
 * 产出：
 *   ../格子摆放辅助器-单文件版.html   （发给别人，双击就能用）
 *   single/index.html                 （同一份内容，便于再打包）
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const read = p => readFileSync(join(root, p), 'utf8');

let html = read('index.html');

// 1) 内联样式
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) => {
  return '<style>\n' + read(href).trim() + '\n</style>';
});

// 2) 内联脚本（保持顺序）
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  const code = read(src);
  // 防止代码里出现 </script> 提前闭合
  return '<script>\n' + code.replace(/<\/script>/gi, '<\\/script>') + '\n</script>';
});

// 3) 打个标记，方便确认是单文件版
html = html.replace('<title>格子摆放辅助器</title>',
  '<title>格子摆放辅助器（单文件版）</title>\n<!-- 单文件版：样式与脚本已全部内联，双击即可运行 -->');

if (/<link rel="stylesheet"|<script src=/.test(html)) {
  console.error('内联失败：还有未处理的外部引用');
  process.exit(1);
}

const out1 = join(root, '..', '格子摆放辅助器-单文件版.html');
const out2 = join(root, 'single', 'index.html');
mkdirSync(dirname(out2), { recursive: true });
writeFileSync(out1, html, 'utf8');
writeFileSync(out2, html, 'utf8');

console.log('已生成单文件版：');
console.log('  ' + resolve(out1) + '  （' + Buffer.byteLength(html, 'utf8') + ' 字节）');
console.log('  ' + resolve(out2));
