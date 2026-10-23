/*!
 * B站分享到QQ卡片 — background.js（MV3 Service Worker）
 */
'use strict';

importScripts('core.js');

var C = self.BQQCore;

var SHARE_WINDOW = { width: 880, height: 720 };
var MAX_IMAGE_BYTES = 8 * 1024 * 1024;
var ALLOWED_IMAGE_HOSTS = [/(^|\.)hdslb\.com$/i, /(^|\.)bilibili\.com$/i, /(^|\.)bilivideo\.com$/i];

function listMessage(tabId) {
  chrome.tabs.sendMessage(tabId, { type: 'BQQ_TOGGLE_PANEL' }, function () {
    if (chrome.runtime.lastError) {
      // 当前页面没有内容脚本（不是视频页）→ 静默忽略，不要弹错误
    }
  });
}

function activeTab() {
  return new Promise(function (resolve) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      resolve(tabs && tabs[0]);
    });
  });
}

/* ------------------------------ QQ 分享页 ------------------------------ */

function openQqShare(payload) {
  var url = C.buildQqShareUrl(payload);
  var width = SHARE_WINDOW.width;
  var height = SHARE_WINDOW.height;
  var opts = { url: url, type: 'popup', width: width, height: height };

  return new Promise(function (resolve) {
    chrome.windows.getCurrent(function (win) {
      if (win && typeof win.width === 'number' && typeof win.left === 'number') {
        opts.left = Math.max(0, Math.round(win.left + (win.width - width) / 2));
        opts.top = Math.max(0, Math.round(win.top + 60));
      }
      chrome.windows.create(opts, function (created) {
        resolve({ ok: !!created, windowId: created && created.id, shareUrl: url });
      });
    });
  });
}

/* ------------------------------ 封面抓取 ------------------------------ */

function arrayBufferToBase64(buffer) {
  var bytes = new Uint8Array(buffer);
  var chunk = 0x8000;
  var parts = [];
  for (var i = 0; i < bytes.length; i += chunk) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
  }
  return btoa(parts.join(''));
}

function mimeOf(res, url) {
  var ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (ct.indexOf('image/') === 0) return ct;
  if (/\.png($|\?)/i.test(url)) return 'image/png';
  if (/\.webp($|\?)/i.test(url)) return 'image/webp';
  if (/\.gif($|\?)/i.test(url)) return 'image/gif';
  return 'image/jpeg';
}

async function fetchImage(url) {
  var parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return { ok: false, error: '封面地址无效' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: '封面地址协议不支持' };
  }
  if (!ALLOWED_IMAGE_HOSTS.some(function (re) {
    return re.test(parsed.hostname);
  })) {
    return { ok: false, error: '封面域名不在白名单内' };
  }

  try {
    var res = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
    if (!res.ok) return { ok: false, error: '封面请求失败 HTTP ' + res.status };
    var buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE_BYTES) return { ok: false, error: '封面过大' };
    var mime = mimeOf(res, url);
    return { ok: true, dataUrl: 'data:' + mime + ';base64,' + arrayBufferToBase64(buf), bytes: buf.byteLength };
  } catch (e) {
    return { ok: false, error: '封面下载异常：' + (e && e.message ? e.message : e) };
  }
}

/* ------------------------------ 下载兜底 ------------------------------ */

function downloadDataUrl(dataUrl, filename) {
  return new Promise(function (resolve) {
    chrome.downloads.download({ url: dataUrl, filename: filename, saveAs: false }, function (id) {
      if (chrome.runtime.lastError || id == null) {
        resolve({ ok: false, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : '下载失败' });
      } else {
        resolve({ ok: true, downloadId: id });
      }
    });
  });
}

/* ------------------------------ 消息路由 ------------------------------ */

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;

  if (msg.type === 'BQQ_OPEN_QQ') {
    if (!msg.payload || !msg.payload.url) {
      sendResponse({ ok: false, error: '缺少分享信息' });
      return;
    }
    openQqShare(msg.payload).then(sendResponse, function (e) {
      sendResponse({ ok: false, error: (e && e.message) || '打开失败' });
    });
    return true; // 异步响应
  }

  if (msg.type === 'BQQ_FETCH_IMAGE') {
    fetchImage(msg.url).then(sendResponse, function (e) {
      sendResponse({ ok: false, error: (e && e.message) || '封面抓取失败' });
    });
    return true;
  }

  if (msg.type === 'BQQ_DOWNLOAD') {
    downloadDataUrl(msg.dataUrl, msg.filename || 'bilibili-card.png').then(sendResponse);
    return true;
  }
});

/* ------------------------------ 入口 ------------------------------ */

// 点扩展图标 → 当前标签页唤起分享面板
chrome.action.onClicked.addListener(function (tab) {
  if (tab && tab.id != null) listMessage(tab.id);
});

// 快捷键 Alt+Shift+B
chrome.commands.onCommand.addListener(async function (command) {
  if (command !== 'open-share-panel') return;
  var tab = await activeTab();
  if (tab && tab.id != null) listMessage(tab.id);
});
