/*!
 * B站分享到QQ卡片 — panel.js
 *
 * 分享面板（Shadow DOM 隔离，桌面版复刻手机端 B 站的「分享」底部弹层）：
 *   封面缩略图 + 标题 + UP主/播放量 + 四宫格动作 + 提示 + toast
 *
 * 动作通过 actions 回调交给 content.js 执行（拿数据、调后台、写剪贴板）。
 */
(function (root) {
  'use strict';

  var C = root.BQQCore;
  var HOST_ID = 'bqq-share-root';

  var ICONS = {
    qq:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M12 3c-3.4 0-6 2.6-6 6v2.2c-.6 1.2-1 2.2-1 2.9 0 .7.4 1.1 1 1.1.3 0 .6-.1.9-.3.4 1.5 1.4 2.7 2.7 3.4-.4.3-.6.7-.6 1.1 0 .8.8 1.4 1.9 1.6.5.5 1.5.8 2.1.8s1.6-.3 2.1-.8c1.1-.2 1.9-.8 1.9-1.6 0-.4-.2-.8-.6-1.1 1.3-.7 2.3-1.9 2.7-3.4.3.2.6.3.9.3.6 0 1-.4 1-1.1 0-.7-.4-1.7-1-2.9V9c0-3.4-2.6-6-6-6Z"/>' +
      '<circle cx="9.5" cy="9" r="1.2" fill="#fff"/><circle cx="14.5" cy="9" r="1.2" fill="#fff"/></svg>',
    card:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="3" y="4.5" width="18" height="15" rx="3"/>' +
      '<path d="M3 9.5h18"/><path d="M6.5 14h5"/><path d="M6.5 17h3"/></svg>',
    image:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="3" y="4.5" width="18" height="15" rx="3"/>' +
      '<circle cx="8.7" cy="9.8" r="1.6"/><path d="M3.6 17.2l4.6-4.4 3.4 3.2 2.6-2.4 6.2 5.6"/></svg>',
    link:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.3 1.3"/>' +
      '<path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.3-1.3"/></svg>'
  };

  var ACTION_DEFS = [
    { id: 'qq', label: 'QQ好友', hint: '发卡片', primary: true },
    { id: 'card', label: '复制卡片', hint: '富文本' },
    { id: 'image', label: '保存图片', hint: 'PNG' },
    { id: 'link', label: '复制链接', hint: '纯文本' }
  ];

  var CSS = [
    ':host,*{box-sizing:border-box}',
    '.bqq-btn{all:unset;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    /* 悬浮按钮 */
    '.bqq-fab{position:fixed;right:22px;bottom:104px;z-index:2147483000;width:46px;height:46px;',
    'border-radius:15px;display:flex;align-items:center;justify-content:center;color:#fff;pointer-events:auto;',
    'background:linear-gradient(140deg,#00AEEC 0%,#FB7299 100%);box-shadow:0 6px 18px rgba(251,114,153,.38),0 2px 6px rgba(0,0,0,.12);',
    'transition:transform .18s ease,box-shadow .18s ease,opacity .25s ease;}',
    '.bqq-fab:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 10px 22px rgba(251,114,153,.46)}',
    '.bqq-fab:active{transform:scale(.96)}',
    '.bqq-fab svg{width:24px;height:24px}',
    '.bqq-fab[data-hidden="1"]{opacity:0;pointer-events:none;transform:translateY(10px)}',
    /* 遮罩：关闭时必须 visibility:hidden + pointer-events:none，否则透明遮罩会吃掉整页点击 */
    '.bqq-mask{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.45);',
    'opacity:0;visibility:hidden;pointer-events:none;',
    'transition:opacity .22s ease,visibility 0s linear .22s}',
    '.bqq-mask[data-open="1"]{opacity:1;visibility:visible;pointer-events:auto;',
    'backdrop-filter:blur(1.5px);-webkit-backdrop-filter:blur(1.5px);',
    'transition:opacity .22s ease,visibility 0s linear 0s}',
    /* 底部弹层（同理：关闭后不可命中） */
    '.bqq-sheet{position:fixed;left:0;right:0;bottom:0;z-index:2147483002;margin:0 auto;max-width:460px;',
    'background:#fff;border-radius:20px 20px 0 0;padding:18px 18px calc(16px + env(safe-area-inset-bottom));',
    'font-family:"PingFang SC","Microsoft YaHei","Hiragino Sans GB",-apple-system,"Segoe UI",sans-serif;',
    'color:#18191c;transform:translateY(101%);visibility:hidden;pointer-events:none;',
    'transition:transform .26s cubic-bezier(.22,.9,.3,1),visibility 0s linear .26s;',
    'box-shadow:0 -8px 30px rgba(0,0,0,.16)}',
    '.bqq-sheet[data-open="1"]{transform:translateY(0);visibility:visible;pointer-events:auto;',
    'transition:transform .26s cubic-bezier(.22,.9,.3,1),visibility 0s linear 0s}',
    '.bqq-close{position:absolute;right:12px;top:12px;width:28px;height:28px;border-radius:50%;',
    'display:flex;align-items:center;justify-content:center;color:#9499a0;font-size:15px;background:transparent}',
    '.bqq-close:hover{background:#f4f5f7;color:#61666d}',
    /* 头部信息 */
    '.bqq-head{display:flex;gap:12px;align-items:flex-start;padding-right:24px}',
    '.bqq-cover{flex:0 0 96px;width:96px;height:54px;border-radius:8px;overflow:hidden;background:#f1f2f3;',
    'display:flex;align-items:center;justify-content:center}',
    '.bqq-cover img{width:100%;height:100%;object-fit:cover;display:block}',
    '.bqq-cover[data-empty="1"]{background:linear-gradient(135deg,#FB7299,#FFB3C7)}',
    '.bqq-cover[data-empty="1"]::after{content:"哔哩哔哩";color:#fff;font-size:11px;font-weight:600}',
    '.bqq-info{min-width:0;flex:1}',
    '.bqq-title{font-size:15px;line-height:1.45;font-weight:600;display:-webkit-box;-webkit-line-clamp:2;',
    '-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}',
    '.bqq-meta{margin-top:6px;font-size:12px;color:#9499a0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    /* 动作四宫格 */
    '.bqq-actions{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:18px}',
    '.bqq-act{display:flex;flex-direction:column;align-items:center;gap:7px;padding:6px 2px;border-radius:12px;',
    'transition:background .15s ease,transform .15s ease}',
    '.bqq-act:hover{background:#faf7f8}',
    '.bqq-act:active{transform:scale(.95)}',
    '.bqq-act[data-busy="1"]{opacity:.55;pointer-events:none}',
    '.bqq-ic{width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;',
    'background:#f6f7f8;color:#61666d}',
    '.bqq-ic svg{width:23px;height:23px}',
    '.bqq-act[data-primary="1"] .bqq-ic{background:linear-gradient(140deg,#00AEEC,#FB7299);color:#fff;',
    'box-shadow:0 4px 12px rgba(251,114,153,.32)}',
    '.bqq-act-label{font-size:12px;color:#18191c;line-height:1}',
    '.bqq-act-hint{font-size:10px;color:#c0c4cc;line-height:1}',
    /* 底部提示 */
    '.bqq-hint{margin-top:16px;padding-top:12px;border-top:1px solid #f4f5f7;font-size:11px;color:#9499a0;',
    'display:flex;justify-content:space-between;gap:10px}',
    '.bqq-hint b{color:#FB7299;font-weight:600}',
    /* toast */
    '.bqq-toast{position:fixed;left:50%;bottom:240px;z-index:2147483003;transform:translate(-50%,8px);',
    'background:rgba(24,25,28,.92);color:#fff;font-size:13px;line-height:1;padding:11px 16px;border-radius:10px;',
    'opacity:0;pointer-events:none;transition:opacity .2s ease,transform .2s ease;max-width:80vw;text-align:center}',
    '.bqq-toast[data-show="1"]{opacity:1;transform:translate(-50%,0)}'
  ].join('');

  function h(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  /**
   * 挂载面板。
   * @param {{actions:{qq?:Function,card?:Function,image?:Function,link?:Function}}} opts
   * @returns {{show:(p:object)=>void, hide:()=>void, toggle:(p:object)=>void, toast:(m:string)=>void,
   *            setPayload:(p:object)=>void, isOpen:()=>boolean, destroy:()=>void}}
   */
  function mount(opts) {
    var actions = (opts && opts.actions) || {};
    var existing = document.getElementById(HOST_ID);
    if (existing) existing.remove();

    var host = h('div', 'bqq-host');
    host.id = HOST_ID;
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none;';
    var shadow = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    // 悬浮按钮
    var fab = h('button', 'bqq-btn bqq-fab', ICONS.card);
    fab.setAttribute('type', 'button');
    fab.setAttribute('title', '分享到 QQ 卡片（Alt+Shift+B）');
    fab.setAttribute('aria-label', '分享到 QQ 卡片');
    shadow.appendChild(fab);

    // 遮罩 + 弹层（可点性完全交给 CSS 的 data-open 控制，勿在此写内联 pointer-events）
    var mask = h('div', 'bqq-mask');
    mask.addEventListener('click', hide);

    var sheet = h('div', 'bqq-sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', '分享');

    var close = h('button', 'bqq-btn bqq-close', '&#10005;');
    close.setAttribute('type', 'button');
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', hide);

    var head = h('div', 'bqq-head');
    var cover = h('div', 'bqq-cover');
    cover.setAttribute('data-empty', '1');
    var coverImg = document.createElement('img');
    coverImg.alt = '';
    coverImg.referrerPolicy = 'no-referrer';
    coverImg.onerror = function () {
      cover.removeAttribute('data-empty');
      cover.setAttribute('data-empty', '1');
      coverImg.remove();
    };
    var info = h('div', 'bqq-info');
    var titleEl = h('div', 'bqq-title', '哔哩哔哩视频');
    var metaEl = h('div', 'bqq-meta', '');
    info.appendChild(titleEl);
    info.appendChild(metaEl);
    head.appendChild(cover);
    head.appendChild(info);

    var grid = h('div', 'bqq-actions');
    var btns = {};
    ACTION_DEFS.forEach(function (def) {
      var b = h('button', 'bqq-btn bqq-act');
      b.setAttribute('type', 'button');
      if (def.primary) b.setAttribute('data-primary', '1');
      b.appendChild(h('span', 'bqq-ic', ICONS[def.id] || ''));
      b.appendChild(h('span', 'bqq-act-label', def.label));
      b.appendChild(h('span', 'bqq-act-hint', def.hint));
      b.addEventListener('click', function () {
        runAction(def, b);
      });
      btns[def.id] = b;
      grid.appendChild(b);
    });

    var hint = h(
      'div',
      'bqq-hint',
      '<span>打开 QQ 分享页后会直接出现 <b>视频卡片</b></span><span>Alt+Shift+B</span>'
    );

    sheet.appendChild(close);
    sheet.appendChild(head);
    sheet.appendChild(grid);
    sheet.appendChild(hint);

    var toastEl = h('div', 'bqq-toast');
    toastEl.style.pointerEvents = 'none';

    shadow.appendChild(mask);
    shadow.appendChild(sheet);
    shadow.appendChild(toastEl);

    var toastTimer = 0;
    function toast(msg, ms) {
      toastEl.textContent = msg;
      toastEl.setAttribute('data-show', '1');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        toastEl.setAttribute('data-show', '0');
      }, ms || 1800);
    }

    var payload = null;
    var open = false;

    function setPayload(p) {
      payload = p || null;
      if (!p) {
        fab.setAttribute('data-hidden', '1');
        return;
      }
      fab.removeAttribute('data-hidden');
      titleEl.textContent = p.title || '哔哩哔哩视频';
      var metaParts = [];
      if (p.up) metaParts.push('UP主：' + p.up);
      if (p.play) metaParts.push(p.play + '播放');
      if (p.duration) metaParts.push(p.duration);
      metaEl.textContent = metaParts.join(' · ');
      var coverUrl = p.coverShare || p.cover;
      if (coverUrl) {
        cover.removeAttribute('data-empty');
        coverImg.src = coverUrl;
        if (!coverImg.parentNode) cover.appendChild(coverImg);
      } else {
        cover.setAttribute('data-empty', '1');
        coverImg.remove();
      }
    }

    function show(p) {
      if (p) setPayload(p);
      if (!payload) return;
      open = true;
      // 直接置位，不依赖 rAF：后台标签页里 rAF 会被节流，面板会「看起来没开」
      mask.setAttribute('data-open', '1');
      sheet.setAttribute('data-open', '1');
      document.addEventListener('keydown', onKey, true);
    }

    function hide() {
      open = false;
      mask.setAttribute('data-open', '0');
      sheet.setAttribute('data-open', '0');
      document.removeEventListener('keydown', onKey, true);
    }

    function toggle(p) {
      if (open) hide();
      else show(p);
    }

    function onKey(ev) {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        hide();
      }
    }

    function runAction(def, btn) {
      var fn = actions[def.id];
      if (typeof fn !== 'function') return;
      btn.setAttribute('data-busy', '1');
      Promise.resolve()
        .then(function () {
          return fn(payload);
        })
        .then(function (res) {
          if (res && res.message) toast(res.message);
        })
        .catch(function (err) {
          toast((err && err.message) || '操作失败，请重试');
          console.error('[BQQ]', err);
        })
        .then(function () {
          btn.removeAttribute('data-busy');
        });
    }

    fab.addEventListener('click', function () {
      toggle();
    });

    // 挂在 documentElement 上：body 被页面框架整体替换时也不会丢
    document.documentElement.appendChild(host);

    return {
      show: show,
      hide: hide,
      toggle: toggle,
      toast: toast,
      setPayload: setPayload,
      getPayload: function () {
        return payload;
      },
      isOpen: function () {
        return open;
      },
      destroy: function () {
        document.removeEventListener('keydown', onKey, true);
        host.remove();
      }
    };
  }

  root.BQQPanel = { mount: mount, ACTION_DEFS: ACTION_DEFS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
