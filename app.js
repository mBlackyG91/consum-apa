/* Evidența lunară a consumului de apă — logica aplicației. */
(function () {
  'use strict';

  const APP_VERSION = '1.5.0';
  const LS_DATA = 'evidenta-apa:data';
  const LS_UI = 'evidenta-apa:ui';

  const METERS = [
    { key: 'bucatarie', label: 'Bucătărie' },
    { key: 'baie', label: 'Baie' },
    { key: 'serviciu', label: 'Baie de serviciu' },
  ];
  const MONTHS = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august',
    'septembrie', 'octombrie', 'noiembrie', 'decembrie'];

  // Textul fix al formularului (din modelul .docx).
  const T = {
    title: 'ÎNȘTINȚARE LUNARĂ CONSUM DE APĂ',
    to: 'CĂTRE: ',
    assoc: 'ASOCIAȚIA DE PROPRIETARI NR. 103, BLOC 3, SCARA A',
    apt: 'Apartament nr. ',
    owner: ', Numele și prenume proprietar: ',
    period: 'Perioada consumului: ',
    persons: 'Numărul de persoane care au locuit în luna consumului',
    head: ['Poziție contor', 'Index vechi [m³]', 'Index nou [m³]', 'Consum [m³]'],
    sig: 'Semnătură',
    total: 'Total consum apă rece',
  };
  const BLANK = { apt: 4, owner: 20, period: 30, persons: 12 };
  const FONT_STACK = '"Times New Roman", Times, "Liberation Serif", "Nimbus Roman", serif';

  // Geometria formularului în mm — aceeași pentru HTML și pentru PDF.
  const G = { formW: 159.2, lineH: 5.6, pGap: 2.6, rowH: 6.6, cellPad: 1.9, fontPt: 12 };
  G.formH = 5 * (G.lineH + G.pGap) + 5 * G.rowH;

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // Indexurile și consumul sunt numere întregi de m³ (fără zecimale).
  const roundIdx = (x) => Math.round(x);
  const fmtNum = (n) => (n == null ? '' : String(roundIdx(n)).replace('-', '−'));

  /** Acceptă doar cifre (spațiile sunt ignorate). Întoarce {ok, value}. */
  function parseNum(s) {
    const t = String(s == null ? '' : s).replace(/\s/g, '');
    if (t === '') return { ok: true, value: null };
    if (!/^\d+$/.test(t)) return { ok: false };
    return { ok: true, value: Number(t) };
  }
  function parseIntField(s) {
    const t = String(s == null ? '' : s).trim();
    if (t === '') return { ok: true, value: null };
    if (!/^\d{1,2}$/.test(t)) return { ok: false };
    return { ok: true, value: Number(t) };
  }
  function toIntOrNull(v) { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) ? null : Math.max(0, Math.round(n)); }
  function toNumOrNull(v) { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) ? null : roundIdx(n); }

  // ======================= DATE =======================
  function newApt() {
    return { id: uid(), number: '', owner: '', defaultPersons: null,
      meters: { bucatarie: true, baie: true, serviciu: false }, print: true };
  }
  function emptyData() {
    return { schema: 1, updatedAt: null, settings: { perSheet: 3 }, apartments: [newApt(), newApt()], months: {} };
  }
  function normalize(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.apartments) || (d.months && typeof d.months !== 'object')) {
      throw new Error('Fișierul nu are formatul aplicației (lipsesc „apartments” / „months”).');
    }
    const out = { schema: 1, updatedAt: d.updatedAt || null,
      settings: { perSheet: d.settings && Number(d.settings.perSheet) === 2 ? 2 : 3 }, apartments: [], months: {} };
    const ids = new Set();
    for (const a of d.apartments) {
      if (!a || typeof a !== 'object') continue;
      let id = String(a.id || uid()); if (ids.has(id)) id = uid(); ids.add(id);
      const m = a.meters || {};
      out.apartments.push({ id, number: String(a.number == null ? '' : a.number), owner: String(a.owner == null ? '' : a.owner),
        defaultPersons: toIntOrNull(a.defaultPersons),
        meters: { bucatarie: m.bucatarie !== false, baie: m.baie !== false, serviciu: !!m.serviciu },
        print: a.print !== false });
    }
    for (const [mk, mv] of Object.entries(d.months || {})) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mk) || !mv || typeof mv !== 'object') continue;
      const month = { period: typeof mv.period === 'string' && mv.period.trim() ? mv.period : null, apts: {} };
      for (const [aid, e] of Object.entries(mv.apts || {})) {
        if (!e || typeof e !== 'object') continue;
        const ent = { persons: toIntOrNull(e.persons), readings: {} };
        for (const mt of METERS) {
          const r = e.readings && e.readings[mt.key];
          if (r) ent.readings[mt.key] = { old: toNumOrNull(r.old), new: toNumOrNull(r.new) };
        }
        month.apts[aid] = ent;
      }
      out.months[mk] = month;
    }
    return out;
  }
  function isPristine(d) {
    try {
      const n = normalize(d);
      const anyMonth = Object.keys(n.months).some((mk) => Object.values(n.months[mk].apts).some(entryHasData) || n.months[mk].period);
      const anyApt = n.apartments.some((a) => a.number.trim() || a.owner.trim() || a.defaultPersons != null);
      return !anyMonth && !anyApt;
    } catch (e) { return false; }
  }
  function entryHasData(e) {
    return !!e && (e.persons != null || Object.values(e.readings || {}).some((r) => r && (r.new != null || r.old != null)));
  }

  function loadData() {
    let raw = null;
    try { raw = localStorage.getItem(LS_DATA); } catch (e) { /* */ }
    if (!raw) return emptyData();
    try { return normalize(JSON.parse(raw)); } catch (e) {
      try { localStorage.setItem(LS_DATA + ':corupt-' + Date.now(), raw); } catch (e2) { /* */ }
      return emptyData();
    }
  }
  let data = loadData();
  let storageWarned = false;
  function saveLocal() {
    try { localStorage.setItem(LS_DATA, JSON.stringify(data)); } catch (e) {
      if (!storageWarned) { storageWarned = true; alert('Nu pot salva datele în memoria browserului (spațiu plin sau mod privat). Exportă un JSON ca siguranță.'); }
    }
  }

  // ======================= LUNI ȘI CALCULE =======================
  function defaultMonth() {
    const due = dueMonth(); if (due) return due; // la final/început de lună: luna „de predat”
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function mkParts(mk) { const [y, m] = mk.split('-').map(Number); return { y, m }; }
  function mkFrom(y, m) { return y + '-' + String(m).padStart(2, '0'); }
  function shiftMonth(mk, delta) { const { y, m } = mkParts(mk); const d = new Date(y, m - 1 + delta, 1); return mkFrom(d.getFullYear(), d.getMonth() + 1); }
  function monthLabel(mk) { const { y, m } = mkParts(mk); return MONTHS[m - 1] + ' ' + y; }
  function sortedKeys() { return Object.keys(data.months).sort(); }
  function aptById(id) { return data.apartments.find((a) => a.id === id); }
  function activeMeters(apt) { return METERS.filter((m) => apt.meters[m.key]); }

  function entry(mk, aptId, create) {
    let mo = data.months[mk];
    if (!mo) { if (!create) return null; mo = data.months[mk] = { period: null, apts: {} }; }
    let e = mo.apts[aptId];
    if (!e) { if (!create) return null; e = mo.apts[aptId] = { persons: null, readings: {} }; }
    return e;
  }
  function reading(mk, aptId, meter, create) {
    const e = entry(mk, aptId, create); if (!e) return null;
    let r = e.readings[meter];
    if (!r) { if (!create) return null; r = e.readings[meter] = { old: null, new: null }; }
    return r;
  }
  function newIdx(mk, aptId, meter) { const r = reading(mk, aptId, meter); return r ? r.new : null; }
  /** Indexul vechi automat = indexul nou din cea mai apropiată lună anterioară care îl are. */
  function autoOld(mk, aptId, meter) {
    const keys = sortedKeys();
    for (let i = keys.length - 1; i >= 0; i--) {
      if (keys[i] >= mk) continue;
      const v = newIdx(keys[i], aptId, meter);
      if (v != null) return { value: v, src: 'auto', from: keys[i] };
    }
    return { value: null, src: 'none' };
  }
  function effOld(mk, aptId, meter) {
    const r = reading(mk, aptId, meter);
    if (r && r.old != null) return { value: r.old, src: 'manual' };
    return autoOld(mk, aptId, meter);
  }
  function consumption(mk, aptId, meter) {
    const o = effOld(mk, aptId, meter).value, n = newIdx(mk, aptId, meter);
    return o != null && n != null ? roundIdx(n - o) : null;
  }
  function totalFor(mk, apt) {
    const ms = activeMeters(apt);
    if (!ms.length) return { value: null, complete: false, partial: null };
    let sum = 0, complete = true, any = false;
    for (const m of ms) { const c = consumption(mk, apt.id, m.key); if (c == null) complete = false; else { sum += c; any = true; } }
    return { value: complete ? roundIdx(sum) : null, complete, partial: any ? roundIdx(sum) : null };
  }
  function autoPersons(mk, apt) {
    const keys = sortedKeys();
    for (let i = keys.length - 1; i >= 0; i--) {
      if (keys[i] >= mk) continue;
      const e = entry(keys[i], apt.id);
      if (e && e.persons != null) return { value: e.persons, src: 'auto', from: keys[i] };
    }
    return apt.defaultPersons != null ? { value: apt.defaultPersons, src: 'default' } : { value: null, src: 'none' };
  }
  function effPersons(mk, apt) {
    const e = entry(mk, apt.id);
    if (e && e.persons != null) return { value: e.persons, src: 'manual' };
    return autoPersons(mk, apt);
  }
  function autoPeriod(mk) { return monthLabel(mk); }
  function effPeriod(mk) { const mo = data.months[mk]; return (mo && mo.period) || autoPeriod(mk); }
  function avgPrev(mk, aptId, meter) {
    const vals = [];
    const keys = sortedKeys().filter((k) => k < mk).reverse();
    for (const k of keys) {
      const c = consumption(k, aptId, meter);
      if (c != null && c >= 0) vals.push(c);
      if (vals.length >= 12) break;
    }
    return vals.length ? { avg: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length } : null;
  }
  function mIdx(mk) { const { y, m } = mkParts(mk); return y * 12 + m; }
  function validate(mk, apt) {
    const out = [];
    const ms = activeMeters(apt);
    const started = ms.some((m) => newIdx(mk, apt.id, m.key) != null);
    for (const m of ms) {
      const oe = effOld(mk, apt.id, m.key), o = oe.value, n = newIdx(mk, apt.id, m.key);
      if (o != null && n != null && n < o) {
        out.push({ level: 'error', meter: m.key, text: m.label + ': indexul nou (' + fmtNum(n) + ') este mai mic decât cel vechi (' + fmtNum(o) + ').' });
      } else if (o != null && n != null) {
        const c = roundIdx(n - o);
        if (oe.src === 'auto' && oe.from !== shiftMonth(mk, -1)) {
          // Luna precedentă lipsește: indexul vechi vine din altă lună, deci consumul acoperă mai multe luni.
          const k = mIdx(mk) - mIdx(oe.from);
          out.push({ level: 'warn', meter: m.key, text: m.label + ': lipsește ' + monthLabel(shiftMonth(mk, -1)) + '; indexul vechi e preluat din ' +
            monthLabel(oe.from) + ', deci consumul de ' + fmtNum(c) + ' m³ acoperă ' + k + ' luni, nu una.' });
        } else {
          const a = avgPrev(mk, apt.id, m.key);
          if (a && a.avg > 0 && c > 2 * a.avg) {
            out.push({ level: 'warn', meter: m.key, text: m.label + ': consum ' + fmtNum(c) + ' m³, peste dublul mediei lunilor anterioare (' + fmtNum(a.avg) + ' m³).' });
          }
        }
      }
      if (started && n == null) out.push({ level: 'warn', meter: m.key, text: 'Lipsește indexul nou pentru ' + m.label + '.' });
      if (started && n != null && o == null) out.push({ level: 'warn', meter: m.key, text: 'Lipsește indexul vechi pentru ' + m.label + ' (nu există lună anterioară; introdu-l manual).' });
    }
    return out;
  }
  /** Totalul lunii față de aceeași lună din anul trecut (doar dacă ambele sunt complete). */
  function yoy(mk, apt) {
    const t = totalFor(mk, apt), p = totalFor(shiftMonth(mk, -12), apt);
    if (!t.complete || !p.complete) return null;
    return { cur: t.value, prev: p.value, diff: t.value - p.value, pct: p.value > 0 ? ((t.value - p.value) / p.value) * 100 : null };
  }
  function fmtDiff(diff, pct) {
    const sg = diff > 0 ? '+' : diff < 0 ? '−' : '';
    return sg + Math.abs(diff) + ' m³' + (pct == null ? '' : ' (' + sg + Math.round(Math.abs(pct)) + '%)');
  }
  /** Elimină din lună intrările goale, ca istoricul să nu aibă rânduri fantomă. */
  function cleanupMonth(mk) {
    const mo = data.months[mk]; if (!mo) return;
    for (const [aid, e] of Object.entries(mo.apts)) {
      for (const [k, r] of Object.entries(e.readings)) if (r.old == null && r.new == null) delete e.readings[k];
      if (!entryHasData(e)) delete mo.apts[aid];
    }
    if (!mo.period && !Object.keys(mo.apts).length) delete data.months[mk];
  }

  // ======================= STARE UI =======================
  const ui = { tab: 'luna', month: defaultMonth() };
  try { const s = JSON.parse(localStorage.getItem(LS_UI)); if (s && s.tab) ui.tab = s.tab; } catch (e) { /* */ }
  function saveUi() { try { localStorage.setItem(LS_UI, JSON.stringify({ tab: ui.tab })); } catch (e) { /* */ } }

  let previewTimer = null;
  function commit() {
    cleanupMonth(ui.month);
    data.updatedAt = new Date().toISOString();
    saveLocal();
    window.Sync.markDirty();
    renderDueBanner();
    if (ui.tab === 'tiparire') { clearTimeout(previewTimer); previewTimer = setTimeout(renderPrint, 250); }
  }
  function sourceLabel(src) {
    if (src.src === 'auto') return 'preluat din ' + monthLabel(src.from);
    if (src.src === 'default') return 'număr implicit al apartamentului';
    if (src.src === 'manual') return 'introdus manual';
    return '';
  }
  function aptTitle(apt) {
    const n = apt.number.trim() ? 'Ap. ' + apt.number.trim() : 'Apartament fără număr';
    return apt.owner.trim() ? n + ' · ' + apt.owner.trim() : n;
  }

  // ======================= TAB: LUNĂ =======================
  function renderMonthPicker() {
    const { y, m } = mkParts(ui.month);
    $('#month-sel').innerHTML = MONTHS.map((n, i) => '<option value="' + (i + 1) + '"' + (i + 1 === m ? ' selected' : '') + '>' + n + '</option>').join('');
    const nowY = new Date().getFullYear();
    let minY = Math.min(nowY - 3, y), maxY = Math.max(nowY + 1, y);
    for (const k of Object.keys(data.months)) { const yy = mkParts(k).y; minY = Math.min(minY, yy); maxY = Math.max(maxY, yy); }
    let opts = '';
    for (let yy = maxY; yy >= minY; yy--) opts += '<option' + (yy === y ? ' selected' : '') + '>' + yy + '</option>';
    $('#year-sel').innerHTML = opts;
  }
  function renderPeriod() {
    const mo = data.months[ui.month];
    const inp = $('#period');
    if (document.activeElement !== inp) inp.value = effPeriod(ui.month);
    $('#period-reset').hidden = !(mo && mo.period);
  }
  function renderLuna() {
    renderMonthPicker();
    renderPeriod();
    const box = $('#month-apts');
    if (!data.apartments.length) {
      box.innerHTML = '<div class="card"><p>Nu ai niciun apartament. Adaugă unul în secțiunea <strong>Apartamente</strong>.</p></div>';
      return;
    }
    box.innerHTML = data.apartments.map((apt) => {
      const ms = activeMeters(apt);
      const meters = ms.map((m) => {
        const idO = 'o-' + apt.id + '-' + m.key, idN = 'n-' + apt.id + '-' + m.key;
        return '<div class="meter" data-meter="' + m.key + '">' +
          '<div class="meter-name">' + m.label + '</div>' +
          '<div class="meter-grid">' +
          '<div><label class="lbl" for="' + idO + '">Index vechi [m³]</label>' +
          '<input id="' + idO + '" class="num" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" data-k="old">' +
          '<div class="src" data-src="old"></div></div>' +
          '<div><label class="lbl" for="' + idN + '">Index nou [m³]</label>' +
          '<input id="' + idN + '" class="num" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" data-k="new" enterkeyhint="next">' +
          '<div class="src" data-src="new"></div></div>' +
          '</div>' +
          '<div class="cons">Consum: <strong data-out="cons">—</strong></div>' +
          '</div>';
      }).join('');
      return '<div class="card apt-card" data-apt="' + apt.id + '">' +
        '<div class="apt-head"><h2>' + esc(aptTitle(apt)) + '</h2></div>' +
        '<div class="field persons"><label for="p-' + apt.id + '">Număr de persoane</label>' +
        '<input id="p-' + apt.id + '" class="num" type="text" inputmode="numeric" autocomplete="off" data-k="persons">' +
        '<div class="src" data-src="persons"></div></div>' +
        (ms.length ? meters : '<p class="muted">Niciun contor activ. Bifează contoarele în secțiunea Apartamente.</p>') +
        '<div class="total">Total apă rece: <strong data-out="total">—</strong></div>' +
        '<ul class="msgs" data-out="msgs"></ul>' +
        '<label class="check"><input type="checkbox" data-k="print"' + (apt.print ? ' checked' : '') + '> Include la tipărire</label>' +
        '</div>';
    }).join('');
    data.apartments.forEach((a) => updateCard(a.id, true));
    renderMonthStatus();
  }
  /** Apartamentele cărora le lipsesc indexuri noi în luna `mk` (doar cele cu contoare active). */
  function missingFor(mk) {
    const missing = [];
    for (const apt of data.apartments) {
      const ms = activeMeters(apt); if (!ms.length) continue;
      const lack = ms.filter((m) => newIdx(mk, apt.id, m.key) == null);
      if (lack.length) missing.push({ apt, all: lack.length === ms.length, lack });
    }
    return missing;
  }
  const missingHTML = (missing) => missing.map((x) =>
    '<button type="button" class="linklike" data-goto="' + x.apt.id + '">' + esc(aptTitle(x.apt)) +
    (x.all ? '' : ' (' + esc(x.lack.map((m) => m.label).join(', ')) + ')') + '</button>').join(', ');
  /** „N-am uitat pe nimeni?”: apartamentele cărora le lipsesc indexuri noi în luna aleasă. */
  function renderMonthStatus() {
    const box = $('#month-status'); if (!box) return;
    const mk = ui.month;
    if (!data.apartments.some((a) => activeMeters(a).length)) { box.hidden = true; return; }
    const missing = missingFor(mk);
    box.hidden = false;
    if (!missing.length) {
      box.className = 'month-status ok';
      box.innerHTML = '✔ Toate apartamentele au indexurile noi introduse pentru ' + esc(monthLabel(mk)) + '.';
      return;
    }
    box.className = 'month-status warn';
    box.innerHTML = 'Lipsesc indexuri noi pentru ' + esc(monthLabel(mk)) + ': ' + missingHTML(missing) + '.';
  }

  // ---------- avertisment de termen ----------
  // Luna „de predat”: în ultimele zile ale lunii (25+) este luna curentă, în primele zile
  // (până pe 10) este luna precedentă. Între 11 și 24 nu se arată nimic.
  function dueMonth(now) {
    const d = now || new Date();
    const cur = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    if (d.getDate() >= 25) return cur;
    if (d.getDate() <= 10) return shiftMonth(cur, -1);
    return null;
  }
  let dueDismissed = false; // „Mai târziu” ține doar până la următoarea deschidere
  function renderDueBanner(now) {
    const box = $('#due-notice'); if (!box) return;
    const mk = dueMonth(now);
    const missing = mk && data.apartments.some((a) => activeMeters(a).length) ? missingFor(mk) : [];
    // În Lună, pe luna cu pricina, bara „Lipsesc indexuri” spune deja același lucru.
    const redundant = ui.tab === 'luna' && ui.month === mk;
    box.hidden = !missing.length || dueDismissed || redundant;
    if (box.hidden) return;
    box.dataset.month = mk;
    $('#due-text').innerHTML = '<strong>Nu ai introdus încă indexurile pentru ' + esc(monthLabel(mk)) + '.</strong> Lipsesc: ' + missingHTML(missing) + '.';
  }
  function gotoApt(id) {
    const card = $('.apt-card[data-apt="' + id + '"]'); if (!card) return;
    const inp = $$('[data-k="new"]', card).find((i) => !i.value) || $('[data-k="new"]', card);
    card.scrollIntoView({ block: 'center' });
    if (inp) inp.focus();
  }
  /** Actualizează valorile calculate dintr-un card fără a reconstrui câmpurile. */
  function updateCard(aptId, fillInputs) {
    const apt = aptById(aptId); const card = $('.apt-card[data-apt="' + aptId + '"]');
    if (!apt || !card) return;
    const mk = ui.month;
    const pInp = $('[data-k="persons"]', card);
    const p = effPersons(mk, apt);
    if (fillInputs || document.activeElement !== pInp) pInp.value = p.value == null ? '' : String(p.value);
    pInp.classList.toggle('manual', p.src === 'manual');
    $('[data-src="persons"]', card).innerHTML = esc(sourceLabel(p)) +
      (p.src === 'manual' ? ' · <button type="button" data-act="reset-persons">preia automat</button>' : '');

    const msgs = validate(mk, apt);
    for (const m of activeMeters(apt)) {
      const row = $('.meter[data-meter="' + m.key + '"]', card); if (!row) continue;
      const oInp = $('[data-k="old"]', row), nInp = $('[data-k="new"]', row);
      const o = effOld(mk, apt.id, m.key), n = newIdx(mk, apt.id, m.key);
      if (fillInputs || document.activeElement !== oInp) { oInp.value = fmtNum(o.value); oInp.classList.remove('invalid'); }
      if (fillInputs) { nInp.value = fmtNum(n); nInp.classList.remove('invalid'); }
      oInp.classList.toggle('manual', o.src === 'manual');
      oInp.placeholder = o.src === 'none' ? 'introdu manual' : '';
      let srcO = o.src === 'none' ? 'nu există lună anterioară' : sourceLabel(o);
      if (o.src === 'manual') srcO += ' · <button type="button" data-act="reset-old">revino la automat</button>';
      $('[data-src="old"]', row).innerHTML = srcO;
      const hasErr = msgs.some((x) => x.meter === m.key && x.level === 'error');
      nInp.classList.toggle('err', hasErr);
      const c = consumption(mk, apt.id, m.key);
      $('[data-out="cons"]', row).textContent = c == null ? '—' : fmtNum(c) + ' m³';
    }
    const t = totalFor(mk, apt);
    $('[data-out="total"]', card).textContent = t.complete ? fmtNum(t.value) + ' m³'
      : (t.partial != null ? fmtNum(t.partial) + ' m³ (incomplet)' : '—');
    $('[data-out="msgs"]', card).innerHTML = msgs.map((x) => '<li class="' + x.level + '">' + esc(x.text) + '</li>').join('');
    if (!fillInputs) renderMonthStatus();
  }

  function onLunaInput(ev) {
    const inp = ev.target; const card = inp.closest('.apt-card'); if (!card) return;
    const apt = aptById(card.dataset.apt); if (!apt) return;
    const k = inp.dataset.k; const mk = ui.month;
    if (k === 'print') { apt.print = inp.checked; commit(); return; }
    if (k === 'persons') {
      const r = parseIntField(inp.value);
      inp.classList.toggle('invalid', !r.ok); if (!r.ok) return;
      const auto = autoPersons(mk, apt).value;
      const val = r.value == null || r.value === auto ? null : r.value;
      const e = entry(mk, apt.id, val != null); if (e) e.persons = val;
      commit(); updateCard(apt.id); return;
    }
    if (k === 'old' || k === 'new') {
      const meter = inp.closest('.meter').dataset.meter;
      const r = parseNum(inp.value);
      inp.classList.toggle('invalid', !r.ok);
      const src = inp.parentElement.querySelector('.src');
      if (!r.ok) { src.textContent = 'Doar cifre, număr întreg (fără virgulă).'; return; }
      if (k === 'new') src.textContent = '';
      if (k === 'new') {
        const rd = reading(mk, apt.id, meter, r.value != null); if (rd) rd.new = r.value;
      } else {
        const auto = autoOld(mk, apt.id, meter).value;
        const val = r.value == null || r.value === auto ? null : r.value;
        const rd = reading(mk, apt.id, meter, val != null); if (rd) rd.old = val;
      }
      commit(); updateCard(apt.id);
    }
  }
  function onLunaBlur(ev) {
    const inp = ev.target; const card = inp.closest && inp.closest('.apt-card'); if (!card) return;
    const k = inp.dataset.k; if (!k || k === 'print') return;
    if (inp.classList.contains('invalid')) return; // păstrăm textul ca să poată fi corectat
    const apt = aptById(card.dataset.apt);
    if (k === 'new') { const meter = inp.closest('.meter').dataset.meter; inp.value = fmtNum(newIdx(ui.month, apt.id, meter)); }
    updateCard(apt.id);
  }
  function onLunaClick(ev) {
    const b = ev.target.closest('button[data-act]'); if (!b) return;
    const card = b.closest('.apt-card'); const apt = aptById(card.dataset.apt);
    if (b.dataset.act === 'reset-persons') { const e = entry(ui.month, apt.id); if (e) e.persons = null; }
    if (b.dataset.act === 'reset-old') { const meter = b.closest('.meter').dataset.meter; const r = reading(ui.month, apt.id, meter); if (r) r.old = null; }
    commit(); updateCard(apt.id, true);
  }
  function setMonth(mk) { ui.month = mk; renderTab(); }

  // ======================= FORMULAR (comun HTML + PDF) =======================
  function buildForm(mk, apt) {
    const p = effPersons(mk, apt).value;
    const rows = METERS.map((m) => {
      if (!apt.meters[m.key]) return { label: m.label, cells: ['–', '–', '–'] };
      return { label: m.label, cells: [fmtNum(effOld(mk, apt.id, m.key).value), fmtNum(newIdx(mk, apt.id, m.key)), fmtNum(consumption(mk, apt.id, m.key))] };
    });
    const t = totalFor(mk, apt);
    // Valoare completată: subliniată, cu spațiu în jur, ca o linie de formular completată.
    const fill = (v, n) => {
      if (!v) return { t: '_'.repeat(n) };
      const pad = ' '.repeat(v.length <= 3 ? 3 : 2);
      return { t: pad + v + pad, u: true, fill: true };
    };
    const lines = [
      [{ t: T.title, u: true }],
      [{ t: T.to, nb: true }, { t: T.assoc }],
      [{ t: T.apt }, fill(apt.number.trim(), BLANK.apt), { t: T.owner }, apt.owner.trim() ? { t: apt.owner.trim() } : { t: '_'.repeat(BLANK.owner) }],
      [{ t: T.period }, fill(effPeriod(mk).trim(), BLANK.period)],
      p != null ? [{ t: T.persons + ' ' }, fill(String(p))] : [{ t: T.persons }, { t: '_'.repeat(BLANK.persons) }],
    ];
    return { lines, rows, total: t.complete ? fmtNum(t.value) : '' };
  }

  let measureCtx = null;
  /** Lățimea unui rând în mm, la 12pt (bold, cu excepția porțiunilor nb). */
  function lineWidthMm(runs) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    const px = G.fontPt * 25.4 / 72; // 1 px = 1 mm
    let w = 0;
    for (const r of runs) { measureCtx.font = (r.nb ? '' : 'bold ') + px + 'px ' + FONT_STACK; w += measureCtx.measureText(r.t).width; }
    return w;
  }
  function fitFactor(runs) { const w = lineWidthMm(runs); const max = G.formW - 1; return w > max ? max / w : 1; }

  function formHTML(f) {
    const lines = f.lines.map((runs, i) => {
      const k = fitFactor(runs);
      const style = k < 1 ? ' style="font-size:' + (G.fontPt * k).toFixed(2) + 'pt"' : '';
      const inner = runs.map((r) => {
        const cls = [r.nb ? 'nb' : '', r.u && i > 0 ? 'val' : ''].filter(Boolean).join(' ');
        return cls ? '<span class="' + cls + '">' + esc(r.t) + '</span>' : esc(r.t);
      }).join('');
      return '<p' + (i === 0 ? ' class="title"' : '') + style + '>' + inner + '</p>';
    }).join('');
    const td = (s, extra) => '<td' + (extra || '') + '>' + esc(s) + '</td>';
    const body = f.rows.map((r) => '<tr>' + td(r.label) + r.cells.map((c) => td(c)).join('') + '</tr>').join('');
    return '<div class="form">' + lines +
      '<table><colgroup><col><col><col><col></colgroup>' +
      '<tr>' + T.head.map((h) => td(h)).join('') + '</tr>' + body +
      '<tr>' + td(T.sig, ' class="sig"') + td(T.total, ' colspan="2"') + td(f.total) + '</tr>' +
      '</table></div>';
  }

  function printSheets() {
    const per = data.settings.perSheet;
    const forms = data.apartments.filter((a) => a.print).map((a) => buildForm(ui.month, a));
    const sheets = [];
    for (let i = 0; i < forms.length; i += per) {
      const s = forms.slice(i, i + per); while (s.length < per) s.push(null); sheets.push(s);
    }
    return { per, sheets };
  }

  // ======================= TAB: TIPĂRIRE =======================
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isStandalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  let canShareFiles = false;
  try { canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] })); } catch (e) { /* */ }
  const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;

  function renderPrintControls() {
    $('#print-month-label').textContent = 'Luna selectată: ' + monthLabel(ui.month) + ' (se schimbă din secțiunea Lună).';
    $$('input[name="per-sheet"]').forEach((r) => { r.checked = Number(r.value) === data.settings.perSheet; });
    $('#print-include').innerHTML = data.apartments.length ? data.apartments.map((a) =>
      '<label class="check"><input type="checkbox" data-apt="' + a.id + '"' + (a.print ? ' checked' : '') + '> ' + esc(aptTitle(a)) + '</label>').join('')
      : '<p class="muted">Nu există apartamente.</p>';
    const none = !data.apartments.some((a) => a.print);
    $('#btn-print').disabled = none; $('#btn-pdf').disabled = none; $('#btn-share-pdf').disabled = none;
    $('#btn-share-pdf').hidden = !(canShareFiles && coarse);
    let hint = '';
    if (isIOS) hint = isStandalone
      ? 'Pe iPhone/iPad, din aplicația instalată, tipărirea directă poate să nu pornească. Folosește „Trimite PDF” și alege Tipărire (sau Salvează în Fișiere).'
      : 'Pe iPhone/iPad: „Tipărește” deschide dialogul iOS (AirPrint). Dacă nu merge, folosește „Trimite PDF”.';
    else if (isAndroid) hint = 'Pe Android: „Tipărește” deschide dialogul Chrome; alege imprimanta sau „Salvează ca PDF”. Verifică să fie A4 și scalare 100%.';
    else hint = 'În dialogul de tipărire alege A4, portret, margini „Niciuna” sau „Implicite” și scalare 100%. Dacă apar antet/subsol, debifează „Anteturi și subsoluri”.';
    $('#print-hint').textContent = hint;
  }
  function renderPrint() {
    const root = $('#print-root');
    const { per, sheets } = printSheets();
    if (!sheets.length) { root.innerHTML = '<p class="muted">Niciun apartament bifat pentru tipărire.</p>'; return; }
    root.innerHTML = sheets.map((slots) =>
      '<div class="sheet-frame"><div class="sheet" style="--per-sheet:' + per + '">' +
      slots.map((f, i) => '<div class="slot' + (f && i < per - 1 ? ' cut' : '') + '">' + (f ? formHTML(f) : '') + '</div>').join('') +
      '</div></div>').join('');
    sizeFrames();
  }
  function sizeFrames() {
    const root = $('#print-root'); if (root.hidden) return;
    const avail = Math.min(root.clientWidth - 32, 640);
    const sheetPx = 210 * 96 / 25.4;
    const s = Math.max(0.2, avail / sheetPx);
    $$('.sheet-frame', root).forEach((fr) => {
      fr.style.width = (sheetPx * s) + 'px';
      fr.style.height = (297 * 96 / 25.4 * s) + 'px';
      fr.firstElementChild.style.transform = 'scale(' + s + ')';
    });
  }
  function doPrint() {
    renderPrint();
    // lăsăm browserul să așeze foile înainte de a deschide dialogul
    setTimeout(() => {
      try { window.print(); } catch (e) { alert('Tipărirea nu este disponibilă aici. Folosește „Descarcă PDF”.'); }
    }, 50);
  }

  // ---------- PDF (canvas → imagine → PDF) ----------
  function drawSheetCanvas(slots, per, S) {
    const c = document.createElement('canvas');
    c.width = Math.round(210 * S); c.height = Math.round(297 * S);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000'; g.strokeStyle = '#000';
    const slotH = 297 / per;
    slots.forEach((f, i) => {
      const top = i * slotH;
      if (f) drawForm(g, S, f, top + (slotH - G.formH) / 2);
      if (f && i < per - 1) {
        g.save(); g.setLineDash([0.6 * S, 0.9 * S]); g.lineWidth = Math.max(1, 0.3 * S); g.strokeStyle = '#444';
        const y = (top + slotH) * S - g.lineWidth / 2;
        g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); g.restore();
      }
    });
    return c;
  }
  function drawForm(g, S, f, y0) {
    const x0 = (210 - G.formW) / 2, cx = 105;
    const fontPx = (k, bold) => (bold ? 'bold ' : '') + (G.fontPt * 25.4 / 72 * k * S).toFixed(2) + 'px ' + FONT_STACK;
    g.textBaseline = 'alphabetic';
    f.lines.forEach((runs, i) => {
      const k = fitFactor(runs);
      const y = y0 + i * (G.lineH + G.pGap);
      const base = (y + G.lineH / 2 + G.fontPt * 25.4 / 72 * k * 0.33) * S;
      let w = 0; const widths = runs.map((r) => { g.font = fontPx(k, !r.nb); const ww = g.measureText(r.t).width; w += ww; return ww; });
      let x = cx * S - w / 2;
      runs.forEach((r, j) => {
        g.font = fontPx(k, !r.nb); g.textAlign = 'left'; g.fillText(r.t, x, base);
        if (r.u) g.fillRect(x, base + (r.fill ? 1.0 : 0.45) * S, widths[j], Math.max(1, 0.22 * S));
        x += widths[j];
      });
    });
    // tabel
    const ty = y0 + 5 * (G.lineH + G.pGap);
    const cw = G.formW / 4, x1 = x0 + G.formW;
    const lw = Math.max(1, 0.18 * S);
    g.lineWidth = lw;
    const line = (xa, ya, xb, yb) => { g.beginPath(); g.moveTo(xa * S, ya * S); g.lineTo(xb * S, yb * S); g.stroke(); };
    for (let r = 0; r <= 4; r++) line(x0, ty + r * G.rowH, x1, ty + r * G.rowH);
    line(x0 + cw, ty + 5 * G.rowH, x1, ty + 5 * G.rowH);
    for (let ci = 0; ci <= 4; ci++) line(x0 + ci * cw, ty, x0 + ci * cw, ty + 4 * G.rowH);
    [1, 3, 4].forEach((ci) => line(x0 + ci * cw, ty + 4 * G.rowH, x0 + ci * cw, ty + 5 * G.rowH));
    const cell = (text, ci, ri, span) => {
      if (!text) return;
      const w = cw * (span || 1);
      let k = 1; g.font = fontPx(1, true);
      const tw = g.measureText(text).width / S; if (tw > w - 2 * G.cellPad) k = (w - 2 * G.cellPad) / tw;
      g.font = fontPx(k, true); g.textAlign = 'center';
      g.fillText(text, (x0 + ci * cw + w / 2) * S, (ty + ri * G.rowH + G.rowH / 2 + G.fontPt * 25.4 / 72 * k * 0.33) * S);
    };
    T.head.forEach((h, ci) => cell(h, ci, 0));
    f.rows.forEach((r, ri) => { cell(r.label, 0, ri + 1); r.cells.forEach((c, ci) => cell(c, ci + 1, ri + 1)); });
    cell(T.sig, 0, 4); cell(T.total, 1, 4, 2); cell(f.total, 3, 4);
  }
  async function makePdf() {
    const { per, sheets } = printSheets();
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { /* */ } }
    const S = 200 / 25.4; // 200 dpi
    const canvases = sheets.map((s) => drawSheetCanvas(s, per, S));
    const blob = await window.PdfMaker.buildPdf(canvases, 'Instiintare consum apa ' + ui.month);
    return { blob, name: 'instiintare-apa-' + ui.month + '.pdf' };
  }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function onPdf(share) {
    const btn = share ? $('#btn-share-pdf') : $('#btn-pdf');
    const old = btn.textContent; btn.disabled = true; btn.textContent = 'Se generează…';
    try {
      const { blob, name } = await makePdf();
      if (share) {
        const file = new File([blob], name, { type: 'application/pdf' });
        try { await navigator.share({ files: [file], title: name }); }
        catch (e) { if (e && e.name !== 'AbortError') downloadBlob(blob, name); }
      } else downloadBlob(blob, name);
    } catch (e) {
      alert('Nu am putut genera PDF-ul: ' + (e && e.message ? e.message : e));
    } finally { btn.disabled = false; btn.textContent = old; }
  }

  // ======================= GRAFIC CONSUM =======================
  const CHART_COLORS = { bucatarie: '#2a78d6', baie: '#eb6834', serviciu: '#1baf7a' };
  const MONTHS_SHORT = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'noi', 'dec'];
  const chartData = {};

  /** Ultimele 12 luni cu cel puțin un consum calculat, în ordine cronologică. */
  function chartSeries(apt) {
    const ms = activeMeters(apt);
    const out = [];
    for (const k of sortedKeys()) {
      const parts = ms.map((m) => { const c = consumption(k, apt.id, m.key); return { key: m.key, label: m.label, value: c }; });
      if (!parts.some((p) => p.value != null)) continue;
      const t = totalFor(k, apt);
      const pt = totalFor(shiftMonth(k, -12), apt);
      out.push({ mk: k, parts, total: parts.reduce((s, p) => s + (p.value > 0 ? p.value : 0), 0), complete: t.complete,
        prev: pt.complete && pt.value >= 0 ? pt.value : null });
    }
    return out.slice(-12);
  }

  function chartHTML(apt) {
    const series = chartSeries(apt);
    if (!series.length) return '';
    chartData[apt.id] = series;
    const ms = activeMeters(apt);
    const done = series.filter((s) => s.complete);
    const avg = done.length ? done.reduce((a, s) => a + s.total, 0) / done.length : null;
    const items = (ms.length > 1 ? ms.map((m) => '<span><i style="background:' + CHART_COLORS[m.key] + '"></i>' + m.label + '</span>') : [])
      .concat(series.some((s) => s.prev != null) ? ['<span><i class="lg-prev"></i>aceeași lună, anul trecut</span>'] : []);
    const legend = items.length ? '<div class="chart-legend">' + items.join('') + '</div>' : '';
    return '<div class="chart" data-chart="' + apt.id + '">' +
      '<p class="chart-sub muted">Consum lunar [m³]' + (avg != null ? ' · media: ' + (Math.round(avg * 10) / 10).toString().replace('.', ',') + ' m³/lună' : '') + '</p>' +
      legend + '<div class="chart-plot"></div><div class="chart-tip" hidden></div></div>';
  }

  /** Maximul axei: 4 intervale egale, pași întregi (1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 40, 50…). */
  function niceMax(v) {
    if (v <= 0) return 4;
    for (let mag = 1; ; mag *= 10) {
      for (const f of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5]) {
        const st = f * mag;
        if (Number.isInteger(st) && st * 4 >= v) return st * 4;
      }
    }
  }

  function drawCharts() {
    for (const el of $$('#history .chart')) {
      const series = chartData[el.dataset.chart];
      const plot = $('.chart-plot', el);
      const W = Math.max(260, Math.round(plot.clientWidth || 320)), H = 190;
      const padL = 30, padR = 6, padT = 18, padB = 34;
      const iw = W - padL - padR, ih = H - padT - padB;
      const maxV = niceMax(Math.max(...series.map((s) => Math.max(s.total, s.prev || 0))));
      const y = (v) => padT + ih - (v / maxV) * ih;
      const slot = iw / series.length;
      const bw = Math.min(36, slot * 0.62);
      let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Grafic consum lunar">';
      for (let i = 0; i <= 4; i++) {
        const v = (maxV / 4) * i, yy = Math.round(y(v)) + 0.5;
        svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + yy + '" y2="' + yy + '" class="' + (i ? 'grid' : 'base') + '"/>' +
          '<text x="' + (padL - 6) + '" y="' + (yy + 4) + '" class="ax" text-anchor="end">' + fmtNum(v) + '</text>';
      }
      const showEvery = slot < 30 ? 2 : 1;
      let lastYr = null;
      series.forEach((s, i) => {
        const cx = padL + slot * i + slot / 2, x = cx - bw / 2;
        let acc = 0;
        const segs = s.parts.filter((p) => p.value > 0);
        segs.forEach((p, j) => {
          const y0 = y(acc), y1 = y(acc + p.value);
          const top = j === segs.length - 1;
          const gap = j > 0 ? 2 : 0; // spațiu de 2px între segmente
          const h = Math.max(0, y0 - y1 - gap);
          const r = top ? Math.min(4, h, bw / 2) : 0;
          const yt = y1, yb = y1 + h;
          svg += r
            ? '<path fill="' + CHART_COLORS[p.key] + '" d="M' + x + ' ' + yb + 'V' + (yt + r) + 'Q' + x + ' ' + yt + ' ' + (x + r) + ' ' + yt + 'H' + (x + bw - r) + 'Q' + (x + bw) + ' ' + yt + ' ' + (x + bw) + ' ' + (yt + r) + 'V' + yb + 'Z"/>'
            : '<rect fill="' + CHART_COLORS[p.key] + '" x="' + x + '" y="' + yt + '" width="' + bw + '" height="' + h + '"/>';
          acc += p.value;
        });
        if (s.prev != null) svg += '<line class="prevmark" x1="' + (x - 3) + '" x2="' + (x + bw + 3) + '" y1="' + y(s.prev) + '" y2="' + y(s.prev) + '"/>';
        svg += '<text x="' + cx + '" y="' + (y(Math.max(s.total, 0)) - 5) + '" class="val" text-anchor="middle">' + fmtNum(s.total) + (s.complete ? '' : '*') + '</text>';
        if (i % showEvery === (series.length - 1) % showEvery) {
          const { y: yr, m } = mkParts(s.mk);
          svg += '<text x="' + cx + '" y="' + (H - padB + 15) + '" class="ax" text-anchor="middle">' + MONTHS_SHORT[m - 1] + '</text>';
          if (yr !== lastYr) svg += '<text x="' + cx + '" y="' + (H - padB + 28) + '" class="ax yr" text-anchor="middle">' + yr + '</text>';
          lastYr = yr;
        }
        svg += '<rect class="hit" data-i="' + i + '" x="' + (padL + slot * i) + '" y="' + padT + '" width="' + slot + '" height="' + (ih + padB) + '"/>';
      });
      svg += '</svg>';
      plot.innerHTML = svg;
      const note = series.some((s) => !s.complete);
      let n = $('.chart-note', el);
      if (note && !n) { n = document.createElement('p'); n.className = 'chart-note muted small'; n.textContent = '* lună incompletă (lipsește un index)'; el.appendChild(n); }
    }
  }

  function chartTip(e) {
    const hit = e.target.closest && e.target.closest('.chart .hit');
    const el = e.target.closest && e.target.closest('.chart');
    for (const t of $$('#history .chart-tip')) if (!el || t.parentNode !== el) t.hidden = true;
    for (const h of $$('#history .hit.on')) if (h !== hit) h.classList.remove('on');
    if (!el) return;
    const tip = $('.chart-tip', el);
    if (!hit) { tip.hidden = true; return; }
    hit.classList.add('on');
    const s = chartData[el.dataset.chart][Number(hit.dataset.i)];
    tip.innerHTML = '<strong>' + esc(monthLabel(s.mk)) + '</strong>' +
      s.parts.map((p) => '<div><i style="background:' + CHART_COLORS[p.key] + '"></i>' + esc(p.label) + '<b>' + (p.value == null ? '—' : fmtNum(p.value)) + '</b></div>').join('') +
      (s.parts.length > 1 ? '<div class="tot">Total<b>' + fmtNum(s.total) + (s.complete ? '' : '*') + ' m³</b></div>' : '') +
      (s.prev != null ? '<div class="tot">' + esc(monthLabel(shiftMonth(s.mk, -12))) + '<b>' + fmtNum(s.prev) + ' m³</b></div>' +
        (s.complete && s.prev > 0 ? '<div>Diferență<b>' + esc(fmtDiff(s.total - s.prev, ((s.total - s.prev) / s.prev) * 100)) + '</b></div>' : '') : '');
    tip.hidden = false;
    const box = el.getBoundingClientRect(), hb = hit.getBoundingClientRect();
    const tw = tip.offsetWidth;
    let left = hb.left - box.left + hb.width / 2 - tw / 2;
    left = Math.max(0, Math.min(box.width - tw, left));
    tip.style.left = left + 'px';
  }

  // ======================= TAB: ISTORIC =======================
  function renderHistory() {
    const box = $('#history');
    if (!data.apartments.length) { box.innerHTML = '<p class="muted">Nu există apartamente.</p>'; return; }
    box.innerHTML = data.apartments.map((apt) => {
      const ms = activeMeters(apt);
      const keys = sortedKeys().filter((k) => entryHasData(entry(k, apt.id))).reverse();
      if (!keys.length) return '<div class="card"><h2>' + esc(aptTitle(apt)) + '</h2><p class="muted">Nicio lună completată încă.</p></div>';
      const head = '<tr><th>Luna</th><th>Pers.</th>' + ms.map((m) => '<th>' + m.label + '<br>index nou</th><th>consum</th>').join('') + '<th>Total</th><th>față de anul trecut</th><th></th></tr>';
      const rows = keys.map((k) => {
        const v = validate(k, apt);
        const cls = v.some((x) => x.level === 'error') ? 'flag flag-err' : (v.length ? 'flag' : '');
        const t = totalFor(k, apt);
        const p = effPersons(k, apt).value;
        return '<tr class="' + cls + '"' + (v.length ? ' title="' + esc(v.map((x) => x.text).join('\n')) + '"' : '') + '>' +
          '<td>' + monthLabel(k) + '</td><td>' + (p == null ? '' : p) + '</td>' +
          ms.map((m) => '<td>' + fmtNum(newIdx(k, apt.id, m.key)) + '</td><td>' + fmtNum(consumption(k, apt.id, m.key)) + '</td>').join('') +
          '<td><strong>' + (t.complete ? fmtNum(t.value) : '') + '</strong></td>' +
          '<td class="yoy">' + (() => { const y = yoy(k, apt); return y ? esc(fmtDiff(y.diff, y.pct)) : ''; })() + '</td>' +
          '<td><button type="button" class="btn small" data-open="' + k + '">Deschide</button></td></tr>';
      }).join('');
      return '<div class="card"><h2>' + esc(aptTitle(apt)) + '</h2>' + chartHTML(apt) + '<div class="table-wrap"><table class="hist"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div></div>';
    }).join('');
    drawCharts();
  }

  // ======================= TAB: APARTAMENTE =======================
  function renderApts() {
    $('#apt-list').innerHTML = data.apartments.map((a, idx) =>
      '<div class="card apt-edit" data-apt="' + a.id + '">' +
      '<h2>Apartament ' + (idx + 1) + '</h2>' +
      '<div class="grid2">' +
      '<div class="field"><label for="an-' + a.id + '">Nr. apartament</label><input id="an-' + a.id + '" type="text" inputmode="numeric" autocomplete="off" data-f="number" value="' + esc(a.number) + '"></div>' +
      '<div class="field"><label for="ao-' + a.id + '">Nume și prenume proprietar</label><input id="ao-' + a.id + '" type="text" autocomplete="off" autocapitalize="characters" data-f="owner" value="' + esc(a.owner) + '"></div>' +
      '<div class="field"><label for="ap-' + a.id + '">Persoane (implicit)</label><input id="ap-' + a.id + '" class="num" type="text" inputmode="numeric" autocomplete="off" data-f="defaultPersons" value="' + (a.defaultPersons == null ? '' : a.defaultPersons) + '"></div>' +
      '</div>' +
      '<fieldset class="field"><legend>Contoare active</legend><div class="meters-check">' +
      METERS.map((m) => '<label class="check"><input type="checkbox" data-meter="' + m.key + '"' + (a.meters[m.key] ? ' checked' : '') + '> ' + m.label + '</label>').join('') +
      '</div></fieldset>' +
      '<label class="check"><input type="checkbox" data-f="print"' + (a.print ? ' checked' : '') + '> Include la tipărire</label>' +
      '<div class="actions"><button type="button" class="btn danger small" data-del="' + a.id + '">Șterge apartamentul</button></div>' +
      '</div>').join('') || '<p class="muted">Nu există apartamente.</p>';
  }
  function onAptInput(ev) {
    const t = ev.target; const card = t.closest('.apt-edit'); if (!card) return;
    const a = aptById(card.dataset.apt); if (!a) return;
    if (t.dataset.meter) a.meters[t.dataset.meter] = t.checked;
    else if (t.dataset.f === 'print') a.print = t.checked;
    else if (t.dataset.f === 'number') a.number = t.value;
    else if (t.dataset.f === 'owner') a.owner = t.value;
    else if (t.dataset.f === 'defaultPersons') {
      const r = parseIntField(t.value); t.classList.toggle('invalid', !r.ok); if (!r.ok) return;
      a.defaultPersons = r.value;
    } else return;
    commit();
  }
  // Mesaj scurt, neblocant, cu „Anulează”. Înlocuiește ferestrele de confirmare la ștergere.
  let toastTimer = null, toastUndo = null;
  function showUndo(text, undo, ms) {
    toastUndo = undo;
    $('#toast-text').textContent = text;
    $('#toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms || 12000);
  }
  function hideToast() { clearTimeout(toastTimer); toastUndo = null; $('#toast').hidden = true; }
  function onAptClick(ev) {
    const b = ev.target.closest('[data-del]'); if (!b) return;
    const a = aptById(b.dataset.del); if (!a) return;
    const idx = data.apartments.indexOf(a);
    const removed = [];
    for (const [mk, mo] of Object.entries(data.months)) if (mo.apts[a.id]) removed.push({ mk, period: mo.period, e: JSON.parse(JSON.stringify(mo.apts[a.id])) });
    data.apartments = data.apartments.filter((x) => x.id !== a.id);
    for (const mk of Object.keys(data.months)) { delete data.months[mk].apts[a.id]; cleanupMonth(mk); }
    commit(); renderApts();
    showUndo('„' + aptTitle(a) + '” a fost șters, cu toate indexurile lui.', () => {
      if (aptById(a.id)) return;
      data.apartments.splice(Math.min(idx, data.apartments.length), 0, a);
      for (const r of removed) {
        const mo = data.months[r.mk] || (data.months[r.mk] = { period: r.period || null, apts: {} });
        mo.apts[a.id] = r.e;
      }
      commit(); renderApts(); renderTab();
    });
  }

  // ======================= TAB: DATE =======================
  function fmtTime(iso) { if (!iso) return 'niciodată'; try { return new Date(iso).toLocaleString('ro-RO'); } catch (e) { return iso; } }
  function renderDate() {
    const st = window.Sync.status(), inf = window.Sync.info();
    let txt;
    if (!inf.configured) txt = 'Sincronizarea nu este configurată: completează GOOGLE_CLIENT_ID în fișierul config.js (vezi README). Datele se păstrează doar în acest browser.';
    else if (!inf.connected) txt = 'Datele sunt salvate doar pe acest dispozitiv. Conectează Google Drive ca să le ai și pe celelalte dispozitive.';
    else txt = 'Stare: ' + st.text + '. Ultima sincronizare: ' + fmtTime(inf.lastSyncAt) + '.' + (inf.error ? ' Detalii: ' + inf.error : '') +
      (inf.dirty ? ' Există modificări locale care nu au ajuns încă în Drive.' : '');
    $('#sync-detail').textContent = txt;
    const btnC = $('#btn-connect');
    btnC.hidden = !inf.configured || (inf.connected && inf.hasToken);
    btnC.textContent = inf.connected ? 'Reconectează Google Drive' : 'Conectează Google Drive';
    $('#btn-sync-now').hidden = !inf.connected;
    $('#backup-card').hidden = !inf.connected;
    $('#backup-info').textContent = inf.lastBackupDay
      ? 'Ultima copie făcută automat: ' + inf.lastBackupDay + '. Se face câte una pe zi, la prima salvare, și se păstrează 14 zile plus începutul fiecărei luni din ultimul an.'
      : 'Prima copie se face automat la următoarea salvare în Drive. Se face câte una pe zi.';
    $('#btn-disconnect').hidden = !inf.connected;
    $('#app-version').textContent = 'Versiune ' + APP_VERSION;
  }
  async function showBackups() {
    const box = $('#backup-list'), btn = $('#btn-backups');
    btn.disabled = true; box.innerHTML = '<p class="muted">Se încarcă…</p>';
    try {
      const list = await window.Sync.listBackups();
      box.innerHTML = list.length
        ? '<ul class="backup-list">' + list.map((b) => '<li><span>' + esc(b.day) + '</span><button type="button" class="btn small" data-restore="' + esc(b.id) + '" data-day="' + esc(b.day) + '">Restaurează</button></li>').join('') + '</ul>'
        : '<p class="muted">Nu există încă nicio copie.</p>';
    } catch (e) { box.innerHTML = '<p class="muted">Nu am putut citi copiile: ' + esc(e.message || e) + '</p>'; }
    btn.disabled = false;
  }
  async function restoreBackup(id, day) {
    let parsed;
    try { parsed = normalize(await window.Sync.fetchBackup(id)); } catch (e) { alert('Nu am putut citi copia: ' + (e.message || e)); return; }
    const nM = Object.keys(parsed.months).length;
    if (!confirm('Restaurezi copia din ' + day + '?\n\nConține ' + parsed.apartments.length + ' apartamente și ' + nM + ' luni. Datele actuale sunt înlocuite (poți anula imediat după).')) return;
    const before = JSON.parse(JSON.stringify(data));
    data = parsed; commit(); renderTab();
    showUndo('Am restaurat copia din ' + day + '.', () => { data = normalize(before); commit(); renderTab(); }, 20000);
  }
  function exportJson() {
    const d = new Date();
    const name = 'evidenta-apa-' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + '.json';
    downloadBlob(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), name);
  }
  async function importJson(file) {
    let parsed;
    try { parsed = normalize(JSON.parse(await file.text())); } catch (e) { alert('Fișier invalid: ' + e.message); return; }
    const nM = Object.keys(parsed.months).length;
    if (!confirm('Import: ' + parsed.apartments.length + ' apartamente, ' + nM + ' luni.\n\nToate datele actuale vor fi ÎNLOCUITE (și în Google Drive, dacă este conectat). Continui?')) return;
    data = parsed; commit(); renderTab();
    alert('Datele au fost importate.');
  }

  // ======================= ÎMBINARE ȘI AVIZE =======================
  // Nu există ferestre care să întrerupă introducerea. Dacă la sincronizare două
  // dispozitive au schimbat aceeași valoare, câștigă cea mai recentă și afișăm
  // o notă (neblocantă) cu ce a fost înlocuit.
  const LS_NOTE = 'evidenta-apa:mergenote';
  const noteVal = (v) => (v == null ? 'gol' : typeof v === 'boolean' ? (v ? 'da' : 'nu') : String(v));
  function describeNote(n, d) {
    const p = n.path;
    const aptName = (id) => { const a = d.apartments.find((x) => x.id === id); return a && a.number.trim() ? 'Ap. ' + a.number.trim() : 'apartament'; };
    const meterLabel = (k) => (METERS.find((m) => m.key === k) || { label: k }).label;
    const FIELD = { number: 'număr', owner: 'proprietar', defaultPersons: 'persoane implicit', print: 'include la tipărire' };
    let label;
    if (p[0] === 's') label = 'Formulare pe foaie';
    else if (p[0] === 'a') label = aptName(p[1]) + ' · ' + (p[2] === 'm' ? 'contor ' + meterLabel(p[3]) : FIELD[p[2]] || p[2]);
    else if (p[2] === 'period') label = monthLabel(p[1]) + ' · perioada';
    else if (p[3] === 'persons') label = aptName(p[2]) + ' · ' + monthLabel(p[1]) + ' · persoane';
    else label = aptName(p[2]) + ' · ' + monthLabel(p[1]) + ' · ' + meterLabel(p[4]) + ' · index ' + (p[5] === 'old' ? 'vechi' : 'nou');
    return n.kept === 'local'
      ? label + ': ai păstrat ' + noteVal(n.local) + ' (introdus aici); pe celălalt dispozitiv era ' + noteVal(n.remote) + '.'
      : label + ': valoarea de aici (' + noteVal(n.local) + ') a fost înlocuită cu ' + noteVal(n.remote) + ', introdusă mai recent pe celălalt dispozitiv.';
  }
  function readNote() { try { return JSON.parse(localStorage.getItem(LS_NOTE)); } catch (e) { return null; } }
  function renderNotice() {
    const note = readNote();
    const box = $('#notice'); box.hidden = !note;
    if (note) {
      $('#notice-text').textContent = 'Am îmbinat modificările de pe celălalt dispozitiv cu ale tale. ' +
        note.items.length + (note.items.length === 1 ? ' valoare a fost schimbată pe ambele; ' : ' valori au fost schimbate pe ambele; ') +
        'a rămas cea mai recentă.';
      $('#notice-list').innerHTML = note.items.map((t) => '<li>' + esc(t) + '</li>').join('');
    }
    $('#auth-notice').hidden = window.Sync.status().code !== 'auth';
  }
  function onMerge(notes, d) {
    const prev = readNote();
    const items = (prev ? prev.items : []).concat(notes.map((n) => describeNote(n, d))).slice(-50);
    try { localStorage.setItem(LS_NOTE, JSON.stringify({ at: new Date().toISOString(), items })); } catch (e) { /* */ }
    renderNotice();
  }

  // Datele aduse din Drive nu se desenează cât timp utilizatorul scrie într-un câmp:
  // formularul s-ar reconstrui și ar pierde cursorul.
  let pendingRender = false;
  function isEditing() {
    const a = document.activeElement;
    return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !!a.closest('main');
  }
  function applyRemote(d) {
    data = normalize(d); saveLocal();
    if (isEditing()) pendingRender = true; else renderTab();
  }
  document.addEventListener('focusout', () => {
    if (!pendingRender) return;
    setTimeout(() => { if (pendingRender && !isEditing()) { pendingRender = false; renderTab(); } }, 250);
  });

  // ======================= NAVIGARE / RANDARE =======================
  function renderTab() {
    $$('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab)));
    $$('.tab').forEach((s) => { s.hidden = s.id !== 'tab-' + ui.tab; });
    $('#print-root').hidden = ui.tab !== 'tiparire';
    if (ui.tab === 'luna') renderLuna();
    if (ui.tab === 'tiparire') { renderPrintControls(); renderPrint(); }
    if (ui.tab === 'istoric') renderHistory();
    if (ui.tab === 'apartamente') renderApts();
    if (ui.tab === 'date') renderDate();
    renderDueBanner();
  }
  function setTab(t) { ui.tab = t; saveUi(); renderTab(); window.scrollTo(0, 0); }
  function goDue() {
    const box = $('#due-notice'); const mk = box.dataset.month; if (!mk) return;
    ui.month = mk; setTab('luna');
    const first = missingFor(mk)[0]; if (first) gotoApt(first.apt.id);
  }

  function onStatus(st) {
    const b = $('#sync-badge'); b.textContent = st.text; b.dataset.code = st.code;
    $('#auth-notice').hidden = st.code !== 'auth';
    if (ui.tab === 'date') renderDate();
  }
  async function connect() {
    try { await window.Sync.connect(); } catch (e) { alert(e.message || String(e)); }
    if (ui.tab === 'date') renderDate();
  }

  function bind() {
    $$('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    $('#month-prev').addEventListener('click', () => setMonth(shiftMonth(ui.month, -1)));
    $('#month-next').addEventListener('click', () => setMonth(shiftMonth(ui.month, 1)));
    $('#month-sel').addEventListener('change', (e) => setMonth(mkFrom(mkParts(ui.month).y, Number(e.target.value))));
    $('#year-sel').addEventListener('change', (e) => setMonth(mkFrom(Number(e.target.value), mkParts(ui.month).m)));
    $('#period').addEventListener('input', (e) => {
      const v = e.target.value.trim();
      const val = !v || v === autoPeriod(ui.month) ? null : e.target.value;
      if (val != null && !data.months[ui.month]) data.months[ui.month] = { period: null, apts: {} };
      if (data.months[ui.month]) data.months[ui.month].period = val;
      commit(); $('#period-reset').hidden = val == null;
    });
    $('#period').addEventListener('blur', renderPeriod);
    $('#period-reset').addEventListener('click', () => { if (data.months[ui.month]) data.months[ui.month].period = null; commit(); renderPeriod(); });
    const ma = $('#month-apts');
    ma.addEventListener('input', onLunaInput);
    ma.addEventListener('change', (e) => { if (e.target.dataset.k === 'print') onLunaInput(e); });
    ma.addEventListener('focusout', onLunaBlur);
    ma.addEventListener('click', onLunaClick);
    ma.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
      const all = $$('#month-apts input[type="text"]'); const i = all.indexOf(e.target);
      if (i >= 0 && all[i + 1]) { e.preventDefault(); all[i + 1].focus(); all[i + 1].select(); }
    });

    $$('input[name="per-sheet"]').forEach((r) => r.addEventListener('change', () => { data.settings.perSheet = Number(r.value); commit(); renderPrint(); }));
    $('#print-include').addEventListener('change', (e) => {
      const a = aptById(e.target.dataset.apt); if (!a) return; a.print = e.target.checked; commit(); renderPrintControls(); renderPrint();
    });
    $('#btn-print').addEventListener('click', doPrint);
    $('#btn-pdf').addEventListener('click', () => onPdf(false));
    $('#btn-share-pdf').addEventListener('click', () => onPdf(true));
    window.addEventListener('beforeprint', () => { if (!$('#print-root').hidden) renderPrint(); });
    window.addEventListener('resize', sizeFrames);
    let chartRz; window.addEventListener('resize', () => { clearTimeout(chartRz); chartRz = setTimeout(() => { if (ui.tab === 'istoric') drawCharts(); }, 150); });
    document.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') chartTip(e); });
    document.addEventListener('click', chartTip);

    $('#history').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) { ui.month = b.dataset.open; setTab('luna'); } });

    const al = $('#apt-list');
    al.addEventListener('input', onAptInput);
    al.addEventListener('change', (e) => { if (e.target.type === 'checkbox') onAptInput(e); });
    al.addEventListener('click', onAptClick);
    $('#apt-add').addEventListener('click', () => {
      data.apartments.push(newApt()); commit(); renderApts();
      const inp = $$('#apt-list [data-f="number"]').pop(); if (inp) inp.focus();
    });

    $('#btn-connect').addEventListener('click', connect);
    $('#btn-sync-now').addEventListener('click', () => window.Sync.syncNow());
    $('#btn-disconnect').addEventListener('click', () => {
      if (confirm('Deconectezi Google Drive pe acest dispozitiv? Datele rămân aici și în Drive; doar sincronizarea se oprește.')) { window.Sync.disconnect(); renderDate(); }
    });
    $('#btn-backups').addEventListener('click', showBackups);
    $('#backup-list').addEventListener('click', (e) => { const b = e.target.closest('[data-restore]'); if (b) restoreBackup(b.dataset.restore, b.dataset.day); });
    $('#toast-undo').addEventListener('click', () => { const u = toastUndo; hideToast(); if (u) u(); });
    $('#month-status').addEventListener('click', (e) => { const b = e.target.closest('[data-goto]'); if (b) gotoApt(b.dataset.goto); });
    $('#due-go').addEventListener('click', goDue);
    $('#due-later').addEventListener('click', () => { dueDismissed = true; renderDueBanner(); });
    $('#due-text').addEventListener('click', (e) => { const b = e.target.closest('[data-goto]'); if (b) { ui.month = $('#due-notice').dataset.month; setTab('luna'); gotoApt(b.dataset.goto); } });
    $('#btn-export').addEventListener('click', exportJson);
    $('#import-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importJson(f); });

    $('#sync-badge').addEventListener('click', () => {
      const st = window.Sync.status();
      if (st.code === 'auth') connect();
      else if (st.code === 'error' || st.code === 'pending') window.Sync.syncNow();
      else setTab('date');
    });
    $('#auth-notice-btn').addEventListener('click', connect);
    $('#notice-close').addEventListener('click', () => { try { localStorage.removeItem(LS_NOTE); } catch (e) { /* */ } renderNotice(); });
  }

  // ======================= PORNIRE =======================
  bind();
  window.Sync.init({
    getData: () => data,
    setData: applyRemote,
    merge: (b, l, r) => window.Merge.merge(b, l, r),
    isPristine,
    onStatus,
    onMerge,
  });
  renderTab();
  renderNotice();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => { /* */ }));
  }

  // pentru teste
  window.__app = { dueMonth, renderDueBanner, get data() { return data; }, ui, normalize, parseNum, fmtNum, buildForm, makePdf, renderTab, setTab, setMonth, validate, isPristine };
})();
