/*!
 * B站分享到QQ卡片 — content.js
 *
 * 内容脚本：抓取当前视频信息 → 挂载悬浮入口与分享面板 → 执行四种分享动作。
 */
(function () {
  'use strict';

  if (window.__BQQ_CONTENT_LOADED__) return;
  window.__BQQ_CONTENT_LOADED__ = true;

  var C = window.BQQCore;
  var Panel = window.BQQPanel;
  var Card = window.BQQCard;
  if (!C || !Panel || !Card) return;

 /* ----------------------------- 页面信息抓取 ----------------------------- */

  function text(sel) {
    var el = document.querySelector(sel);
    if (!el) return '';
    var t = el.textContent || '';
    return t.replace(/\s+/g, ' ').trim();
  }

  function attr(sel, name) {
    var el = document.querySelector(sel);
    return el ? el.getAttribute(name) || '' : '';
  }

  function metaContent(key) {
    var el =
      document.querySelector('meta[property="' + key + '"]') ||
      document.querySelector('meta[name="' + key + '"]') ||
      document.querySelector('meta[itemprop="' + key + '"]');
    return el ? el.getAttribute('content') || '' : '';
  }

  function readTitle() {
    var t =
      text('h1.video-title') ||
      text('h1.mediainfo_mediaTitle') ||
      text('.video-title') ||
      text('.mediainfo_mediaTitle') ||
      metaContent('og:title') ||
      document.title;
    return C.cleanTitle(t);
  }

  function readUp() {
    var up =
      text('.up-name') ||
      text('a.up-name') ||
      text('.up-info--right .up-name') ||
      text('.mediainfo_mediaAuthor a') ||
      text('.username');
    return up.replace(/\s*·\s*\d[\d.]*[万亿]?粉丝.*$/, '').trim();
  }

  function readPlay() {
    var candidates = [
      '.view.item',
      '.view.item .view-text',
      '.video-view',
      '.video-info-detail .view',
      '.bili-video-card__stats--item'
    ];
    for (var i = 0; i < candidates.length; i++) {
      var raw = text(candidates[i]);
      if (!raw) continue;
      var m = raw.match(/([\d][\d.,]*\s*[万亿]?)\s*(?:播放|观看)/);
      if (m) return m[1];
      if (/^[\d][\d.,]*\s*[万亿]?$/.test(raw)) return raw;
    }
    // 兜底：在播放大号数字容器里找
    var stat = text('.video-info-detail') || text('.video-info') || '';
    var mm = stat.match(/([\d][\d.,]*\s*[万亿]?)\s*(?:播放|观看)/);
    return mm ? mm[1] : '';
  }

  function readDuration() {
    var v = document.querySelector('video');
    if (v && isFinite(v.duration) && v.duration > 0) return v.duration;
    var t = text('.bpx-player-ctrl-time-duration') || text('.bpx-player-ctrl-time-current');
    var m = t && t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      return m[3]
        ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
        : Number(m[1]) * 60 + Number(m[2]);
    }
    var iso = metaContent('duration') || attr('meta[itemprop="duration"]', 'content');
    var im = iso && iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
    if (im) {
      return Number(im[1] || 0) * 3600 + Number(im[2] || 0) * 60 + Number(im[3] || 0);
    }
    return 0;
  }

  function readCover() {
    return (
      metaContent('og:image') ||
      metaContent('image') ||
      attr('video[poster]', 'poster') ||
      attr('.mediainfo_mediaCover img', 'src') ||
      ''
    );
  }

  function readDesc() {
    var d =
      metaContent('og:description') ||
      metaContent('description') ||
      text('.basic-desc-info') ||
      text('.desc-info-text');
    return String(d).replace(/^视频播放量[^，。]*[，。]?/, '').trim();
  }

  function extractPayload() {
    return C.buildPayload({
      url: location.href,
      title: readTitle(),
      docTitle: document.title,
      up: readUp(),
      cover: readCover(),
      playRaw: readPlay(),
      duration: readDuration(),
      desc: readDesc()
    });
  }

  /* ----------------------------- 剪贴板 / 下载 ----------------------------- */

  function copyPlain(str) {
    return new Promise(function (resolve, reject) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(str).then(resolve, function () {
          legacyCopy(str) ? resolve() : reject(new Error('复制失败'));
        });
        return;
      }
      legacyCopy(str) ? resolve() : reject(new Error('复制失败'));
    });
  }

  function legacyCopy(str) {
    var ta = document.createElement('textarea');
    ta.value = str;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    ta.remove();
    return ok;
  }

  /** 复制富文本卡片：优先 text/html，失败退回纯文本 */
  function copyRich(html, fallbackText) {
    if (navigator.clipboard && window.ClipboardItem) {
      var item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([fallbackText], { type: 'text/plain' })
      });
      return navigator.clipboard.write([item]).catch(function () {
        return copyPlain(fallbackText);
      });
    }
    return copyPlain(fallbackText);
  }

  function safeName(p) {
    var base = (p.title || 'bilibili').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
    var tag = p.vid || Date.now();
    return 'B站卡片_' + base + '_' + tag + '.png';
  }

  function downloadDataUrl(dataUrl, filename) {
    var a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    setTimeout(function () {
      a.remove();
    }, 0);
  }

  /** 让后台把封面抓成 data URL（页面 <img> 跨域会污染 canvas） */
  function fetchCoverDataUrl(payload) {
    return new Promise(function (resolve) {
      var url = payload.coverShare || payload.cover;
      if (!url) return resolve('');
      try {
        chrome.runtime.sendMessage({ type: 'BQQ_FETCH_IMAGE', url: url }, function (res) {
          if (chrome.runtime.lastError || !res || !res.ok) resolve('');
          else resolve(res.dataUrl || '');
        });
      } catch (e) {
        resolve('');
      }
    });
  }

  /* ----------------------------- 面板动作 ----------------------------- */

  var panel = null;

  var actions = {
    qq: function (payload) {
      return new Promise(function (resolve, reject) {
        try {
          chrome.runtime.sendMessage({ type: 'BQQ_OPEN_QQ', payload: payload }, function (res) {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            if (!res || !res.ok) return reject(new Error((res && res.error) || '打开 QQ 分享页失败'));
            resolve({
              message: '已打开 QQ 分享页，选择好友即可发送卡片'
            });
          });
        } catch (e) {
          reject(e);
        }
      });
    },

    card: function (payload) {
      var html = C.buildShareHtml(payload);
      var plain = C.buildShareText(payload);
      return copyRich(html, plain).then(function () {
        return { message: '卡片已复制，粘贴到 QQ 聊天窗口即可' };
      });
    },

    image: function (payload) {
      return fetchCoverDataUrl(payload)
        .then(function (coverDataUrl) {
          return Card.renderCard(payload, { scale: 2, coverDataUrl: coverDataUrl });
        })
        .then(function (r) {
          downloadDataUrl(r.dataUrl, safeName(payload));
          return { message: '卡片图片已保存到下载目录' };
        });
    },

    link: function (payload) {
      return copyPlain(C.buildShareText(payload)).then(function () {
        return { message: '标题 + 链接已复制' };
      });
    }
  };

  /* ----------------------------- 初始化 / SPA 适配 ----------------------------- */

  var lastKey = '';

  function isVideoPage() {
    return /^\/(video\/|bangumi\/play\/)/.test(location.pathname);
  }

  function refresh(force) {
    if (!isVideoPage()) {
      if (panel) panel.setPayload(null);
      return;
    }
    var payload = extractPayload();
    var key = payload.url + '|' + payload.title + '|' + payload.up;
    if (!force && key === lastKey) return;
    lastKey = key;
    if (!panel) {
      panel = Panel.mount({ actions: actions });
    }
    panel.setPayload(payload);
    document.documentElement.dataset.bqqReady = '1';
    document.documentElement.dataset.bqqVid = payload.vid || '';
  }

  function start() {
    if (!isVideoPage()) return;
    document.documentElement.dataset.bqqLoaded = '1';
    refresh(true);

    // SPA 路由变化（B 站是 pushState 切换）
    ['pushState', 'replaceState'].forEach(function (m) {
      var orig = history[m];
      if (typeof orig !== 'function') return;
      history[m] = function () {
        var r = orig.apply(this, arguments);
        setTimeout(function () {
          refresh(true);
        }, 300);
        return r;
      };
    });
    window.addEventListener('popstate', function () {
      setTimeout(function () {
        refresh(true);
      }, 300);
    });

    // 标题 / 分P 变化兜底（每 1.2s 比对一次，成本可忽略）
    setInterval(function () {
      refresh(false);
    }, 1200);

    // watch 元素移除（B 站会替换 body 内容）：重新挂载
    setInterval(function () {
      if (panel && !document.getElementById('bqq-share-root')) {
        var p = panel.getPayload();
        panel = Panel.mount({ actions: actions });
        if (p) panel.setPayload(p);
      }
    }, 2000);

    try {
      chrome.runtime.onMessage.addListener(function (msg) {
        if (!msg || !msg.type) return;
        if (msg.type === 'BQQ_TOGGLE_PANEL') {
          refresh(false);
          if (panel) {
            if (panel.isOpen()) panel.hide();
            else panel.show();
          }
        }
      });
    } catch (e) {
      /* 扩展上下文失效时忽略 */
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
