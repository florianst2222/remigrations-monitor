/* Remigrations-Monitor – ohne externe Bibliotheken */
(function () {
  'use strict';
  var root = document.getElementById('remigration-monitor');
  if (!root || root.getAttribute('data-ready')) return;
  root.setAttribute('data-ready', '1');
  var BASE = root.getAttribute('data-base') || '';
  var SVGNS = 'http://www.w3.org/2000/svg';
  var $ = function (s) { return root.querySelector(s); };
  var NF = new Intl.NumberFormat('de-DE');
  var int = function (v) { return v == null ? '–' : NF.format(Math.round(v)); };
  var pct = function (v) { return v == null ? '–' : NF.format(Math.round(v)) + ' %'; };
  var eur = function (v) {
    if (v >= 1e9) return NF.format(Math.round(v / 1e7) / 100) + ' Mrd. €';
    if (v >= 1e6) return NF.format(Math.round(v / 1e4) / 100) + ' Mio. €';
    return NF.format(Math.round(v)) + ' €';
  };

  /* ---------- Namen ---------- */
  var DN = null;
  try { DN = new Intl.DisplayNames(['de'], { type: 'region' }); } catch (e) { DN = null; }
  var FIX = { EU27_2020: 'EU-27', EL: 'Griechenland', UK: 'Vereinigtes Königreich', XK: 'Kosovo', STLS: 'Staatenlos', RNC: 'Nicht anerkannter Staat', UNK: 'Unbekannt', CD: 'Kongo (Dem. Rep.)', CG: 'Kongo (Rep.)', CI: 'Elfenbeinküste', MK: 'Nordmazedonien', PS: 'Palästina', MM: 'Myanmar', CZ: 'Tschechien', VA: 'Vatikan' };
  function name(c) {
    if (FIX[c]) return FIX[c];
    if (DN) { try { var n = DN.of(c); if (n && n !== c) return n; } catch (e) { /* unbekannter Code */ } }
    return c;
  }

  /* EU-Liste sicherer Herkunftsstaaten (VO (EU) 2026/464) */
  var SAFE = { BD: 1, CO: 1, EG: 1, IN: 1, XK: 1, MA: 1, TN: 1 };
  /* Formelle EU-Rückübernahmeabkommen */
  var READM = { HK: 1, MO: 1, LK: 1, AL: 1, RU: 1, UA: 1, MK: 1, BA: 1, ME: 1, RS: 1, MD: 1, PK: 1, GE: 1, AM: 1, AZ: 1, TR: 1, CV: 1, BY: 1 };

  var D, YEARS, LASTK, INSET = {}, PATHS = {};
  var state = { k: 0, geo: 'EU27_2020', playing: null, scope: 'EU27_2020', sort: 'o', all: false };

  function rate(o, r) { return o ? r / o * 100 : null; }
  function gap(o, r) { if (!o) return null; return Math.max(0, 1 - r / o) * 100; }

  /* ---------- Karte ---------- */
  var BREAKS = [20, 35, 50, 65, 80, 90];
  var COLORS = ['#fbe6e5', '#f6c4c1', '#ee9a95', '#e26b66', '#cf3b3b', '#a81e25', '#6e0c14'];
  function color(v) {
    if (v == null) return null;
    var i = 0; while (i < BREAKS.length && v >= BREAKS[i]) i++;
    return COLORS[i];
  }

  function decode(topo) {
    var tf = topo.transform, sx = tf.scale[0], sy = tf.scale[1], tx = tf.translate[0], ty = tf.translate[1];
    var arcs = topo.arcs.map(function (arc) {
      var x = 0, y = 0;
      return arc.map(function (p) { x += p[0]; y += p[1]; return [(x * sx + tx) / 1000, -(y * sy + ty) / 1000]; });
    });
    function ring(ids) {
      var pts = [];
      ids.forEach(function (i) {
        var a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
        for (var j = pts.length ? 1 : 0; j < a.length; j++) pts.push(a[j]);
      });
      return pts;
    }
    var obj = topo.objects[Object.keys(topo.objects)[0]];
    return obj.geometries.map(function (g) {
      var polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
      var d = '', bb = [Infinity, Infinity, -Infinity, -Infinity];
      polys.forEach(function (poly) {
        poly.forEach(function (r) {
          ring(r).forEach(function (p, j) {
            d += (j ? 'L' : 'M') + Math.round(p[0] * 10) / 10 + ' ' + Math.round(p[1] * 10) / 10;
            if (p[0] < bb[0]) bb[0] = p[0]; if (p[1] < bb[1]) bb[1] = p[1];
            if (p[0] > bb[2]) bb[2] = p[0]; if (p[1] > bb[3]) bb[3] = p[1];
          });
          d += 'Z';
        });
      });
      return { id: g.properties.id, d: d, bb: bb };
    });
  }

  var svg = $('#rm-map'), selPath;
  function buildMap(shapes) {
    var defs = document.createElementNS(SVGNS, 'defs');
    defs.innerHTML = '<pattern id="rm-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#eef0f3"/><line x1="0" y1="0" x2="0" y2="6" stroke="#c9ced6" stroke-width="2"/></pattern>';
    svg.appendChild(defs);
    var g = document.createElementNS(SVGNS, 'g');
    var bb = [Infinity, Infinity, -Infinity, -Infinity];
    shapes.forEach(function (s) {
      var p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', s.d);
      var inside = !!INSET[s.id];
      p.setAttribute('class', 'c ' + (inside ? 'in' : 'ctx'));
      if (inside) {
        p.dataset.id = s.id; PATHS[s.id] = p;
        if (s.id !== 'NO' && s.id !== 'IS') {
          bb[0] = Math.min(bb[0], s.bb[0]); bb[1] = Math.min(bb[1], s.bb[1]);
          bb[2] = Math.max(bb[2], s.bb[2]); bb[3] = Math.max(bb[3], s.bb[3]);
        }
      }
      g.appendChild(p);
    });
    selPath = document.createElementNS(SVGNS, 'path');
    selPath.setAttribute('class', 'sel');
    g.appendChild(selPath);
    svg.appendChild(g);
    var padX = (bb[2] - bb[0]) * .04, padY = (bb[3] - bb[1]) * .04;
    var w = bb[2] - bb[0] + 2 * padX, h = bb[3] - bb[1] + 2 * padY;
    svg.setAttribute('viewBox', [bb[0] - padX, bb[1] - padY, w, h].join(' '));
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    var ld = $('#rm-loading'); if (ld) ld.remove();

    var tip = $('#rm-tip'), box = $('.rm-mapbox');
    function show(e, id) {
      var gd = D.geo[id], k = state.k, o = gd.o[k], r = gd.r[k];
      tip.innerHTML = '<b>' + name(id) + ' · ' + YEARS[k] + '</b>' +
        '<div class="r"><span>Ausreisepflichtig</span><span>' + int(o) + '</span></div>' +
        '<div class="r"><span>Zurückgeführt</span><span>' + int(r) + '</span></div>' +
        '<div class="r"><span>Nicht vollzogen</span><span>' + pct(gap(o, r)) + '</span></div>';
      tip.hidden = false;
      var rb = box.getBoundingClientRect(), x = e.clientX - rb.left + 14, y = e.clientY - rb.top + 14;
      if (x + tip.offsetWidth > rb.width - 8) x = e.clientX - rb.left - tip.offsetWidth - 14;
      if (y + tip.offsetHeight > rb.height - 8) y = e.clientY - rb.top - tip.offsetHeight - 14;
      tip.style.left = Math.max(4, x) + 'px'; tip.style.top = Math.max(4, y) + 'px';
    }
    svg.addEventListener('pointermove', function (e) {
      var id = e.target && e.target.dataset && e.target.dataset.id;
      if (id && e.pointerType === 'mouse') show(e, id); else if (e.pointerType === 'mouse') tip.hidden = true;
    });
    svg.addEventListener('pointerleave', function () { tip.hidden = true; });
    svg.addEventListener('click', function (e) {
      var id = e.target && e.target.dataset && e.target.dataset.id;
      if (!id) return;
      if (e.pointerType !== 'mouse') show(e, id);
      setGeo(id, true);
    });
  }

  function paint() {
    var k = state.k;
    Object.keys(PATHS).forEach(function (id) {
      var gd = D.geo[id], v = gd ? gap(gd.o[k], gd.r[k]) : null, c = color(v), p = PATHS[id];
      if (c) { p.style.fill = c; p.classList.remove('na'); } else { p.style.fill = ''; p.classList.add('na'); }
    });
    $('#rm-yearbadge').textContent = YEARS[k];
    $('#rm-year-out').textContent = YEARS[k];
  }

  function legend() {
    var h = '<div class="t">Anteil der Ausreisepflichtigen, die nicht zurückgeführt wurden</div>';
    COLORS.forEach(function (c, i) {
      var txt = i === 0 ? '< ' + BREAKS[0] + ' %' : i === COLORS.length - 1 ? '≥ ' + BREAKS[i - 1] + ' %' : BREAKS[i - 1] + ' %';
      h += '<div class="k"><i style="background:' + c + '"></i><span>' + txt + '</span></div>';
    });
    h += '<div class="x"><i style="background:repeating-linear-gradient(45deg,#c9ced6 0 2px,#eef0f3 2px 5px)"></i>keine Daten</div>';
    $('#rm-legend').innerHTML = h;
  }

  /* ---------- Zeitraffer ---------- */
  var range = $('#rm-year');
  function setK(k) { state.k = k; range.value = k; paint(); }
  range.addEventListener('input', function () { stop(); setK(+range.value); });
  function stop() {
    if (state.playing) { clearInterval(state.playing); state.playing = null; }
    $('#rm-play-ic').setAttribute('d', 'M8 5v14l11-7z');
    $('#rm-play').setAttribute('aria-label', 'Zeitraffer abspielen');
  }
  $('#rm-play').addEventListener('click', function () {
    if (state.playing) { stop(); return; }
    setK(state.k >= LASTK ? 0 : state.k);
    $('#rm-play-ic').setAttribute('d', 'M7 5h4v14H7zM13 5h4v14h-4z');
    $('#rm-play').setAttribute('aria-label', 'Zeitraffer anhalten');
    state.playing = setInterval(function () {
      if (state.k >= LASTK) { stop(); return; }
      setK(state.k + 1);
    }, 800);
  });

  /* ---------- Verlauf ---------- */
  function setGeo(id, fromMap) {
    state.geo = id;
    $('#rm-geo').value = id;
    selPath.setAttribute('d', id !== 'EU27_2020' && PATHS[id] ? PATHS[id].getAttribute('d') : '');
    chart();
    if (fromMap && window.matchMedia('(max-width: 860px)').matches) {
      $('.rm-chartcard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function niceMax(v) {
    var p = Math.pow(10, Math.floor(Math.log10(v || 1))), m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }

  function chart() {
    var gd = D.geo[state.geo], el = $('#rm-chart');
    $('#rm-chart-title').textContent = name(state.geo) + ': ausreisepflichtig und zurückgeführt';
    var W = Math.max(320, Math.min(760, el.clientWidth || 760)), small = W < 520, H = small ? 240 : 300, L = small ? 40 : 52, R = 4, T = 10, B = 52;
    var n = YEARS.length, step = (W - L - R) / n, bw = Math.min(22, step * .34);
    var max = niceMax(Math.max.apply(null, gd.o.concat(gd.r).map(function (v) { return v || 0; })));
    var y = function (v) { return T + (H - T - B) * (1 - v / max); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Säulendiagramm ' + name(state.geo) + '">';
    s += '<g class="grid ax">';
    for (var i = 0; i <= 4; i++) {
      var v = max * i / 4, yy = y(v);
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/>';
      s += '<text x="' + (L - 6) + '" y="' + (yy + 4) + '" text-anchor="end">' + (small && v >= 1000 ? NF.format(v / 1000) + 'k' : NF.format(v)) + '</text>';
    }
    s += '</g>';
    for (var k = 0; k < n; k++) {
      var cx = L + step * k + step / 2, o = gd.o[k], r = gd.r[k];
      s += '<g class="yrg" data-k="' + k + '">';
      if (o != null) s += '<rect class="o" x="' + (cx - bw - 1) + '" y="' + y(o) + '" width="' + bw + '" height="' + Math.max(0, y(0) - y(o)) + '" rx="3"/>';
      if (r != null) s += '<rect class="r" x="' + (cx + 1) + '" y="' + y(r) + '" width="' + bw + '" height="' + Math.max(0, y(0) - y(r)) + '" rx="3"/>';
      s += '<rect class="hit" x="' + (cx - step / 2) + '" y="' + T + '" width="' + step + '" height="' + (H - T) + '"/>';
      s += '</g>';
      s += '<g class="yr"><text x="' + cx + '" y="' + (H - B + 17) + '" text-anchor="middle">' + (small ? "'" + String(YEARS[k]).slice(2) : YEARS[k]) + '</text></g>';
      s += '<g class="q"><text x="' + cx + '" y="' + (H - B + 36) + '" text-anchor="middle"' + (small ? ' font-size="11"' : '') + '>' + (rate(o, r) == null ? '' : (small ? String(Math.round(rate(o, r))) : pct(rate(o, r)))) + '</text></g>';
    }
    s += '<text x="0" y="' + (H - B + 36) + '" font-size="11" fill="#6b7280">' + (small ? 'Quote %' : 'Quote') + '</text>';
    s += '</svg><div class="ctip" hidden></div>';
    el.innerHTML = s;
    var tip = el.querySelector('.ctip');
    el.querySelectorAll('.yrg').forEach(function (gEl) {
      gEl.addEventListener('pointerenter', function () {
        var k = +gEl.dataset.k, o = gd.o[k], r = gd.r[k];
        tip.innerHTML = '<b>' + YEARS[k] + '</b><br>Ausreisepflichtig: ' + int(o) + '<br>Zurückgeführt: ' + int(r) + '<br>Rückführungsquote: ' + pct(rate(o, r));
        tip.hidden = false;
        var hb = gEl.querySelector('.hit').getBoundingClientRect(), eb = el.getBoundingClientRect();
        var x = hb.left - eb.left + hb.width / 2 - tip.offsetWidth / 2;
        tip.style.left = Math.max(0, Math.min(eb.width - tip.offsetWidth, x)) + 'px';
        tip.style.top = '0px';
      });
      gEl.addEventListener('pointerleave', function () { tip.hidden = true; });
    });
    var so = 0, sr = 0, from = null;
    gd.o.forEach(function (v, i) { if (v != null && gd.r[i] != null) { so += v; sr += gd.r[i]; if (from == null) from = YEARS[i]; } });
    $('#rm-backlog').innerHTML = from == null ? '' :
      'Seit ' + from + ' ergingen in ' + (state.geo === 'EU27_2020' ? 'der EU' : name(state.geo)) + ' <b>' + int(so) + '</b> Ausreiseanordnungen, zurückgeführt wurden <b>' + int(sr) + '</b>. ' +
      (so > sr ? 'Differenz: <b>' + int(so - sr) + '</b> nicht vollzogene Anordnungen. Das ist eine Obergrenze, keine Personenzahl, weil eine Person mehrere Anordnungen erhalten kann.' : 'Es wurden mehr Rückführungen als Anordnungen gezählt; Rückführungen beruhen teils auf Anordnungen früherer Jahre.');
  }

  var rz; window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (D) chart(); }, 150); });

  /* ---------- Herkunftsländer ---------- */
  function herkunft() {
    var rows = D.herkunft[state.scope].slice();
    var minQ = state.scope === 'AT' ? 300 : 5000;
    if (state.sort === 'q') {
      rows = rows.filter(function (r) { return r.o >= minQ; });
      rows.sort(function (a, b) { return (a.r / a.o) - (b.r / b.o) || b.o - a.o; });
    }
    var shown = state.all ? rows : rows.slice(0, 20);
    var y0 = D.drei[0], y1 = D.drei[D.drei.length - 1];
    $('#rm-her-sub').textContent = 'Ausreisepflichtige und Rückführungen nach Staatsangehörigkeit, ' + (state.scope === 'AT' ? 'Österreich' : 'EU-27') + ', Summe ' + y0 + '–' + y1 + '.';
    $('#rm-her-min').textContent = state.sort === 'q' ? int(minQ) : (state.scope === 'AT' ? '60' : '1.500');
    $('#rm-her-body').innerHTML = shown.map(function (r) {
      var q = rate(r.o, r.r), w = Math.min(100, q);
      return '<tr><td class="nm">' + name(r.c) + (SAFE[r.c] ? '<span class="rm-badge safe">EU-Liste</span>' : '') + (READM[r.c] ? '<span class="rm-badge ra">Abkommen</span>' : '') + '</td>' +
        '<td class="n">' + int(r.o) + '</td><td class="n rr">' + int(r.r) + '</td>' +
        '<td class="q"><span class="rm-qbar"><span class="tr"><span class="f' + (q < 20 ? ' low' : '') + '" style="width:' + w + '%"></span></span><b>' + pct(q) + '</b></span></td></tr>';
    }).join('');
    var more = $('#rm-her-more');
    more.hidden = rows.length <= 20;
    more.textContent = state.all ? 'Weniger anzeigen' : 'Alle ' + rows.length + ' Staaten anzeigen';
  }
  root.querySelectorAll('[data-scope]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.scope = b.dataset.scope; state.all = false;
      root.querySelectorAll('[data-scope]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      herkunft();
    });
  });
  root.querySelectorAll('[data-sort]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.sort = b.dataset.sort;
      root.querySelectorAll('[data-sort]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      herkunft();
    });
  });
  $('#rm-her-more').addEventListener('click', function () { state.all = !state.all; herkunft(); });

  /* ---------- Österreich (BFA-Detailstatistik 2025) ---------- */
  var BFA = {
    abschiebung: 5879, dublin: 948, freiwillig: 7497, gesamt: 14324,
    schubhaft: 2313, schubhaftDublin: 803, gelinder: 279,
    rueckkehr: 1932, rueckkehrEV: 2318,
    top: [['SK', 1660, 1], ['HU', 1021, 1], ['RO', 623, 1], ['PL', 368, 1], ['TR', 325, 0], ['RS', 280, 0], ['CZ', 212, 1], ['BG', 160, 1], ['NG', 117, 0], ['GE', 97, 0]]
  };
  function oesterreich() {
    var at = D.geo.AT, k = LASTK, euDep = BFA.top.filter(function (t) { return t[2]; }).reduce(function (a, t) { return a + t[1]; }, 0);
    var max = BFA.top[0][1];
    var c1 = '#082f6e', c2 = '#5b7fb8', c3 = '#c3cddd';
    var h = '<div class="rm-at-grid">';
    h += '<div class="rm-card"><h3>Ausreisen aus Österreich 2025</h3><span class="big">' + int(BFA.gesamt) + '</span>' +
      '<div class="rm-stack" aria-hidden="true"><span style="flex:' + BFA.abschiebung + ';background:' + c1 + '"></span><span style="flex:' + BFA.dublin + ';background:' + c2 + '"></span><span style="flex:' + BFA.freiwillig + ';background:' + c3 + '"></span></div>' +
      '<div class="rm-stack-keys"><span><i style="background:' + c1 + '"></i>Abschiebungen <b>' + int(BFA.abschiebung) + '</b></span><span><i style="background:' + c2 + '"></i>Dublin-Überstellungen <b>' + int(BFA.dublin) + '</b></span><span><i style="background:' + c3 + '"></i>freiwillig <b>' + int(BFA.freiwillig) + '</b></span></div>' +
      '<p style="margin-top:12px">Mehr als die Hälfte aller Ausreisen ist freiwillig. Zwangsweise wurden ' + int(BFA.abschiebung + BFA.dublin) + ' Personen außer Landes gebracht.</p></div>';
    h += '<div class="rm-card"><h3>Wer abgeschoben wird</h3><p>Abschiebungen 2025 nach Staatsangehörigkeit, die zehn häufigsten. <b style="color:#0a3d8f">Blau</b> = EU-Bürger.</p><ul class="rm-hbars">' +
      BFA.top.map(function (t) {
        return '<li><span>' + name(t[0]) + '</span><span class="tr"><span class="f' + (t[2] ? ' eu' : '') + '" style="width:' + (t[1] / max * 100) + '%"></span></span><b>' + int(t[1]) + '</b></li>';
      }).join('') + '</ul><p style="margin-top:10px">Mindestens <b>' + int(euDep) + '</b> der ' + int(BFA.abschiebung) + ' Abschiebungen (' + pct(euDep / BFA.abschiebung * 100) + ') betrafen EU-Bürger. Bei Drittstaatsangehörigen ist der Vollzug deutlich geringer.</p></div>';
    h += '</div><div class="rm-at-row">';
    h += '<div class="rm-card"><h3>Rückführungsquote Drittstaatsangehörige ' + YEARS[k] + '</h3><span class="big">' + pct(rate(at.o[k], at.r[k])) + '</span><p>' + int(at.o[k]) + ' ausreisepflichtig, ' + int(at.r[k]) + ' zurückgeführt' + (at.forc && at.forc[k] != null ? ', davon ' + int(at.forc[k]) + ' zwangsweise und ' + int(at.volu[k]) + ' freiwillig' : '') + ' (Eurostat).</p></div>';
    h += '<div class="rm-card"><h3>Schubhaft 2025</h3><span class="big">' + int(BFA.schubhaft + BFA.schubhaftDublin) + '</span><p>Anordnungen von Schubhaft, davon ' + int(BFA.schubhaftDublin) + ' in Dublin-Verfahren. Dazu ' + int(BFA.gelinder) + '-mal ein gelinderes Mittel.</p></div>';
    h += '<div class="rm-card"><h3>Was fehlt</h3><p>Wie viele Ausreisepflichtige sich <b>derzeit</b> in Österreich aufhalten, veröffentlicht der Bund nicht. Ebenso wenig, wie viele davon Grundversorgung beziehen.</p></div>';
    h += '</div>';
    $('#rm-at').innerHTML = h;
  }

  /* ---------- Kostenrechner ---------- */
  var cN = $('#rm-c-n'), cM = $('#rm-c-m'), cX = $('#rm-c-x');
  function calc() {
    var n = Math.max(0, +cN.value || 0), m = +cM.value;
    var sel = root.querySelector('input[name="rm-c-k"]:checked').value;
    var k = sel === 'x' ? Math.max(0, +cX.value || 0) : +sel;
    var days = m * 365 / 12, sum = n * k * days;
    $('#rm-c-m-out').textContent = m + (m === 1 ? ' Monat' : ' Monate');
    $('#rm-c-sum').textContent = eur(sum);
    $('#rm-c-sub').textContent = int(n) + ' Personen × ' + NF.format(k) + ' € × ' + NF.format(Math.round(days)) + ' Tage';
  }
  [cN, cM, cX].forEach(function (el) { el.addEventListener('input', calc); });
  root.querySelectorAll('input[name="rm-c-k"]').forEach(function (el) { el.addEventListener('change', calc); });
  cX.addEventListener('focus', function () { root.querySelector('input[name="rm-c-k"][value="x"]').checked = true; calc(); });

  /* ---------- Gesetzgebung ---------- */
  var LAWS = [
    { t: 'Rückführungsverordnung (EU) 2026/2280', st: 'beschlossen',
      p: 'Gemeinsames europäisches Rückkehrsystem: Mitgliedstaaten dürfen Rückkehrzentren in Drittstaaten einrichten, Abschiebehaft bis zu 24 Monate (verlängerbar). Gilt nicht für Dänemark und Irland.',
      s: [['26.03.2026', 'Parlament: Verhandlungsmandat', '389 : 206 : 32', 'y'], ['17.06.2026', 'Parlament: Annahme der Einigung', '418 : 218 : 30', 'y'], ['17.06.2026', 'Parlament: Antrag, das Gesetz abzulehnen', 'abgelehnt', 'y', 'Steger: gegen Ablehnung'], ['01.10.2026', 'Rat: endgültige Annahme', '', '']] },
    { t: 'EU-Liste sicherer Herkunftsstaaten (VO (EU) 2026/464)', st: 'gilt seit 12.06.2026',
      p: 'Bangladesch, Ägypten, Indien, Kolumbien, Kosovo, Marokko und Tunesien gelten EU-weit als sicher; Asylanträge von dort werden beschleunigt geprüft. Beitrittskandidaten gelten grundsätzlich ebenfalls als sicher.',
      s: [['17.12.2025', 'Parlament: Verhandlungsmandat', '396 : 202 : 56', 'y'], ['10.02.2026', 'Parlament: Annahme', '408 : 184 : 60', 'y'], ['23.02.2026', 'Rat: endgültige Annahme', '', '']] },
    { t: 'Konzept „sicherer Drittstaat“', st: 'gilt seit 12.06.2026',
      p: 'Asylanträge können als unzulässig abgelehnt werden, wenn der Antragsteller in einen sicheren Drittstaat gebracht werden kann, etwa über Transit oder eine Vereinbarung mit diesem Staat.',
      s: [['17.12.2025', 'Parlament: Verhandlungsmandat', '384 : 237 : 31', 'y'], ['10.02.2026', 'Parlament: Annahme', '396 : 226 : 30', 'y'], ['23.02.2026', 'Rat: endgültige Annahme', '', '']] },
    { t: 'Visa-Aussetzungsmechanismus (Reform)', st: 'beschlossen',
      p: 'Die EU kann die Visumfreiheit für Staaten leichter aussetzen, unter anderem wenn diese bei Rückübernahmen nicht kooperieren.',
      s: [['07.10.2025', 'Parlament: Annahme der Einigung', '518 : 96 : 24', 'o']] }
  ];
  var VOTE = { y: ['y', 'Steger: Ja'], n: ['n', 'Steger: Nein'], o: ['o', 'Steger: nicht abgestimmt'] };
  function tracker() {
    $('#rm-tracker').innerHTML = LAWS.map(function (l) {
      return '<article class="rm-law"><h3>' + l.t + '</h3><span class="st">' + l.st + '</span><p>' + l.p + '</p><ol>' +
        l.s.map(function (s) {
          var v = s[3] ? '<span class="rm-vote ' + VOTE[s[3]][0] + '">' + (s[4] || VOTE[s[3]][1]) + '</span>' : '';
          return '<li><time>' + s[0] + '</time><span>' + s[1] + v + '</span><span class="res">' + s[2] + '</span></li>';
        }).join('') + '</ol></article>';
    }).join('');
  }

  /* ---------- Start ---------- */
  function get(u) { return fetch(BASE + u).then(function (r) { if (!r.ok) throw new Error(u); return r.json(); }); }
  Promise.all([get('daten.json'), get('europa.topo.json')]).then(function (res) {
    D = res[0]; YEARS = D.jahre; LASTK = YEARS.length - 1; state.k = LASTK;
    D.eu27.concat(D.efta).forEach(function (c) { INSET[c] = 1; });
    range.max = LASTK; range.value = LASTK;

    var eu = D.geo.EU27_2020, at = D.geo.AT, k = LASTK, y = YEARS[k];
    var euQ = rate(eu.o[k], eu.r[k]);
    $('#rm-lead').innerHTML = y + ' wurden in der EU <b>' + int(eu.o[k]) + '</b> Drittstaatsangehörige zur Ausreise verpflichtet. Zurückgeführt wurden <b>' + int(eu.r[k]) + '</b>, also ' + pct(euQ) + '. Wie viele Ausreisepflichtige bleiben, welche Herkunftsstaaten blockieren und was die EU dagegen beschlossen hat.';
    var so = 0, sr = 0; eu.o.forEach(function (v, i) { so += v || 0; sr += eu.r[i] || 0; });
    $('#rm-kpis').innerHTML =
      '<div class="rm-kpi"><span class="l">EU · Ausreisepflichtig ' + y + '</span><span class="v">' + int(eu.o[k]) + '</span><span class="s">Drittstaatsangehörige</span></div>' +
      '<div class="rm-kpi"><span class="l">EU · tatsächlich zurückgeführt</span><span class="v">' + pct(euQ) + '</span><span class="s">' + int(eu.r[k]) + ' Personen</span></div>' +
      '<div class="rm-kpi"><span class="l">Österreich · zurückgeführt ' + y + '</span><span class="v">' + pct(rate(at.o[k], at.r[k])) + '</span><span class="s">' + int(at.r[k]) + ' von ' + int(at.o[k]) + '</span></div>' +
      '<div class="rm-kpi hl"><span class="l">EU · nicht vollzogen seit ' + YEARS[0] + '</span><span class="v">' + int(so - sr) + '</span><span class="s">Anordnungen ohne Rückführung</span></div>';

    var sel = $('#rm-geo');
    var opts = ['EU27_2020'].concat(D.eu27.concat(D.efta).filter(function (c) { return D.geo[c]; }).sort(function (a, b) { return name(a).localeCompare(name(b), 'de'); }));
    sel.innerHTML = opts.map(function (c) { return '<option value="' + c + '">' + name(c) + '</option>'; }).join('');
    sel.addEventListener('change', function () { setGeo(sel.value, false); });

    buildMap(decode(res[1]));
    legend(); paint();
    setGeo('EU27_2020', false);
    herkunft();
    oesterreich();
    cN.value = Math.max(0, (at.o[k] || 0) - (at.r[k] || 0));
    $('#rm-c-n-hint').textContent = 'Voreinstellung: Ausreisepflichtige in Österreich ' + y + ' ohne Rückführung im selben Jahr (' + int(at.o[k]) + ' − ' + int(at.r[k]) + ').';
    calc();
    tracker();
    $('#rm-stand').textContent = 'Datenstand: ' + D.stand.eurostat + '; BFA-Detailstatistik 2025 (März 2026).';
  }).catch(function (e) {
    var l = $('#rm-loading'); if (l) l.textContent = 'Die Daten konnten nicht geladen werden.';
    if (window.console) console.error(e);
  });
})();
