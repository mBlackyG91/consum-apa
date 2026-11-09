/* Evidența lunară a consumului de apă — logica aplicației. */
(function () {
  'use strict';

  const APP_VERSION = '1.1.1';
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
  function validate(mk, apt) {
    const out = [];
    const ms = activeMeters(apt);
    const started = ms.some((m) => newIdx(mk, apt.id, m.key) != null);
    for (const m of ms) {
      const o = effOld(mk, apt.id, m.key).value, n = newIdx(mk, apt.id, m.key);
      if (o != null && n != null && n < o) {
        out.push({ level: 'error', meter: m.key, text: m.label + ': indexul nou (' + fmtNum(n) + ') este mai mic decât cel vechi (' + fmtNum(o) + ').' });
      } else if (o != null && n != null) {
        const c = roundIdx(n - o), a = avgPrev(mk, apt.id, m.key);
        if (a && a.avg > 0 && c > 2 * a.avg) {
          out.push({ level: 'warn', meter: m.key, text: m.label + ': consum ' + fmtNum(c) + ' m³, peste dublul mediei lunilor anterioare (' + fmtNum(a.avg) + ' m³).' });
        }
      }
      if (started && n == null) out.push({ level: 'warn', meter: m.key, text: 'Lipsește indexul nou pentru ' + m.label + '.' });
      if (started && n != null && o == null) out.push({ level: 'warn', meter: m.key, text: 'Lipsește indexul vechi pentru ' + m.label + ' (nu există lună anterioară; introdu-l manual).' });
    }
    return out;
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

  // ======================= TAB: ISTORIC =======================
  function renderHistory() {
    const box = $('#history');
    if (!data.apartments.length) { box.innerHTML = '<p class="muted">Nu există apartamente.</p>'; return; }
    box.innerHTML = data.apartments.map((apt) => {
      const ms = activeMeters(apt);
      const keys = sortedKeys().filter((k) => entryHasData(entry(k, apt.id))).reverse();
      if (!keys.length) return '<div class="card"><h2>' + esc(aptTitle(apt)) + '</h2><p class="muted">Nicio lună completată încă.</p></div>';
      const head = '<tr><th>Luna</th><th>Pers.</th>' + ms.map((m) => '<th>' + m.label + '<br>index nou</th><th>consum</th>').join('') + '<th>Total</th><th></th></tr>';
      const rows = keys.map((k) => {
        const v = validate(k, apt);
        const cls = v.some((x) => x.level === 'error') ? 'flag flag-err' : (v.length ? 'flag' : '');
        const t = totalFor(k, apt);
        const p = effPersons(k, apt).value;
        return '<tr class="' + cls + '"' + (v.length ? ' title="' + esc(v.map((x) => x.text).join('\n')) + '"' : '') + '>' +
          '<td>' + monthLabel(k) + '</td><td>' + (p == null ? '' : p) + '</td>' +
          ms.map((m) => '<td>' + fmtNum(newIdx(k, apt.id, m.key)) + '</td><td>' + fmtNum(consumption(k, apt.id, m.key)) + '</td>').join('') +
          '<td><strong>' + (t.complete ? fmtNum(t.value) : '') + '</strong></td>' +
          '<td><button type="button" class="btn small" data-open="' + k + '">Deschide</button></td></tr>';
      }).join('');
      return '<div class="card"><h2>' + esc(aptTitle(apt)) + '</h2><div class="table-wrap"><table class="hist"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div></div>';
    }).join('');
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
  function onAptClick(ev) {
    const b = ev.target.closest('[data-del]'); if (!b) return;
    const a = aptById(b.dataset.del); if (!a) return;
    if (!confirm('Ștergi „' + aptTitle(a) + '”?\nSe șterg și toate indexurile lui din toate lunile. Operația nu poate fi anulată (doar dintr-un export JSON).')) return;
    data.apartments = data.apartments.filter((x) => x.id !== a.id);
    for (const mk of Object.keys(data.months)) { delete data.months[mk].apts[a.id]; cleanupMonth(mk); }
    commit(); renderApts();
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
    $('#btn-disconnect').hidden = !inf.connected;
    $('#app-version').textContent = 'Versiune ' + APP_VERSION;
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

  // ======================= CONFLICT =======================
  let conflictInfo = null;
  function summary(d, modified) {
    let n;
    try { n = normalize(d); } catch (e) { return '<p>Date ilizibile.</p>'; }
    const keys = Object.keys(n.months).sort();
    const last = keys.length ? monthLabel(keys[keys.length - 1]) : '—';
    return '<ul><li>Apartamente: ' + n.apartments.map((a) => esc(a.number || '?')).join(', ') + '</li>' +
      '<li>Luni cu date: ' + keys.length + '</li><li>Ultima lună: ' + last + '</li>' +
      '<li>Modificat: ' + fmtTime(modified || n.updatedAt) + '</li></ul>';
  }
  function openConflict(c) {
    conflictInfo = c;
    $('#conflict-text').textContent = c.firstOnDevice
      ? 'În Google Drive există deja un fișier cu date, iar pe acest dispozitiv ai date care nu au fost salvate în Drive. Alege ce versiune păstrezi.'
      : 'Fișierul din Google Drive a fost modificat de pe alt dispozitiv, iar aici ai modificări nesincronizate. Alege ce versiune păstrezi; cealaltă se pierde.';
    $('#conflict-remote').innerHTML = summary(c.remoteData, c.remoteModifiedTime);
    $('#conflict-local').innerHTML = summary(data);
    const dlg = $('#conflict-dlg');
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
  }
  function closeConflict() { const dlg = $('#conflict-dlg'); if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }

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
  }
  function setTab(t) { ui.tab = t; saveUi(); renderTab(); window.scrollTo(0, 0); }

  function onStatus(st) {
    const b = $('#sync-badge'); b.textContent = st.text; b.dataset.code = st.code;
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
    $('#btn-export').addEventListener('click', exportJson);
    $('#import-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importJson(f); });

    $('#sync-badge').addEventListener('click', () => {
      const st = window.Sync.status();
      if (st.code === 'auth') connect();
      else if (st.code === 'error') window.Sync.syncNow();
      else if (st.code === 'conflict' && conflictInfo) openConflict(conflictInfo);
      else setTab('date');
    });
    $('#conflict-use-remote').addEventListener('click', () => {
      if (!confirm('Modificările de pe acest dispozitiv care nu sunt în Drive se vor pierde. Continui?')) return;
      closeConflict(); conflictInfo = null; window.Sync.resolveConflict('remote');
    });
    $('#conflict-use-local').addEventListener('click', () => {
      if (!confirm('Fișierul din Drive va fi înlocuit cu datele de pe acest dispozitiv. Continui?')) return;
      closeConflict(); conflictInfo = null; window.Sync.resolveConflict('local');
    });
    $('#conflict-export').addEventListener('click', exportJson);
  }

  // ======================= PORNIRE =======================
  bind();
  window.Sync.init({
    getData: () => data,
    setData: (d) => { data = normalize(d); saveLocal(); renderTab(); },
    isPristine,
    onStatus,
    onConflict: openConflict,
  });
  renderTab();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => { /* */ }));
  }

  // pentru teste
  window.__app = { get data() { return data; }, ui, normalize, parseNum, fmtNum, buildForm, makePdf, renderTab, setTab, setMonth, validate, isPristine };
})();
