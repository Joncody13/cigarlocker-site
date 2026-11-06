/*
 * Cigar Locker Retail: photos and videos made ready to send, in the browser.
 * A photo is shrunk to 1,920 pixels on its long side as a JPEG; a video
 * gives a still about every 1.5 seconds, 2 to 12 of them, as the consumer
 * app's video scanning does (src/scan/video-frames.ts).
 */
(function (root) {
  'use strict';

  var LONG_SIDE = 1920;
  var QUALITY = 0.82;
  var MAX_FRAMES = 12;

  function toBase64(canvas) {
    return canvas.toDataURL('image/jpeg', QUALITY).replace(/^data:image\/jpeg;base64,/, '');
  }

  function canvasFor(w, h) {
    var scale = Math.min(1, LONG_SIDE / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    return c;
  }

  /** A photo file as a base64 JPEG, shrunk, turned the way it was taken. */
  async function shrinkPhoto(file) {
    var bitmap = null;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      bitmap = null;
    }
    if (bitmap) {
      var c = canvasFor(bitmap.width, bitmap.height);
      c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
      if (bitmap.close) bitmap.close();
      return toBase64(c);
    }
    var url = URL.createObjectURL(file);
    try {
      var img = await new Promise(function (ok, fail) {
        var i = new Image();
        i.onload = function () {
          ok(i);
        };
        i.onerror = function () {
          fail(new Error('That photo could not be opened.'));
        };
        i.src = url;
      });
      var c2 = canvasFor(img.naturalWidth, img.naturalHeight);
      c2.getContext('2d').drawImage(img, 0, 0, c2.width, c2.height);
      return toBase64(c2);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** When to take each still: every 1.5 s, from 0.3 s in, 2 to 12 of them, spread over a longer video. */
  function frameTimes(seconds) {
    var d = Math.max(0, seconds || 0);
    if (d <= 0.6) return [0];
    var step = Math.max(1.5, d / MAX_FRAMES);
    var out = [];
    for (var t = 0.3; t < d - 0.1 && out.length < MAX_FRAMES; t += step) out.push(Math.round(t * 100) / 100);
    if (out.length < 2 && d > 0.8) out = [0.3, Math.max(0.4, d - 0.3)];
    return out;
  }

  /** A video file's stills, as base64 JPEGs. */
  async function videoFrames(file, onProgress) {
    var url = URL.createObjectURL(file);
    var v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = url;
    try {
      await new Promise(function (ok, fail) {
        v.onloadedmetadata = ok;
        v.onerror = function () {
          fail(new Error('That video could not be opened here. Try photos instead.'));
        };
      });
      var times = frameTimes(v.duration);
      var c = canvasFor(v.videoWidth || 1280, v.videoHeight || 720);
      var g = c.getContext('2d');
      var frames = [];
      for (var i = 0; i < times.length; i++) {
        await new Promise(function (ok) {
          var done = function () {
            v.removeEventListener('seeked', done);
            ok();
          };
          v.addEventListener('seeked', done);
          v.currentTime = times[i];
        });
        g.drawImage(v, 0, 0, c.width, c.height);
        frames.push(toBase64(c));
        if (onProgress) onProgress(i + 1, times.length);
      }
      return frames;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  root.RetailPhotos = { shrinkPhoto: shrinkPhoto, videoFrames: videoFrames, frameTimes: frameTimes, MAX_FRAMES: MAX_FRAMES };
})(self);
