/*!
 * B站分享到QQ卡片 — card.js
 *
 * Canvas 渲染层：把 BQQCore.layoutCard() 输出的绘制指令画到 canvas 上，
 * 并导出 PNG。依赖 core.js（window.BQQCore）。
 */
(function (root) {
  'use strict';

  var C = root.BQQCore;
  if (!C) throw new Error('[BQQ] core.js 必须先加载');

  /* ---------------- 基础绘制 ---------------- */

  function roundRectPath(ctx, x, y, w, h, r) {
    var rr = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  var measureCtx = null;
  function measureText(text, font) {
    if (typeof document === 'undefined') return C.fallbackMeasure(text, font);
    if (!measureCtx) {
      var cv = document.createElement('canvas');
      cv.width = cv.height = 8;
      measureCtx = cv.getContext('2d');
    }
    measureCtx.font = font;
    return measureCtx.measureText(String(text)).width;
  }

  /** 载入图片（data: / blob: / 同源 URL）。跨域图片会污染 canvas，调用方应传 data URL。 */
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error('[BQQ] 图片加载失败: ' + String(src).slice(0, 80)));
      };
      img.src = src;
    });
  }

  /** object-fit: cover + 圆角裁剪 */
  function drawCover(ctx, img, x, y, w, h, r) {
    ctx.save();
    roundRectPath(ctx, x, y, w, h, r);
    ctx.clip();
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    if (!iw || !ih) {
      ctx.restore();
      return;
    }
    var s = Math.max(w / iw, h / ih);
    var dw = iw * s;
    var dh = ih * s;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  }

  function paintGradient(ctx, x, y, w, h, colors) {
    var g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, colors[0]);
    g.addColorStop(1, colors[1]);
    return g;
  }

  function drawOps(ctx, layout, images) {
    var ops = layout.ops || [];
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op.type === 'roundRect') {
        roundRectPath(ctx, op.x, op.y, op.w, op.h, op.r);
        if (op.gradient) {
          ctx.fillStyle = paintGradient(ctx, op.x, op.y, op.w, op.h, op.gradient);
        } else if (op.fill) {
          ctx.fillStyle = op.fill;
        }
        if (op.fill || op.gradient) ctx.fill();
        if (op.stroke) {
          ctx.strokeStyle = op.stroke;
          ctx.lineWidth = op.lineWidth || 1;
          ctx.stroke();
        }
      } else if (op.type === 'image') {
        var img = images && images[op.src];
        if (img) {
          drawCover(ctx, img, op.x, op.y, op.w, op.h, op.r || 0);
        }
      } else if (op.type === 'badge') {
        roundRectPath(ctx, op.x, op.y, op.w, op.h, op.r || 0);
        ctx.fillStyle = op.bg || 'rgba(0,0,0,0.6)';
        ctx.fill();
        ctx.font = op.font;
        ctx.fillStyle = op.color || '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(op.text, op.x + op.w / 2, op.y + op.h / 2 + 0.5);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
      } else if (op.type === 'text') {
        ctx.font = op.font;
        ctx.fillStyle = op.color || '#18191C';
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(op.text, op.x, op.y);
      } else if (op.type === 'line') {
        ctx.beginPath();
        ctx.strokeStyle = op.color || '#eee';
        ctx.lineWidth = op.lineWidth || 1;
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(op.x2, op.y2);
        ctx.stroke();
      }
    }
  }

  /**
   * 渲染分享卡片。
   * @param {object} payload BQQCore.buildPayload() 的结果
   * @param {{scale?:number, coverDataUrl?:string}} [opts]
   * @returns {Promise<{canvas:HTMLCanvasElement, blob:Blob, dataUrl:string}>}
   */
  async function renderCard(payload, opts) {
    var o = opts || {};
    var scale = o.scale || 2;
    var layout = C.layoutCard(payload, {
      measure: measureText,
      hasCover: !!o.coverDataUrl
    });

    var canvas = document.createElement('canvas');
    canvas.width = Math.round(layout.width * scale);
    canvas.height = Math.round(layout.height * scale);
    var ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    var images = {};
    if (o.coverDataUrl) {
      try {
        images[payload.cover] = await loadImage(o.coverDataUrl);
      } catch (e) {
        // 封面加载失败就退回占位渐变，不影响整体分享
      }
    }

    // 画布底色（圆角外区域透明，方便作为 PNG 直接用）
    ctx.clearRect(0, 0, layout.width, layout.height);
    drawOps(ctx, layout, images);

    var blob = await new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) {
        if (b) resolve(b);
        else reject(new Error('[BQQ] 导出 PNG 失败'));
      }, 'image/png');
    });

    return { canvas: canvas, blob: blob, dataUrl: canvas.toDataURL('image/png') };
  }

  /** 只要 PNG 的 data URL（下载 / 剪贴板用） */
  async function renderCardDataUrl(payload, opts) {
    var r = await renderCard(payload, opts);
    return r.dataUrl;
  }

  root.BQQCard = {
    roundRectPath: roundRectPath,
    measureText: measureText,
    loadImage: loadImage,
    drawCover: drawCover,
    renderCard: renderCard,
    renderCardDataUrl: renderCardDataUrl
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
