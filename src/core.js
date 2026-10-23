/*!
 * B站分享到QQ卡片 — core.js
 *
 * 纯逻辑层：不依赖 DOM / chrome API，可被浏览器内容脚本、Service Worker
 * 以及 Node 单元测试共同使用。
 *
 * 负责：视频地址解析、标题清洗、播放量/时长格式化、分享文案与
 * QQ 官方分享地址拼装、文本换行、分享卡片排版（输出为可绘制的 draw ops）。
 */
(function (root) {
  'use strict';

  /** 中英文混排时统一使用的字体栈（Windows / macOS / Linux 都有回退） */
  var FONT_STACK =
    '"PingFang SC","Microsoft YaHei","Hiragino Sans GB",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';

  /** 分享卡片画布尺寸（逻辑像素，渲染时按 scale 放大） */
  var CARD = { width: 640, height: 380, pad: 24, radius: 20 };

  var SITE_NAME = '哔哩哔哩';
  var QQ_WIDGET = 'https://connect.qq.com/widget/shareqq/index.html';

  /* ------------------------------------------------------------------ *
   * 一、URL
   * ------------------------------------------------------------------ */

  var RULES = {
    bv: /\/video\/(BV[0-9A-Za-z]{10})/,
    av: /\/video\/av(\d+)/i,
    ep: /\/bangumi\/play\/ep(\d+)/i,
    ss: /\/bangumi\/play\/ss(\d+)/i
  };

  /**
   * 从 B 站链接里解析出视频标识。
   * 支持：/video/BVxxxx、/video/av123、/bangumi/play/ep123、/bangumi/play/ss123
   * @returns {{kind:'video'|'bangumi', vid:string, bvid?:string, avid?:number, epid?:number, ssid?:number}|null}
   */
  function parseVideoId(url) {
    var u = String(url == null ? '' : url);
    // 新版 /video/BVxxx/?spm_id_from=... 以及已经带 query 的地址都能命中
    var m = u.match(RULES.bv);
    if (m) return { kind: 'video', vid: m[1], bvid: m[1] };
    m = u.match(RULES.av);
    if (m) return { kind: 'video', vid: 'av' + m[1], avid: Number(m[1]) };
    m = u.match(RULES.ep);
    if (m) return { kind: 'bangumi', vid: 'ep' + m[1], epid: Number(m[1]) };
    m = u.match(RULES.ss);
    if (m) return { kind: 'bangumi', vid: 'ss' + m[1], ssid: Number(m[1]) };
    return null;
  }

  /** 去掉 query / hash，只保留 origin + pathname，得到可分享的干净地址 */
  function canonicalVideoUrl(url) {
    try {
      var u = new URL(String(url || ''));
      var path = u.pathname.replace(/\/+$/, '/');
      return u.origin + path;
    } catch (e) {
      return String(url || '');
    }
  }

  /** 补全协议：B 站 og:image 常见 //i0.hdslb.com/xxx 这种协议相对地址 */
  function normalizeUrl(u) {
    var s = String(u == null ? '' : u).trim();
    if (!s) return '';
    if (s.indexOf('//') === 0) return 'https:' + s;
    if (/^http:\/\//i.test(s)) return s.replace(/^http:/i, 'https:');
    if (/^data:/i.test(s)) return s;
    return s;
  }

  /**
   * 封面地址去参数：i0.hdslb.com/bfs/archive/x.jpg@672w_378h_1c.webp
   * → i0.hdslb.com/bfs/archive/x.jpg
   * QQ 分享卡片对 webp 支持一般，用原图（jpg/png）更稳。
   */
  function stripImageSuffix(u) {
    var s = normalizeUrl(u);
    var at = s.lastIndexOf('@');
    if (at > s.lastIndexOf('/')) return s.slice(0, at);
    return s;
  }

  /* ------------------------------------------------------------------ *
   * 二、文本处理
   * ------------------------------------------------------------------ */

  // document.title 尾巴上的固定后缀，只在末尾精确匹配，避免切掉标题本身
  var TITLE_SUFFIXES = [
    '_哔哩哔哩_bilibili',
    '_番剧_bilibili_哔哩哔哩',
    '_哔哩哔哩_dance',
    '_国创_bilibili',
    '_纪录片_bilibili',
    '_电影_bilibili',
    '_电视剧_bilibili',
    '_动画_bilibili',
    '_影视_bilibili',
    '_bilibili_哔哩哔哩',
    '_bilibili',
    '_哔哩哔哩',
    ' - 哔哩哔哩',
    ' | 哔哩哔哩',
    '—哔哩哔哩'
  ];

  /** 清洗标题：折叠空白 + 去掉 "_哔哩哔哩_bilibili" 之类的站点后缀 */
  function cleanTitle(raw) {
    var t = String(raw == null ? '' : raw)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < TITLE_SUFFIXES.length; i++) {
        var s = TITLE_SUFFIXES[i];
        if (t.length > s.length && t.slice(-s.length).toLowerCase() === s.toLowerCase()) {
          t = t.slice(0, -s.length).trim();
          changed = true;
        }
      }
    }
    return t || String(raw == null ? '' : raw).trim();
  }

  /**
   * 解析 B 站播放量文本："123.4万" → 1234000；"1.2亿" → 120000000；
   * "12,345" → 12345；"56.7万播放" → 567000
   */
  function parseCount(text) {
    var s = String(text == null ? '' : text).replace(/,/g, '');
    var m = s.match(/(\d+(?:\.\d+)?)\s*(亿|万|w|k)?/i);
    if (!m) return null;
    var n = parseFloat(m[1]);
    if (!isFinite(n)) return null;
    var unit = (m[2] || '').toLowerCase();
    if (unit === '亿') n *= 1e8;
    else if (unit === '万' || unit === 'w') n *= 1e4;
    else if (unit === 'k') n *= 1e3;
    return Math.round(n);
  }

  /** 播放量格式化：12000 → "1.2万"；120000000 → "1.2亿" */
  function formatCount(n) {
    if (n == null || !isFinite(n) || n < 0) return '';
    n = Math.round(n);
    function trim(x) {
      return String(Number(x.toFixed(1)));
    }
    if (n >= 1e8) return trim(n / 1e8) + '亿';
    if (n >= 1e4) return trim(n / 1e4) + '万';
    return String(n);
  }

  /** 秒 → "03:21" / "1:02:03" */
  function formatDuration(sec) {
    var s = Number(sec);
    if (!isFinite(s) || s <= 0) return '';
    s = Math.round(s);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var ss = s % 60;
    var pad = function (x) {
      return (x < 10 ? '0' : '') + x;
    };
    return h > 0 ? h + ':' + pad(m) + ':' + pad(ss) : m + ':' + pad(ss);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------------------------------------------------------ *
   * 三、分享载荷
   * ------------------------------------------------------------------ */

  /**
   * 把页面抓到的原始字段整理成统一的分享载荷。
   * @param {{url?:string,title?:string,docTitle?:string,up?:string,cover?:string,
   *          play?:string|number,playRaw?:string,duration?:number|string,desc?:string}} input
   */
  function buildPayload(input) {
    var src = input || {};
    var url = canonicalVideoUrl(src.url || '');
    var id = parseVideoId(url) || {};
    var title = cleanTitle(src.title || src.docTitle || '') || '哔哩哔哩视频';
    var cover = normalizeUrl(src.cover || '');
    var playRaw = src.playRaw != null && src.playRaw !== '' ? src.playRaw : src.play;
    var duration = formatDuration(src.duration);

    return {
      url: url,
      vid: id.vid || '',
      bvid: id.bvid || '',
      title: title,
      up: String(src.up || '').trim(),
      cover: cover,
      coverShare: stripImageSuffix(cover),
      play: formatCount(parseCount(playRaw)),
      duration: duration,
      desc: String(src.desc || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 140),
      site: SITE_NAME
    };
  }

  /** QQ 卡片副标题：简介 + UP 主 + 播放量，控制在一行内 */
  function buildSummary(p) {
    var parts = [];
    if (p.desc) parts.push(p.desc.slice(0, 46));
    if (p.up) parts.push('UP主：' + p.up);
    if (p.play) parts.push(p.play + '播放');
    var s = parts.join(' · ');
    return s ? s.slice(0, 110) : '哔哩哔哩视频';
  }

  /** 纯文本版分享文案（复制 / 粘贴兜底） */
  function buildShareText(p) {
    var head = p.up ? p.title + ' - ' + p.up : p.title;
    return head + '\n' + p.url;
  }

  /**
   * 富文本版分享文案：粘贴到支持 HTML 的聊天窗口里会呈现卡片样式。
   * 注意：封面用原始 http 地址（不用 data URL），避免剪贴板体积爆炸。
   */
  function buildShareHtml(p) {
    var cover = p.coverShare || p.cover;
    var sub = [SITE_NAME];
    if (p.up) sub.push('UP主：' + p.up);
    if (p.play) sub.push(p.play + '播放');

    return (
      '<meta charset="utf-8">' +
      '<div style="max-width:520px;border:1px solid #ececec;border-radius:12px;overflow:hidden;' +
      'font-family:' +
      FONT_STACK.replace(/"/g, "'") +
      ';background:#fff">' +
      (cover
        ? '<img src="' + escapeHtml(cover) + '" alt="" style="display:block;width:100%;max-height:292px;object-fit:cover">'
        : '') +
      '<div style="padding:12px 14px 14px">' +
      '<div style="font-size:16px;line-height:1.45;font-weight:600;color:#18191c">' +
      escapeHtml(p.title) +
      '</div>' +
      '<div style="margin-top:6px;font-size:12px;color:#9499a0">' +
      escapeHtml(sub.join(' · ')) +
      '</div>' +
      '<div style="margin-top:8px;font-size:12px;color:#00aeec;word-break:break-all">' +
      escapeHtml(p.url) +
      '</div>' +
      '</div></div>'
    );
  }

  /**
   * 拼装 QQ 官方「一键分享」地址。
   * 打开后是 QQ 的分享页：登录 → 选好友/群 → 直接发卡片（标题 + 封面 + 简介 + 链接）。
   * 参数名沿用 connect.qq.com 分享组件的约定：url / title / summary / pics / site。
   */
  function buildQqShareUrl(p) {
    var params = [
      ['url', p.url],
      ['title', p.title],
      ['summary', buildSummary(p)],
      ['pics', p.coverShare || p.cover || ''],
      ['site', SITE_NAME],
      // desc 是部分旧版分享组件读取的字段，多带一个不冲突
      ['desc', buildSummary(p)]
    ];
    var qs = params
      .filter(function (kv) {
        return kv[1] !== '' && kv[1] != null;
      })
      .map(function (kv) {
        return kv[0] + '=' + encodeURIComponent(kv[1]);
      })
      .join('&');
    return QQ_WIDGET + '?' + qs;
  }

  /* ------------------------------------------------------------------ *
   * 四、文本换行（中英混排）
   * ------------------------------------------------------------------ */

  function isWide(ch) {
    var c = ch.codePointAt(0);
    return (
      (c >= 0x2e80 && c <= 0x9fff) || // CJK
      (c >= 0xac00 && c <= 0xd7af) || // 韩文
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0x3000 && c <= 0x303f) // CJK 标点
    );
  }

  /** 切成可断行的小块：中日韩字符逐字、拉丁单词整体、空格单独 */
  function tokenize(text) {
    var s = String(text || '');
    var out = [];
    var buf = '';
    var flush = function () {
      if (buf) {
        out.push({ type: 'word', text: buf });
        buf = '';
      }
    };
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (/\s/.test(ch)) {
        flush();
        out.push({ type: 'space', text: ' ' });
      } else if (isWide(ch)) {
        flush();
        out.push({ type: 'word', text: ch });
      } else {
        buf += ch;
      }
    }
    flush();
    return out;
  }

  function ellipsize(line, maxWidth, measure) {
    var ell = '…';
    var s = line;
    while (s && measure(s + ell) > maxWidth) s = s.slice(0, -1);
    return s + ell;
  }

  /**
   * 按像素宽度换行。
   * @param {string} text
   * @param {number} maxWidth
   * @param {(s:string)=>number} measure 宽度测量函数（浏览器里用 canvas.measureText）
   * @param {number} [maxLines=3]
   * @returns {{lines:string[], truncated:boolean}}
   */
  function wrapText(text, maxWidth, measure, maxLines) {
    var limit = maxLines == null ? 3 : maxLines;
    var tokens = tokenize(text);
    var lines = [];
    var cur = '';

    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      if (tok.type === 'space') {
        if (cur) cur += ' ';
        continue;
      }
      var candidate = cur + tok.text;
      if (measure(candidate) <= maxWidth) {
        cur = candidate;
        continue;
      }
      if (cur) {
        lines.push(cur.replace(/\s+$/, ''));
        cur = '';
      }
      if (measure(tok.text) <= maxWidth) {
        cur = tok.text;
        continue;
      }
      // 单个 token 本身就超宽：逐字硬切
      var chunk = '';
      for (var j = 0; j < tok.text.length; j++) {
        var ch = tok.text[j];
        if (chunk && measure(chunk + ch) > maxWidth) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      cur = chunk;
    }
    if (cur.replace(/\s+$/, '')) lines.push(cur.replace(/\s+$/, ''));
    if (!lines.length) lines.push('');

    var truncated = lines.length > limit;
    if (truncated) lines = lines.slice(0, limit);
    if (truncated) lines[lines.length - 1] = ellipsize(lines[lines.length - 1], maxWidth, measure);
    return { lines: lines, truncated: truncated };
  }

  /* ------------------------------------------------------------------ *
   * 五、卡片排版
   * ------------------------------------------------------------------ */

  function fallbackMeasure(text, font) {
    // 仅在没有 canvas 的环境（Node 单测）中使用：CJK 按 1em，其余按 0.55em
    var size = 14;
    var m = /(\d+(?:\.\d+)?)px/.exec(String(font || ''));
    if (m) size = parseFloat(m[1]);
    var w = 0;
    for (var i = 0; i < String(text).length; i++) {
      w += isWide(String(text)[i]) ? size : size * 0.55;
    }
    return w;
  }

  /**
   * 计算分享卡片的所有绘制指令（纯数据）。
   *
   * 支持的 op：
   *   { type:'roundRect', x,y,w,h,r, fill?, stroke?, lineWidth?, gradient?:[c1,c2] }
   *   { type:'image', src, x,y,w,h,r }          —— cover 裁剪在渲染器里做
   *   { type:'text', text, x,y, font, color }
   *   { type:'badge', text, x,y,w,h,r, font, color, bg }
   *   { type:'line', x1,y1,x2,y2, color, lineWidth }
   *
   * @param {object} payload buildPayload() 的结果
   * @param {{measure?:(s:string,font:string)=>number, hasCover?:boolean}} [opts]
   */
  function layoutCard(payload, opts) {
    var o = opts || {};
    var measure = typeof o.measure === 'function' ? o.measure : fallbackMeasure;
    var p = payload || {};
    var W = CARD.width;
    var H = CARD.height;
    var PAD = CARD.pad;
    var ops = [];

    // 卡片底板 + 1px 描边
    ops.push({ type: 'roundRect', x: 0.5, y: 0.5, w: W - 1, h: H - 1, r: CARD.radius, fill: '#FFFFFF' });
    ops.push({ type: 'roundRect', x: 0.5, y: 0.5, w: W - 1, h: H - 1, r: CARD.radius, stroke: '#E9EAEC', lineWidth: 1 });

    // ---- 封面 16:9 ----
    var CW = 288;
    var CH = 162;
    var CX = PAD;
    var CY = PAD;
    var CR = 12;

    if (p.cover && o.hasCover !== false) {
      ops.push({ type: 'image', src: p.cover, x: CX, y: CY, w: CW, h: CH, r: CR });
    } else {
      ops.push({
        type: 'roundRect',
        x: CX,
        y: CY,
        w: CW,
        h: CH,
        r: CR,
        gradient: ['#FB7299', '#FFB3C7']
      });
      var phFont = '700 20px ' + FONT_STACK;
      var phText = SITE_NAME;
      var phW = measure(phText, phFont);
      ops.push({
        type: 'text',
        text: phText,
        x: CX + (CW - phW) / 2,
        y: CY + CH / 2 + 7,
        font: phFont,
        color: '#FFFFFF'
      });
    }

    // ---- 时长角标 ----
    if (p.duration) {
      var badgeFont = '600 13px ' + FONT_STACK;
      var bw = measure(p.duration, badgeFont) + 16;
      var bh = 24;
      ops.push({
        type: 'badge',
        text: p.duration,
        x: CX + CW - 8 - bw,
        y: CY + CH - 8 - bh,
        w: bw,
        h: bh,
        r: 6,
        font: badgeFont,
        color: '#FFFFFF',
        bg: 'rgba(0,0,0,0.66)'
      });
    }

    // ---- 右侧文字区 ----
    var colX = CX + CW + 24;
    var colRight = W - PAD;
    var colW = colRight - colX;

    var titleFont = '600 22px ' + FONT_STACK;
    var title = wrapText(p.title, colW, function (t) {
      return measure(t, titleFont);
    }, 3);

    var baseline = PAD + 21; // 首行基线
    var lastBaseline = baseline;
    for (var i = 0; i < title.lines.length; i++) {
      ops.push({ type: 'text', text: title.lines[i], x: colX, y: baseline, font: titleFont, color: '#18191C' });
      lastBaseline = baseline;
      baseline += 31;
    }

    // ---- 元信息：UP 主 / 播放量 ----
    var metaFont = '400 15px ' + FONT_STACK;
    var metaLines = [];
    if (p.up) metaLines.push('UP主：' + p.up.slice(0, 18));
    if (p.play) metaLines.push(p.play + ' 播放');
    if (!metaLines.length) metaLines.push(SITE_NAME + '视频');

    var metaY = lastBaseline + 32;
    for (var k = 0; k < metaLines.length; k++) {
      ops.push({ type: 'text', text: metaLines[k], x: colX, y: metaY, font: metaFont, color: '#61666D' });
      metaY += 26;
    }

    // ---- 简介（有空间时显示，最多 3 行） ----
    var footerTop = H - 62;
    if (p.desc) {
      var descFont = '400 13px ' + FONT_STACK;
      var room = Math.floor((footerTop - 18 - metaY) / 20);
      var maxLines = Math.max(0, Math.min(3, room));
      if (maxLines > 0) {
        var desc = wrapText(p.desc, colW, function (t) {
          return measure(t, descFont);
        }, maxLines);
        var dy = metaY + 20;
        for (var d = 0; d < desc.lines.length; d++) {
          ops.push({ type: 'text', text: desc.lines[d], x: colX, y: dy, font: descFont, color: '#9499A0' });
          dy += 20;
        }
      }
    }

    // ---- 页脚 ----
    ops.push({ type: 'line', x1: PAD, y1: footerTop, x2: W - PAD, y2: footerTop, color: '#F2F3F5', lineWidth: 1 });

    var logoFont = '700 17px ' + FONT_STACK;
    ops.push({ type: 'text', text: SITE_NAME, x: PAD, y: H - 24, font: logoFont, color: '#FB7299' });

    var siteFont = '400 13px ' + FONT_STACK;
    var siteText = 'bilibili.com';
    ops.push({
      type: 'text',
      text: siteText,
      x: W - PAD - measure(siteText, siteFont),
      y: H - 25,
      font: siteFont,
      color: '#9499A0'
    });

    return {
      width: W,
      height: H,
      radius: CARD.radius,
      ops: ops
    };
  }

  var api = {
    FONT_STACK: FONT_STACK,
    CARD: CARD,
    SITE_NAME: SITE_NAME,
    QQ_WIDGET: QQ_WIDGET,
    parseVideoId: parseVideoId,
    canonicalVideoUrl: canonicalVideoUrl,
    normalizeUrl: normalizeUrl,
    stripImageSuffix: stripImageSuffix,
    cleanTitle: cleanTitle,
    parseCount: parseCount,
    formatCount: formatCount,
    formatDuration: formatDuration,
    escapeHtml: escapeHtml,
    buildPayload: buildPayload,
    buildSummary: buildSummary,
    buildShareText: buildShareText,
    buildShareHtml: buildShareHtml,
    buildQqShareUrl: buildQqShareUrl,
    tokenize: tokenize,
    wrapText: wrapText,
    layoutCard: layoutCard,
    fallbackMeasure: fallbackMeasure
  };

  root.BQQCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
