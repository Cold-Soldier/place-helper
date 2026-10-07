/*!
 * serve.mjs —— 极简本地静态服务器（可选，不是必需）
 *
 * 直接双击 index.html 就能用；如果你想用 http:// 打开，运行：
 *     node serve.mjs
 * 然后浏览器访问 http://127.0.0.1:8787
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT || 8787);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
    const filePath = join(root, normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
    if (!filePath.startsWith(root)) { res.writeHead(403).end('403'); return; }
    const info = await stat(filePath);
    if (info.isDirectory()) { res.writeHead(302, { Location: urlPath + '/index.html' }).end(); return; }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Length': body.length
    });
    res.end(body);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 找不到：' + req.url);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('格子摆放辅助器已启动：');
  console.log('  http://127.0.0.1:' + port + '/');
  console.log('（按 Ctrl+C 停止）');
});
