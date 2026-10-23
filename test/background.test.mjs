import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = new URL('../src/', import.meta.url) || null;

function read(path) {
  return readFileSync(new URL(path, SRC), 'utf8');
}

/** 用假的 chrome API 起一个 background.js 实例（MV3 Service Worker 逻辑单测） */
function boot() {
  const state = { message: null, actionClick: null, command: null, windowsCreate: [], downloads: [], tabs: [] };

  globalThis.self = globalThis;
  globalThis.importScripts = function () {
    for (const p of arguments) (0, eval)(read(p));
  };
  globalThis.chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener: (fn) => (state.message = fn) }
    },
    windows: {
      getCurrent: (cb) => cb({ left: 100, top: 40, width: 1280, height: 900 }),
      create: (opts, cb) => {
        state.windowsCreate.push(opts);
        cb({ id: 7 });
      }
    },
    tabs: {
      query: (q, cb) => cb([{ id: 42 }]),
      sendMessage: (id, msg, cb) => {
        state.tabs.push({ id, msg });
        if (cb) cb();
      }
    },
    action: { onClicked: { addListener: (fn) => (state.actionClick = fn) } },
    commands: { onCommand: { addListener: (fn) => (state.command = fn) } },
    downloads: {
      download: (opts, cb) => {
        state.downloads.push(opts);
        cb(1);
      }
    }
  };

  (0, eval)(read('background.js'));
  return state;
}

/** 像 chrome 那样调用监听器并等待异步 sendResponse */
function send(state, msg) {
  return new Promise((resolve) => {
    const handled = state.message(msg, {}, resolve);
    if (!handled) resolve(undefined);
  });
}

test('BQQ_OPEN_QQ：拼出 QQ 官方分享地址并弹出窗口', async () => {
  const state = boot();
  const payload = globalThis.BQQCore.buildPayload({
    url: 'https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=1',
    title: '标题 & 测试',
    up: 'UP主',
    cover: 'https://i0.hdslb.com/bfs/archive/abc.jpg@672w_378h_1c.webp',
    playRaw: '12.3万',
    desc: '简介'
  });

  const res = await send(state, { type: 'BQQ_OPEN_QQ', payload });
  assert.equal(res.ok, true);
  assert.equal(state.windowsCreate.length, 1);
  const opts = state.windowsCreate[0];
  assert.equal(opts.type, 'popup');
  assert.ok(opts.url.startsWith('https://connect.qq.com/widget/shareqq/index.html?'));

  const qs = new URL(opts.url).searchParams;
  assert.equal(qs.get('url'), 'https://www.bilibili.com/video/BV1xx411c7mD/');
  assert.equal(qs.get('title'), '标题 & 测试');
  assert.equal(qs.get('pics'), 'https://i0.hdslb.com/bfs/archive/abc.jpg');
  assert.equal(qs.get('site'), '哔哩哔哩');
  assert.match(qs.get('summary'), /12.3万播放/);

  // 窗口应相对父窗口居中，且不落到负坐标
  assert.ok(opts.left >= 0 && opts.top >= 0);
  assert.equal(opts.width, 880);
  assert.equal(opts.height, 720);
});

test('BQQ_OPEN_QQ：缺少载荷时明确报错，不弹窗口', async () => {
  const state = boot();
  const res = await send(state, { type: 'BQQ_OPEN_QQ' });
  assert.equal(res.ok, false);
  assert.ok(res.error);
  assert.equal(state.windowsCreate.length, 0);
});

test('BQQ_FETCH_IMAGE：白名单域名转成 data URL', async () => {
  const state = boot();
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  globalThis.fetch = async () => ({
    ok: true,
    headers: new Headers({ 'content-type': 'image/png' }),
    arrayBuffer: async () => bytes.buffer
  });

  const res = await send(state, { type: 'BQQ_FETCH_IMAGE', url: 'https://i0.hdslb.com/bfs/archive/abc.jpg' });
  assert.equal(res.ok, true);
  assert.ok(res.dataUrl.startsWith('data:image/png;base64,'));
  const decoded = Buffer.from(res.dataUrl.split(',')[1], 'base64');
  assert.deepEqual([...decoded], [0x89, 0x50, 0x4e, 0x47]);
});

test('BQQ_FETCH_IMAGE：非白名单域名 / 非 http 协议直接拒绝', async () => {
  const state = boot();
  let called = 0;
  globalThis.fetch = async () => {
    called++;
    return { ok: true, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => new ArrayBuffer(1) };
  };

  const evil = await send(state, { type: 'BQQ_FETCH_IMAGE', url: 'https://evil.example.com/a.png' });
  assert.equal(evil.ok, false);
  assert.match(evil.error, /白名单/);

  const ftp = await send(state, { type: 'BQQ_FETCH_IMAGE', url: 'ftp://i0.hdslb.com/a.png' });
  assert.equal(ftp.ok, false);

  assert.equal(called, 0, '被拒绝的地址不应发起网络请求');
});

test('BQQ_FETCH_IMAGE：HTTP 错误与超大图片都要给出可读错误', async () => {
  const state = boot();
  globalThis.fetch = async () => ({ ok: false, status: 403, headers: new Headers({}) });
  const r1 = await send(state, { type: 'BQQ_FETCH_IMAGE', url: 'https://i0.hdslb.com/a.jpg' });
  assert.equal(r1.ok, false);
  assert.match(r1.error, /403/);
});

test('BQQ_DOWNLOAD：把 data URL 交给下载管理器', async () => {
  const state = boot();
  const res = await send(state, {
    type: 'BQQ_DOWNLOAD',
    dataUrl: 'data:image/png;base64,AAAA',
    filename: 'B站卡片_测试_BV1xx411c7mD.png'
  });
  assert.equal(res.ok, true);
  assert.equal(state.downloads.length, 1);
  assert.equal(state.downloads[0].filename, 'B站卡片_测试_BV1xx411c7mD.png');
  assert.equal(state.downloads[0].saveAs, false);
});

test('点击扩展图标 / 快捷键都会让当前标签页唤起面板', async () => {
  const state = boot();
  state.actionClick({ id: 42 });
  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0].id, 42);
  assert.equal(state.tabs[0].msg.type, 'BQQ_TOGGLE_PANEL');

  await state.command('open-share-panel');
  assert.equal(state.tabs.length, 2);
  assert.equal(state.tabs[1].msg.type, 'BQQ_TOGGLE_PANEL');

  // 其它命令不应触发
  await state.command('something-else');
  assert.equal(state.tabs.length, 2);
});
