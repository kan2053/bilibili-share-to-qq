/**
 * 本地静态服务器，仅供 test/harness.html 自测使用。
 * 用法：node test/serve.mjs [port]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] || 8787);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // 任何 /video/xxx 之类的伪路由都回落到 harness，模拟 B 站视频页
    let path = decodeURIComponent(url.pathname);
    if (path.startsWith('/video/') || path.startsWith('/bangumi/play/')) path = '/test/harness.html';
    if (path === '/') path = '/test/harness.html';
    const file = join(ROOT, normalize(path).replace(/^([/\\])+/, ''));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found: ' + req.url);
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log('serving http://127.0.0.1:' + PORT + ' (root ' + ROOT + ')');
});
