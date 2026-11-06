/*
 * Cigar Locker Retail: the camera scanner (docs/retail.md, "Boxes").
 *
 * Full screen over the app. Reads QR codes and barcodes from the iPhone's or
 * iPad's camera continuously, through the barcode reader bundled with the app
 * (vendor/barcode-detector.js and its zxing_reader.wasm, loaded the first time
 * the scanner opens; nothing comes from another site). Each code read goes to
 * the screen's handler; while the handler works the reading waits, and a code
 * still in front of the camera is never taken twice (RetailCodes.guard). A beep
 * and a flash say how it went: iPhones give web pages no vibration, so the
 * sound and colour carry it. Without a camera (refused, or none) the person
 * types the code or reads it from a photo.
 *
 *   RetailScanner.open({ title, hint, onCode(code, format, ctl), onClose })
 *
 * onCode may answer { tone: 'good'|'warn'|'bad', words } to flash and carry
 * on, or show a panel (ctl.panel(el)) and call ctl.resume() when done.
 */
(function (root) {
  'use strict';
  var Codes = root.RetailCodes;
  var loading = null;
  var audio = null;

  function load() {
    if (root.BarcodeDetectionAPI) return Promise.resolve(root.BarcodeDetectionAPI);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'vendor/barcode-detector.js';
      s.onload = function () {
        var api = root.BarcodeDetectionAPI;
        if (!api) return reject(new Error('The code reader did not load.'));
        var wasm = new URL('vendor/zxing_reader.wasm', document.baseURI).href;
        api.setZXingModuleOverrides({
          locateFile: function (path, prefix) {
            return /\.wasm$/.test(path) ? wasm : prefix + path;
          },
        });
        resolve(api);
      };
      s.onerror = function () {
        loading = null;
        reject(new Error('The code reader did not load. Check the connection and try again.'));
      };
      document.head.appendChild(s);
    });
    return loading;
  }

  /** Sound on or off, kept on this device (vibration where the device has it either way). */
  function soundOn() {
    try {
      return root.localStorage.getItem('cl-retail-sound') !== 'off';
    } catch (e) {
      return true;
    }
  }

  /** A short tone: good one high beep, warn two, bad one low. */
  function tone(kind) {
    if (soundOn()) {
      try {
        if (!audio) audio = new (root.AudioContext || root.webkitAudioContext)();
        if (audio.state === 'suspended') audio.resume();
        var t = audio.currentTime;
        var beeps = kind === 'good' ? [[1760, 0, 0.09]] : kind === 'warn' ? [[880, 0, 0.08], [880, 0.13, 0.08]] : [[220, 0, 0.28]];
        beeps.forEach(function (b) {
          var o = audio.createOscillator();
          var g = audio.createGain();
          o.type = kind === 'bad' ? 'square' : 'sine';
          o.frequency.value = b[0];
          g.gain.setValueAtTime(0.0001, t + b[1]);
          g.gain.exponentialRampToValueAtTime(0.25, t + b[1] + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, t + b[1] + b[2]);
          o.connect(g).connect(audio.destination);
          o.start(t + b[1]);
          o.stop(t + b[1] + b[2] + 0.02);
        });
      } catch (e) {
        /* no sound: the flash still says it */
      }
    }
    if (navigator.vibrate) {
      try {
        navigator.vibrate(kind === 'good' ? 40 : kind === 'warn' ? [30, 60, 30] : 200);
      } catch (e) {
        /* fine */
      }
    }
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function open(opts) {
    var o = opts || {};
    var guard = Codes.guard(o.gapMs || 900);
    var paused = false;
    var closed = false;
    var stream = null;
    var track = null;
    var detector = null;
    var timer = null;
    var flashTimer = null;
    var torchOn = false;
    var typedWaiting = null;

    var veil = el('div', 'scan-veil');
    veil.setAttribute('role', 'dialog');
    veil.setAttribute('aria-modal', 'true');
    veil.setAttribute('aria-label', o.title || 'Scan');
    var video = el('video', 'scan-video');
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');
    video.muted = true;
    var frame = el('div', 'scan-frame');
    var flash = el('div', 'scan-flash');
    var top = el('div', 'scan-top');
    var title = el('div', 'scan-title', o.title || 'Scan');
    var torch = el('button', 'scan-btn', 'Light');
    torch.type = 'button';
    torch.hidden = true;
    var done = el('button', 'scan-btn strong', 'Done');
    done.type = 'button';
    var sound = el('button', 'scan-btn', soundOn() ? 'Sound on' : 'Sound off');
    sound.type = 'button';
    sound.addEventListener('click', function () {
      try { root.localStorage.setItem('cl-retail-sound', soundOn() ? 'off' : 'on'); } catch (e) { /* page only */ }
      sound.textContent = soundOn() ? 'Sound on' : 'Sound off';
    });
    top.append(title, sound, torch, done);
    var bottom = el('div', 'scan-bottom');
    var status = el('div', 'scan-status', o.hint || 'Point the camera at a code.');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    var tally = el('div', 'scan-tally');
    var panel = el('div', 'scan-panel');
    panel.hidden = true;
    var manual = el('form', 'scan-manual');
    var typed = el('input', 'scan-input');
    typed.placeholder = 'Or type the code';
    typed.autocapitalize = 'characters';
    typed.setAttribute('autocomplete', 'off');
    typed.setAttribute('enterkeyhint', 'go');
    var go = el('button', 'scan-btn', 'Go');
    go.type = 'submit';
    var photo = el('input');
    photo.type = 'file';
    photo.accept = 'image/*';
    photo.setAttribute('capture', 'environment');
    photo.hidden = true;
    var photoBtn = el('button', 'scan-btn', 'Read a photo');
    photoBtn.type = 'button';
    photoBtn.hidden = true;
    manual.append(typed, go, photoBtn, photo);
    bottom.append(status, tally, panel, manual);
    veil.append(video, frame, flash, top, bottom);
    document.body.appendChild(veil);
    document.documentElement.classList.add('scanning');

    var ctl = {
      flash: function (kind, words) {
        tone(kind);
        flash.className = 'scan-flash on ' + (kind || 'good');
        status.className = 'scan-status ' + (kind || '');
        status.textContent = words || '';
        clearTimeout(flashTimer);
        flashTimer = setTimeout(function () {
          flash.className = 'scan-flash';
        }, 380);
      },
      say: function (words) {
        status.className = 'scan-status';
        status.textContent = words || '';
      },
      tally: function (words) {
        tally.textContent = words || '';
      },
      panel: function (node) {
        panel.replaceChildren();
        if (node) {
          panel.appendChild(node);
          panel.hidden = false;
          paused = true;
          frame.classList.add('held');
        } else {
          panel.hidden = true;
        }
      },
      resume: function () {
        panel.hidden = true;
        panel.replaceChildren();
        frame.classList.remove('held');
        paused = false;
        // A code typed while the last one was being handled goes next.
        if (typedWaiting) {
          var v = typedWaiting;
          typedWaiting = null;
          handle(Codes.ownCode(v) || v, '');
        }
      },
      forget: function (code) {
        guard.forget(code);
      },
      close: close,
    };

    async function handle(code, format) {
      paused = true;
      frame.classList.add('held');
      var res;
      try {
        res = await o.onCode(code, format, ctl);
      } catch (e) {
        res = { tone: 'bad', words: (e && e.message) || 'That did not go through.' };
      }
      if (closed) return;
      if (res && res.words !== undefined) ctl.flash(res.tone || 'good', res.words);
      if (panel.hidden) {
        setTimeout(function () {
          if (panel.hidden) ctl.resume();
        }, res && res.tone === 'bad' ? 900 : 250);
      }
    }

    async function tick() {
      timer = null;
      if (closed) return;
      if (detector && video.readyState >= 2) {
        try {
          var found = await detector.detect(video);
          var now = Date.now();
          var taken = false;
          // Reading goes on while a code is being handled, only to keep every
          // code in view "held": a box still in front of the camera when the
          // panel closes is never taken a second time.
          for (var i = 0; i < found.length; i++) {
            var raw = String(found[i].rawValue || '').trim();
            if (!raw) continue;
            var seen = guard.check(raw, now);
            if (paused || taken || seen === 'held') continue;
            taken = true;
            guard.take(raw, now);
            handle(Codes.ownCode(raw) || raw, found[i].format);
          }
        } catch (e) {
          /* a frame that could not be read */
        }
      }
      if (!closed) timer = setTimeout(tick, 110);
    }

    async function start() {
      try {
        var api = await load();
        detector = new api.BarcodeDetector({ formats: Codes.FORMATS });
      } catch (e) {
        ctl.say(e.message || 'The code reader did not load.');
        photoBtn.hidden = true;
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        noCamera('This browser gives no camera to web pages. Type the code, or read it from a photo.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
        if (closed) return stop();
        video.srcObject = stream;
        await video.play().catch(function () {});
        track = stream.getVideoTracks()[0];
        var caps = track && track.getCapabilities ? track.getCapabilities() : {};
        if (caps && caps.torch) torch.hidden = false;
        tick();
      } catch (e) {
        noCamera(e && e.name === 'NotAllowedError'
          ? 'The camera is not allowed for this page. Allow it in the browser\'s settings, or type the code, or read it from a photo.'
          : 'No camera could be opened. Type the code, or read it from a photo.');
      }
    }

    function noCamera(words) {
      veil.classList.add('no-camera');
      photoBtn.hidden = false;
      ctl.say(words);
    }

    function stop() {
      if (timer) clearTimeout(timer);
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }

    function close() {
      if (closed) return;
      closed = true;
      stop();
      veil.remove();
      document.documentElement.classList.remove('scanning');
      document.removeEventListener('keydown', onKey);
      if (o.onClose) o.onClose();
    }

    function onKey(ev) {
      if (ev.key === 'Escape') close();
    }

    done.addEventListener('click', close);
    torch.addEventListener('click', function () {
      if (!track) return;
      torchOn = !torchOn;
      track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(function () {});
      torch.classList.toggle('on', torchOn);
    });
    manual.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var v = typed.value.trim();
      if (!v) return;
      v = Codes.ownCode(v) || v;
      typed.value = '';
      if (paused) {
        typedWaiting = v;
        ctl.say('Next: ' + v);
        return;
      }
      handle(Codes.ownCode(v) || v, '');
    });
    photoBtn.addEventListener('click', function () {
      photo.click();
    });
    photo.addEventListener('change', async function () {
      var f = photo.files && photo.files[0];
      photo.value = '';
      if (!f || !detector) return;
      ctl.say('Reading the photo…');
      try {
        var found = await detector.detect(f);
        if (!found.length) return ctl.flash('bad', 'No code found in that photo. Hold it closer and steady.');
        handle(Codes.ownCode(found[0].rawValue) || found[0].rawValue, found[0].format);
      } catch (e) {
        ctl.flash('bad', 'That photo could not be read.');
      }
    });
    document.addEventListener('keydown', onKey);
    // A sound on the first tap only works if the audio starts in a tap: this one.
    try {
      if (!audio) audio = new (root.AudioContext || root.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
    } catch (e) {
      /* fine */
    }
    start();
    return ctl;
  }

  root.RetailScanner = { open: open, load: load, tone: tone };
})(self);
