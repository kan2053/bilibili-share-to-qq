import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../src/core.js');

test('parseVideoId：识别 BV / av / 番剧 ep / ss', () => {
  assert.deepEqual(C.parseVideoId('https://www.bilibili.com/video/BV1xx411c7mD'), {
    kind: 'video',
    vid: 'BV1xx411c7mD',
    bvid: 'BV1xx411c7mD'
  });
  assert.equal(C.parseVideoId('https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333.999').vid, 'BV1xx411c7mD');
  assert.equal(C.parseVideoId('https://www.bilibili.com/video/av170001').vid, 'av170001');
  assert.equal(C.parseVideoId('https://www.bilibili.com/bangumi/play/ep123456').vid, 'ep123456');
  assert.equal(C.parseVideoId('https://www.bilibili.com/bangumi/play/ss28747').vid, 'ss28747');
  assert.equal(C.parseVideoId('https://www.bilibili.com/'), null);
  assert.equal(C.parseVideoId(''), null);
});

test('canonicalVideoUrl：去掉 query 和 hash，保留路径', () => {
  assert.equal(
    C.canonicalVideoUrl('https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333.999&vd_source=abc#reply'),
    'https://www.bilibili.com/video/BV1xx411c7mD/'
  );
  assert.equal(C.canonicalVideoUrl('not a url'), 'not a url');
});

test('normalizeUrl / stripImageSuffix：协议补全与 CDN 尺寸后缀剥离', () => {
  assert.equal(C.normalizeUrl('//i0.hdslb.com/bfs/archive/a.jpg'), 'https://i0.hdslb.com/bfs/archive/a.jpg');
  assert.equal(C.normalizeUrl('http://i0.hdslb.com/a.jpg'), 'https://i0.hdslb.com/a.jpg');
  assert.equal(
    C.stripImageSuffix('https://i0.hdslb.com/bfs/archive/abc.jpg@672w_378h_1c.webp'),
    'https://i0.hdslb.com/bfs/archive/abc.jpg'
  );
  assert.equal(C.stripImageSuffix('https://i0.hdslb.com/bfs/archive/abc.png'), 'https://i0.hdslb.com/bfs/archive/abc.png');
});

test('cleanTitle：只去掉末尾站点后缀，不动标题本体', () => {
  assert.equal(C.cleanTitle('【4K】测试视频_哔哩哔哩_bilibili'), '【4K】测试视频');
  assert.equal(C.cleanTitle('某个番剧 - 哔哩哔哩'), '某个番剧');
  assert.equal(C.cleanTitle('  B站  标题\n换行  '), 'B站 标题 换行');
  assert.equal(C.cleanTitle('标题里有_哔哩哔哩_但不是结尾'), '标题里有_哔哩哔哩_但不是结尾');
  assert.equal(C.cleanTitle(''), '');
});

test('parseCount / formatCount：万、亿、千分位', () => {
  assert.equal(C.parseCount('12.3万'), 123000);
  assert.equal(C.parseCount('1.2亿'), 120000000);
  assert.equal(C.parseCount('12,345'), 12345);
  assert.equal(C.parseCount('56.7万播放'), 567000);
  assert.equal(C.parseCount('1.5k'), 1500);
  assert.equal(C.parseCount(''), null);
  assert.equal(C.formatCount(12345), '1.2万');
  assert.equal(C.formatCount(123000000), '1.2亿');
  assert.equal(C.formatCount(999), '999');
  assert.equal(C.formatCount(null), '');
});

test('formatDuration：mm:ss 与 h:mm:ss', () => {
  assert.equal(C.formatDuration(201), '3:21');
  assert.equal(C.formatDuration(3723), '1:02:03');
  assert.equal(C.formatDuration(0), '');
  assert.equal(C.formatDuration(NaN), '');
});

test('buildPayload：把抓到的字段整理成分享载荷', () => {
  const p = C.buildPayload({
    url: 'https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333.1',
    title: '测试标题_哔哩哔哩_bilibili',
    up: '某UP主',
    cover: '//i0.hdslb.com/bfs/archive/abc.jpg@672w_378h_1c.webp',
    playRaw: '12.3万',
    duration: 201,
    desc: '  这是   简介  '
  });
  assert.equal(p.vid, 'BV1xx411c7mD');
  assert.equal(p.title, '测试标题');
  assert.equal(p.cover, 'https://i0.hdslb.com/bfs/archive/abc.jpg@672w_378h_1c.webp');
  assert.equal(p.coverShare, 'https://i0.hdslb.com/bfs/archive/abc.jpg');
  assert.equal(p.play, '12.3万');
  assert.equal(p.duration, '3:21');
  assert.equal(p.desc, '这是 简介');
});

test('buildQqShareUrl：参数齐全且被正确编码', () => {
  const p = C.buildPayload({
    url: 'https://www.bilibili.com/video/BV1xx411c7mD/',
    title: '标题 & 测试',
    up: 'UP主',
    cover: 'https://i0.hdslb.com/bfs/archive/abc.jpg',
    playRaw: '1万',
    desc: '简介'
  });
  const url = C.buildQqShareUrl(p);
  assert.ok(url.startsWith(C.QQ_WIDGET + '?'));
  const qs = new URL(url).searchParams;
  assert.equal(qs.get('title'), '标题 & 测试');
  assert.equal(qs.get('url'), 'https://www.bilibili.com/video/BV1xx411c7mD/');
  assert.equal(qs.get('pics'), 'https://i0.hdslb.com/bfs/archive/abc.jpg');
  assert.equal(qs.get('site'), '哔哩哔哩');
  assert.match(qs.get('summary'), /简介 · UP主：UP主 · 1万播放/);
});

test('buildShareText / buildShareHtml：纯文本与富文本卡片', () => {
  const p = C.buildPayload({
    url: 'https://www.bilibili.com/video/BV1xx411c7mD/',
    title: '标题',
    up: 'UP主',
    cover: 'https://i0.hdslb.com/bfs/archive/abc.jpg@672w_378h_1c.webp'
  });
  assert.equal(C.buildShareText(p), '标题 - UP主\nhttps://www.bilibili.com/video/BV1xx411c7mD/');
  const html = C.buildShareHtml(p);
  assert.match(html, /<img src="https:\/\/i0\.hdslb\.com/);
  assert.match(html, /标题/);
  // 不允许把 data URL 塞进剪贴板 HTML（体积爆炸）
  assert.doesNotMatch(html, /data:image/);
});

test('wrapText：中文按字断行、英文按词断行、超行省略', () => {
  const measure = (s) => C.fallbackMeasure(s, '600 22px sans-serif');
  const maxWidth = 280;
  const zh = '这是一个很长很长的中文标题用来测试换行是否正常工作并且不会溢出卡片边界同时还能验证省略号是否出现在最后一行';
  const r1 = C.wrapText(zh, maxWidth, measure, 3);
  assert.equal(r1.lines.length, 3);
  assert.equal(r1.truncated, true);
  assert.ok(r1.lines[2].endsWith('…'));
  for (const line of r1.lines) assert.ok(measure(line) <= maxWidth + 0.5, `行宽超限: ${line}`);
  // 三行都用满了宽度，说明换行是"填满再断"，没有浪费
  assert.ok(measure(r1.lines[0]) > maxWidth - 22.5);

  const en = C.wrapText('Bilibili video sharing to QQ as a rich card', maxWidth, measure, 3);
  assert.ok(en.lines.length >= 1);
  for (const line of en.lines) assert.ok(measure(line) <= maxWidth + 0.5);
  // 不应把单词从中间劈开
  assert.equal(en.lines.join(' ').replace(/…$/, '').replace(/\s+/g, ' ').trim().split(' ')[0], 'Bilibili');
});

test('layoutCard：所有元素都在画布内，且关键区块齐全', () => {
  const p = C.buildPayload({
    url: 'https://www.bilibili.com/video/BV1xx411c7mD/',
    title: '一个足够长的视频标题，用来验证三行标题的排版不会溢出右侧栏',
    up: '某UP主',
    cover: 'https://i0.hdslb.com/bfs/archive/abc.jpg',
    playRaw: '123.4万',
    duration: 3723,
    desc: '视频简介：这是一段比较长的简介，用于验证简介区域的换行与截断，确保展示效果稳定，不会压到页脚。'
  });
  const layout = C.layoutCard(p, { measure: (t, f) => C.fallbackMeasure(t, f), hasCover: true });
  assert.equal(layout.width, C.CARD.width);
  assert.equal(layout.height, C.CARD.height);

  const types = new Set(layout.ops.map((o) => o.type));
  for (const t of ['roundRect', 'image', 'text', 'badge', 'line']) assert.ok(types.has(t), `缺少 ${t}`);

  const image = layout.ops.find((o) => o.type === 'image');
  assert.equal(image.w, 288);
  assert.equal(image.h, 162);

  const badge = layout.ops.find((o) => o.type === 'badge');
  assert.equal(badge.text, '1:02:03');

  for (const op of layout.ops) {
    if (op.type === 'text' || op.type === 'badge') {
      assert.ok(op.x >= 0 && op.x <= layout.width, `x 越界: ${op.text}`);
      assert.ok(op.y >= 0 && op.y <= layout.height, `y 越界: ${op.text}`);
    }
    if (op.type === 'image' || op.type === 'roundRect') {
      assert.ok(op.x >= 0 && op.x + op.w <= layout.width + 0.5, '元素横向越界');
      assert.ok(op.y >= 0 && op.y + op.h <= layout.height + 0.5, '元素纵向越界');
    }
  }
});

test('layoutCard：没有封面时用品牌色占位，而不是空白', () => {
  const p = C.buildPayload({ url: 'https://www.bilibili.com/video/BV1xx411c7mD/', title: '无封面' });
  const layout = C.layoutCard(p, { measure: (t, f) => C.fallbackMeasure(t, f), hasCover: false });
  assert.equal(layout.ops.filter((o) => o.type === 'image').length, 0);
  const ph = layout.ops.find((o) => o.type === 'roundRect' && Array.isArray(o.gradient));
  assert.ok(ph, '缺少占位渐变');
});
