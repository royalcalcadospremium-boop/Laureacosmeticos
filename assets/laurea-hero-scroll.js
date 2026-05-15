/* ============================================================
   Laurea — Hero Scroll (Body Splash)
   Scroll-driven canvas image sequence
   ============================================================ */
(function () {
  'use strict';

  var instances = new WeakMap();

  function init(section) {
    if (instances.has(section)) return;
    var data = section.dataset.frames;
    if (!data) return;

    var frameUrls;
    try { frameUrls = JSON.parse(data); }
    catch (e) { return; }

    if (!Array.isArray(frameUrls) || frameUrls.length === 0) return;

    var hero = new HeroScroll(section, frameUrls);
    instances.set(section, hero);
  }

  function destroy(section) {
    var hero = instances.get(section);
    if (hero) {
      hero.destroy();
      instances.delete(section);
    }
  }

  function HeroScroll(root, frameUrls) {
    this.root        = root;
    this.frameUrls   = frameUrls;
    this.totalFrames = frameUrls.length;
    this.canvas      = root.querySelector('[data-hero-canvas]');
    this.ctx         = this.canvas.getContext('2d', { alpha: true });
    this.sticky      = root.querySelector('[data-hero-sticky]');
    this.track       = root.querySelector('[data-hero-track]');
    this.cta         = root.querySelector('[data-hero-cta]');
    this.cue         = root.querySelector('[data-hero-cue]');
    this.eyebrow     = root.querySelector('[data-hero-eyebrow]');
    this.progress    = root.querySelector('[data-hero-progress] > span');
    this.counter     = root.querySelector('[data-hero-counter]');
    this.lcp         = root.querySelector('[data-hero-lcp]');

    this.images        = new Array(this.totalFrames);
    this.loadedCount   = 0;
    this.firstReady    = false;
    this.displayFrame  = 0;
    this.targetFrame   = 0;
    this.lastProgress  = 0;
    this.lastDrawnIdx  = -1;
    this.rAFId         = null;
    this.isVisible     = true;
    this.dpr           = Math.min(window.devicePixelRatio || 1, 2);
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.onScroll  = this.onScroll.bind(this);
    this.onResize  = this.onResize.bind(this);
    this.tick      = this.tick.bind(this);
    this.onVisible = this.onVisible.bind(this);

    this.io = new IntersectionObserver(this.onVisible, { rootMargin: '300px 0px' });
    this.io.observe(this.root);

    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onResize, { passive: true });
    window.addEventListener('orientationchange', this.onResize, { passive: true });

    this.resize();
    this.preload();
    this.onScroll();
  }

  HeroScroll.prototype.preload = function () {
    var self = this;

    function loadOne(i) {
      return new Promise(function (resolve) {
        if (self.images[i]) { resolve(); return; }
        var img = new Image();
        img.decoding = 'async';
        img.onload = function () {
          self.loadedCount++;
          if (i === 0 && !self.firstReady) {
            self.firstReady = true;
            self.root.setAttribute('data-ready', 'true');
            self.schedule();
          }
          resolve();
        };
        img.onerror = function () { resolve(); };
        img.src = self.frameUrls[i];
        self.images[i] = img;
      });
    }

    loadOne(0).then(function () {
      var priority = [];
      for (var i = 1; i < Math.min(10, self.totalFrames); i++) {
        priority.push(loadOne(i));
      }
      return Promise.all(priority);
    }).then(function () {
      var pending = [];
      for (var i = 10; i < self.totalFrames; i++) pending.push(i);

      function batch() {
        if (!pending.length) return;
        var chunk = pending.splice(0, 6);
        Promise.all(chunk.map(loadOne)).then(function () {
          if ('requestIdleCallback' in window) {
            requestIdleCallback(batch, { timeout: 400 });
          } else {
            setTimeout(batch, 60);
          }
        });
      }
      batch();
    });
  };

  HeroScroll.prototype.resize = function () {
    var rect = this.sticky.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width  = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width  = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cssWidth  = w;
    this.cssHeight = h;
    this.lastDrawnIdx = -1; // force redraw
    this.schedule();
  };

  HeroScroll.prototype.drawFrame = function (idx) {
    var img = this.images[idx];
    if (!img || !img.complete || img.naturalWidth === 0) {
      // Walk back to find any loaded neighbour
      for (var d = 1; d <= this.totalFrames; d++) {
        var lo = idx - d, hi = idx + d;
        if (lo >= 0 && this.images[lo] && this.images[lo].complete && this.images[lo].naturalWidth) {
          img = this.images[lo]; break;
        }
        if (hi < this.totalFrames && this.images[hi] && this.images[hi].complete && this.images[hi].naturalWidth) {
          img = this.images[hi]; break;
        }
      }
      if (!img) return;
    }

    var w = this.cssWidth, h = this.cssHeight;
    var imgA = img.naturalWidth / img.naturalHeight;
    var viewA = w / h;

    var drawW, drawH;
    if (viewA > imgA) {
      // wider than image: contain by height, center horizontally
      drawH = h;
      drawW = h * imgA;
    } else {
      // taller or equal: cover (fill width, possibly crop top/bottom)
      drawW = w;
      drawH = w / imgA;
      if (drawH < h) {
        drawH = h;
        drawW = h * imgA;
      }
    }
    var dx = (w - drawW) / 2;
    var dy = (h - drawH) / 2;

    this.ctx.clearRect(0, 0, w, h);
    this.ctx.drawImage(img, dx, dy, drawW, drawH);
    this.lastDrawnIdx = idx;
  };

  HeroScroll.prototype.computeProgress = function () {
    var rect = this.track.getBoundingClientRect();
    var stickyH = this.sticky.offsetHeight;
    var scrollable = rect.height - stickyH;
    if (scrollable <= 0) return 0;
    var p = (-rect.top) / scrollable;
    if (p < 0) p = 0;
    else if (p > 1) p = 1;
    return p;
  };

  HeroScroll.prototype.tick = function () {
    this.rAFId = null;

    var ease = this.reducedMotion ? 1 : 0.22;
    var delta = this.targetFrame - this.displayFrame;
    this.displayFrame += delta * ease;
    if (Math.abs(this.targetFrame - this.displayFrame) < 0.01) {
      this.displayFrame = this.targetFrame;
    }

    var idx = Math.round(this.displayFrame);
    if (idx < 0) idx = 0;
    if (idx > this.totalFrames - 1) idx = this.totalFrames - 1;

    if (idx !== this.lastDrawnIdx) this.drawFrame(idx);

    var p = this.lastProgress;

    if (this.progress) {
      this.progress.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    }
    if (this.cue) {
      var cueOp = 1 - Math.min(1, p * 14);
      this.cue.style.opacity = cueOp.toFixed(3);
    }
    if (this.eyebrow) {
      var eyeOp = 1 - Math.min(1, Math.max(0, p - 0.04) * 5);
      this.eyebrow.style.opacity = eyeOp.toFixed(3);
    }
    if (this.cta) {
      var ctaShow = (p - 0.82) / 0.12;
      if (ctaShow < 0) ctaShow = 0;
      else if (ctaShow > 1) ctaShow = 1;
      this.cta.style.opacity = ctaShow.toFixed(3);
      this.cta.style.transform = 'translateY(' + ((1 - ctaShow) * 14).toFixed(2) + 'px)';
      this.cta.style.pointerEvents = ctaShow > 0.55 ? 'auto' : 'none';
    }
    if (this.counter) {
      var pad = String(idx + 1);
      while (pad.length < 2) pad = '0' + pad;
      this.counter.textContent = pad + ' / ' + this.totalFrames;
    }

    if (Math.abs(this.targetFrame - this.displayFrame) > 0.005 && this.isVisible) {
      this.schedule();
    }
  };

  HeroScroll.prototype.schedule = function () {
    if (this.rAFId == null) this.rAFId = requestAnimationFrame(this.tick);
  };

  HeroScroll.prototype.onScroll = function () {
    this.lastProgress = this.computeProgress();
    this.targetFrame = this.lastProgress * (this.totalFrames - 1);
    if (this.isVisible) this.schedule();
  };

  HeroScroll.prototype.onResize = function () {
    if (this._resizeRAF) return;
    var self = this;
    this._resizeRAF = requestAnimationFrame(function () {
      self._resizeRAF = null;
      self.resize();
      self.onScroll();
    });
  };

  HeroScroll.prototype.onVisible = function (entries) {
    for (var i = 0; i < entries.length; i++) {
      this.isVisible = entries[i].isIntersecting;
      if (this.isVisible) {
        this.resize();
        this.onScroll();
      }
    }
  };

  HeroScroll.prototype.destroy = function () {
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    if (this.io) this.io.disconnect();
    if (this.rAFId != null) cancelAnimationFrame(this.rAFId);
    this.images.length = 0;
  };

  /* Boot ------------------------------------------------------------------ */
  function boot() {
    document.querySelectorAll('[data-laurea-hero-scroll]').forEach(init);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* Shopify section lifecycle -------------------------------------------- */
  document.addEventListener('shopify:section:load', function (e) {
    var section = e.target.querySelector('[data-laurea-hero-scroll]');
    if (section) init(section);
  });
  document.addEventListener('shopify:section:unload', function (e) {
    var section = e.target.querySelector('[data-laurea-hero-scroll]');
    if (section) destroy(section);
  });
})();
