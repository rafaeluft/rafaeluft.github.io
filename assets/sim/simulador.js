(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  // ---------- Endereços ----------
  function fmtEnd(n) {
    if (n === null || n === undefined) return 'NULL';
    if (typeof n === 'string') return n;
    return '0x' + n.toString(16).toUpperCase().padStart(3, '0');
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- Palco de memória ----------
  function Palco(container, opcoes) {
    var self = this;
    this.els = {};
    this.posManual = {};
    this.modelo = null;
    this.zoomAtual = 1;
    this.arrastando = null;
    this.setasNav = [];
    this._raf = null;
    this._rafSetas = null;
    this.onZoom = opcoes && typeof opcoes.onZoom === 'function' ? opcoes.onZoom : null;

    this.viewport = document.createElement('div');
    this.viewport.className = 'sim-viewport';
    this.molde = document.createElement('div');
    this.molde.className = 'sim-molde';
    this.camada = document.createElement('div');
    this.camada.className = 'sim-camada';
    this.camada.style.transformOrigin = '0 0';
    this.camada.style.transform = 'scale(1)';

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'sim-setas');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.camada.appendChild(this.svg);
    this.molde.appendChild(this.camada);
    this.viewport.appendChild(this.molde);
    container.appendChild(this.viewport);

    this.viewport.addEventListener('wheel', function (ev) {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      if (ev.deltaY < 0) self.zoomIn();
      else self.zoomOut();
    }, { passive: false });

    var redim = null;
    window.addEventListener('resize', function () {
      cancelAnimationFrame(redim);
      redim = requestAnimationFrame(function () { self.atualizar(); });
    });
  }

  // ---------- Zoom ----------
  Palco.prototype.getZoom = function () { return this.zoomAtual; };

  Palco.prototype.setZoom = function (z) {
    this.zoomAtual = Math.min(3, Math.max(0.4, z));
    this.camada.style.transform = 'scale(' + this.zoomAtual + ')';
    this.atualizar();
    if (this.onZoom) this.onZoom(this.zoomAtual);
  };

  Palco.prototype.zoomIn = function () { this.setZoom(Math.round((this.zoomAtual + 0.1) * 10) / 10); };
  Palco.prototype.zoomOut = function () { this.setZoom(Math.round((this.zoomAtual - 0.1) * 10) / 10); };

  Palco.prototype.reorganizar = function () {
    this.posManual = {};
    this.atualizar();
  };

  // ---------- Layout ----------
  Palco.prototype._alturaNo = function () {
    var no = document.createElement('div');
    no.className = 'sim-no';
    no.style.position = 'absolute';
    no.style.left = '-9999px';
    no.style.top = '0';
    no.innerHTML =
      '<div class="sim-rotulos"><span class="sim-rotulo">X</span></div>' +
      '<div class="sim-end">0x000</div>' +
      '<div class="sim-caixa"><div class="sim-campo"><span class="sim-nome">X</span>' +
      '<span class="sim-valor">X</span></div></div>';
    this.camada.appendChild(no);
    var h = no.offsetHeight;
    no.remove();
    return h;
  };

  Palco.prototype._montarPosicoes = function () {
    var modelo = this.modelo;
    var vh = this.viewport.clientHeight / this.zoomAtual;
    var H = this._alturaNo() || 60;
    var V = 56;

    var ordem = (modelo.ordem || []).slice();
    var extras = (modelo.extras || []).slice();
    var semOrdem = [];
    (modelo.nos || []).forEach(function (n) {
      if (ordem.indexOf(n.id) === -1 && extras.indexOf(n.id) === -1) semOrdem.push(n.id);
    });
    var fila = ordem.concat(semOrdem);

    var pos = {};
    var col = 0;
    var y = 0;
    fila.forEach(function (id) {
      if (y > 0 && y + H > vh) { col += 1; y = 0; }
      pos[id] = { col: col, y: y };
      y += H + V;
    });
    var nCol = col + 1;

    var larguraCol = 90;
    var els = this.els;
    (modelo.nos || []).forEach(function (n) {
      var el = els['sim-no-' + n.id];
      if (el && el.offsetWidth > larguraCol) larguraCol = el.offsetWidth;
    });

    var xCol = 0;
    for (var c = 0; c < nCol; c++) {
      var xC = xCol;
      fila.forEach(function (id) {
        if (pos[id].col === c) pos[id].x = xC;
      });
      xCol += larguraCol + 90;
    }

    var ye = 0;
    var xe = xCol;
    extras.forEach(function (id) {
      pos[id] = { col: -1, x: xe, y: ye };
      xe += larguraCol + 190;
      ye += 40;
    });

    return pos;
  };

  // ---------- Renderização ----------
  Palco.prototype.render = function (modelo) {
    this.modelo = modelo;
    var camada = this.camada;
    var vistos = {};
    (modelo.nos || []).forEach(function (n) { vistos[n.id] = n; });

    var self = this;
    Object.keys(this.els).forEach(function (id) {
      var nid = id.slice(7);
      if (!vistos[nid]) {
        self.els[id].remove();
        delete self.els[id];
      }
    });

    (modelo.nos || []).forEach(function (n) {
      var id = 'sim-no-' + n.id;
      var el = self.els[id];
      if (!el) {
        el = document.createElement('div');
        self.els[id] = el;
        camada.appendChild(el);
        el.addEventListener('pointerdown', function (ev) { self._inicioArrastar(ev, el); });
      }
      el.className = 'sim-no' + (n.classes && n.classes.length ? ' ' + n.classes.join(' ') : '');
      el.setAttribute('data-sim-no', n.id);
      el.innerHTML = self._htmlNo(n);
    });

    this.setasNav = [];
    var porId = vistos;
    (modelo.nos || []).forEach(function (n) {
      (n.campos || []).forEach(function (c) {
        if (typeof c.ptr === 'string' && porId[c.ptr]) {
          self.setasNav.push({ de: n, campo: c, para: porId[c.ptr] });
        }
      });
    });

    this.atualizar();
  };

  Palco.prototype._htmlNo = function (n) {
    var h = '';
    if (n.rotulos && n.rotulos.length) {
      h += '<div class="sim-rotulos">';
      n.rotulos.forEach(function (r) { h += '<span class="sim-rotulo">' + esc(r) + '</span>'; });
      h += '</div>';
    }
    h += '<div class="sim-end">';
    if (n.titulo) h += '<b>' + esc(n.titulo) + '</b> · ';
    h += fmtEnd(n.endereco) + '</div>';

    h += '<div class="sim-caixa">';
    (n.campos || []).forEach(function (c) {
      h += '<div class="sim-campo' + (c.destaque ? ' destaque' : '') + '">' +
           '<span class="sim-nome">' + esc(c.nome) + '</span>';
      if (c.ptr !== undefined) {
        var nulo = (c.ptr === null);
        var alvo = typeof c.ptr === 'string' ? ' data-sim-alvo="' + esc(c.ptr) + '"' : '';
        h += '<span class="sim-valor' + (nulo ? ' sim-para' : '') + '"' + alvo + '>' +
             (nulo ? 'NULL' : (typeof c.ptr === 'string' ? esc(c.ptr) : 'NULL')) + '</span>';
      } else {
        h += '<span class="sim-valor' + (c.valor === undefined ? ' sim-lixo' : '') + '">' +
             (c.valor === undefined ? '?' : esc(c.valor)) + '</span>';
      }
      h += '</div>';
    });
    h += '</div>';
    return h;
  };

  // ---------- Posicionamento e tamanho ----------
  Palco.prototype.relayout = function () {
    var pos = this._montarPosicoes();
    var u = this.posManual;
    var w = 0;
    var h = 0;
    var self = this;
    (this.modelo.nos || []).forEach(function (n) {
      var el = self.els['sim-no-' + n.id];
      if (!el) return;
      var p = pos[n.id];
      var alvo = u[n.id] || { x: p.x, y: p.y };
      el.style.left = Math.max(0, alvo.x) + 'px';
      el.style.top = Math.max(0, alvo.y) + 'px';
      var cw = el.offsetLeft + el.offsetWidth;
      var ch = el.offsetTop + el.offsetHeight;
      if (cw > w) w = cw;
      if (ch > h) h = ch;
    });
    this.molde.style.width = ((w || 1) + 40) * this.zoomAtual + 'px';
    this.molde.style.height = ((h || 1) + 30) * this.zoomAtual + 'px';
  };

  // ---------- Setas (ponteiros) ----------
  Palco.prototype.desenharSetas = function () {
    var svg = this.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var defs = document.createElementNS(SVG_NS, 'defs');
    var marker = document.createElementNS(SVG_NS, 'marker');
    marker.setAttribute('id', 'sim-marcador');
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '8.5');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '7');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('orient', 'auto');
    var mp = document.createElementNS(SVG_NS, 'path');
    mp.setAttribute('d', 'M0,0 L10,5 L0,10 z');
    mp.setAttribute('style', 'fill:var(--cinza)');
    marker.appendChild(mp);
    defs.appendChild(marker);
    svg.appendChild(defs);

    var c = this.camada.getBoundingClientRect();
    var self = this;
    var z = this.zoomAtual;
    var w = 0;
    var h = 0;

    this.setasNav.forEach(function (s) {
      var srcEl = self.els['sim-no-' + s.de.id];
      var dstEl = self.els['sim-no-' + s.para.id];
      if (!srcEl || !dstEl) return;
      var cell = srcEl.querySelector('.sim-valor[data-sim-alvo]');
      if (!cell) return;

      var cr = cell.getBoundingClientRect();
      var dr = dstEl.getBoundingClientRect();
      var sx = (cr.right - c.left) / z;
      var sy = (cr.top - c.top) / z + (cr.height / z) / 2;
      var dx = (dr.left - c.left) / z;
      var dy = (dr.top - c.top) / z;
      var ex, ey, c1x, c1y, c2x, c2y;

      if (dx - sx > 6) {
        ex = dx;
        ey = dy + (dr.height / z) / 2;
        c1x = (sx + ex) / 2; c1y = sy;
        c2x = (sx + ex) / 2; c2y = ey;
      } else {
        ex = dx + (dr.width / z) / 2;
        ey = dy;
        c1x = sx + 50; c1y = sy;
        c2x = ex; c2y = dy - 60;
      }

      var p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', 'M' + sx + ' ' + sy + ' C' + c1x + ' ' + c1y + ' ' + c2x + ' ' + c2y + ' ' + ex + ' ' + ey);
      p.setAttribute('class', 'sim-seta');
      p.setAttribute('marker-end', 'url(#sim-marcador)');
      svg.appendChild(p);

      if (ex > w) w = ex;
      if (ey > h) h = ey;
    });

    svg.setAttribute('width', String(w + 40));
    svg.setAttribute('height', String(h + 40));
    svg.setAttribute('viewBox', '0 0 ' + (w + 40) + ' ' + (h + 40));
  };

  Palco.prototype.atualizar = function () {
    var self = this;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(function () {
      self.relayout();
      self.desenharSetas();
    });
  };

  // ---------- Arrastar nós ----------
  Palco.prototype._inicioArrastar = function (ev, el) {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    var id = el.getAttribute('data-sim-no');
    var c = this.camada.getBoundingClientRect();
    var z = this.zoomAtual;

    this.arrastando = {
      id: id,
      el: el,
      dx: (ev.clientX - c.left) / z - el.offsetLeft,
      dy: (ev.clientY - c.top) / z - el.offsetTop
    };
    el.classList.add('arrastando');
    try { el.setPointerCapture(ev.pointerId); } catch (e) {}

    var self = this;
    var mover = function (e) {
      if (!self.arrastando) return;
      var c2 = self.camada.getBoundingClientRect();
      var z2 = self.zoomAtual;
      var x = Math.max(0, (e.clientX - c2.left) / z2 - self.arrastando.dx);
      var y = Math.max(0, (e.clientY - c2.top) / z2 - self.arrastando.dy);
      self.arrastando.el.style.left = x + 'px';
      self.arrastando.el.style.top = y + 'px';
      self.posManual[id] = { x: x, y: y };
      if (self._rafSetas) cancelAnimationFrame(self._rafSetas);
      self._rafSetas = requestAnimationFrame(function () { self.desenharSetas(); });
    };
    var soltar = function () {
      el.classList.remove('arrastando');
      el.removeEventListener('pointermove', mover);
      el.removeEventListener('pointerup', soltar);
      el.removeEventListener('pointercancel', soltar);
      self.arrastando = null;
    };
    el.addEventListener('pointermove', mover);
    el.addEventListener('pointerup', soltar);
    el.addEventListener('pointercancel', soltar);
    ev.preventDefault();
  };

  // ---------- Modo apresentação ----------
  function ModoApresentacao(opcoes) {
    var self = this;
    this.botao = opcoes.botao;
    this.onMudar = typeof opcoes.onMudar === 'function' ? opcoes.onMudar : null;
    this.ativo = false;

    this.botao.addEventListener('click', function () {
      if (self.ativo) self.sair();
      else self.entrar();
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && self.ativo) self.sair(false);
    });

    document.addEventListener('fullscreenchange', function () {
      if (!document.fullscreenElement && self.ativo) self.sair(false);
    });
  }

  ModoApresentacao.prototype.entrar = function () {
    this.ativo = true;
    document.body.classList.add('sim-apresentacao');
    try {
      if (document.documentElement.requestFullscreen) {
        var p = document.documentElement.requestFullscreen();
        if (p && p["catch"]) p["catch"](function () {});
      }
    } catch (e) {}
    if (this.onMudar) this.onMudar(true);
  };

  ModoApresentacao.prototype.sair = function (comFullscreen) {
    if (comFullscreen !== false) {
      try {
        if (document.exitFullscreen && document.fullscreenElement) {
          var p = document.exitFullscreen();
          if (p && p["catch"]) p["catch"](function () {});
        }
      } catch (e) {}
    }
    this.ativo = false;
    document.body.classList.remove('sim-apresentacao');
    if (this.onMudar) this.onMudar(false);
  };

  // ---------- Exportação ----------
  window.SimLista = {
    fmtEnd: fmtEnd,
    Palco: Palco,
    ModoApresentacao: ModoApresentacao
  };
})();
