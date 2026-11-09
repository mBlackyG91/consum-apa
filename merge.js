/* Îmbinare cu 3 surse (baza = ultima versiune sincronizată, local, Drive).
 *
 * Datele se desfac în „valori frunză” (ex. indexul nou al contorului „baie”
 * din apartamentul X, luna Y). Pentru fiecare frunză:
 *   - doar o parte a schimbat-o față de bază  -> se ia schimbarea;
 *   - ambele au ajuns la aceeași valoare       -> nicio problemă;
 *   - ambele au schimbat-o diferit             -> câștigă cea mai recentă
 *     modificare (după `updatedAt`) și se întoarce o notă, ca utilizatorul să
 *     vadă ce valoare a fost înlocuită. Nimic nu se pierde în tăcere.
 * Funcția este pură (fără DOM, fără rețea) ca să poată fi testată separat.
 */
(function (root) {
  'use strict';

  const SEP = JSON.stringify;

  function flatten(d) {
    const m = new Map();
    if (!d) return m;
    const set = (path, v) => { if (v !== null && v !== undefined) m.set(SEP(path), v); };
    if (d.settings) set(['s', 'perSheet'], d.settings.perSheet);
    for (const a of d.apartments || []) {
      set(['a', a.id, '*'], 1);
      set(['a', a.id, 'number'], a.number);
      set(['a', a.id, 'owner'], a.owner);
      set(['a', a.id, 'defaultPersons'], a.defaultPersons);
      set(['a', a.id, 'print'], a.print !== false);
      for (const k of Object.keys(a.meters || {})) set(['a', a.id, 'm', k], !!a.meters[k]);
    }
    for (const [mk, mv] of Object.entries(d.months || {})) {
      if (!mv) continue;
      set(['m', mk, 'period'], mv.period);
      for (const [aid, e] of Object.entries(mv.apts || {})) {
        if (!e) continue;
        set(['m', mk, aid, 'persons'], e.persons);
        for (const [mt, r] of Object.entries(e.readings || {})) {
          if (!r) continue;
          set(['m', mk, aid, 'r', mt, 'old'], r.old);
          set(['m', mk, aid, 'r', mt, 'new'], r.new);
        }
      }
    }
    return m;
  }

  /** Apartamente create independent pe două dispozitive (alt id, același număr) se unesc. */
  function remapRemote(base, local, remote) {
    const known = new Set([...(base ? base.apartments : []), ...local.apartments].map((a) => a.id));
    const byNumber = new Map();
    for (const a of local.apartments) { const n = String(a.number || '').trim(); if (n && !byNumber.has(n)) byNumber.set(n, a.id); }
    const map = new Map();
    for (const a of remote.apartments) {
      if (known.has(a.id)) continue;
      const n = String(a.number || '').trim();
      const target = n && byNumber.get(n);
      if (target && !map.has(target) && !remote.apartments.some((x) => x.id === target)) map.set(a.id, target);
    }
    if (!map.size) return remote;
    const out = JSON.parse(JSON.stringify(remote));
    for (const a of out.apartments) if (map.has(a.id)) a.id = map.get(a.id);
    for (const mo of Object.values(out.months || {})) {
      for (const [aid, e] of Object.entries(mo.apts || {})) {
        if (map.has(aid)) { mo.apts[map.get(aid)] = e; delete mo.apts[aid]; }
      }
    }
    return out;
  }

  function merge(baseIn, localIn, remoteIn) {
    const base = baseIn || null;
    const local = localIn;
    const remote = remapRemote(base, local, remoteIn);
    const localWins = String(local.updatedAt || '') >= String(remote.updatedAt || '');
    const fb = flatten(base), fl = flatten(local), fr = flatten(remote);
    const keys = new Set([...fb.keys(), ...fl.keys(), ...fr.keys()]);
    const merged = new Map();
    const notes = [];
    for (const k of keys) {
      const b = fb.get(k), l = fl.get(k), r = fr.get(k);
      let v;
      if (l === r) v = l;
      else if (l === b) v = r;
      else if (r === b) v = l;
      else {
        v = localWins ? l : r;
        notes.push({ path: JSON.parse(k), local: l === undefined ? null : l, remote: r === undefined ? null : r, kept: localWins ? 'local' : 'remote' });
      }
      if (v !== undefined) merged.set(k, v);
    }

    // ---- reconstruire ----
    const order = [];
    for (const src of [local, remote, base]) for (const a of (src && src.apartments) || []) if (!order.includes(a.id)) order.push(a.id);
    const apts = new Map();
    for (const [k, v] of merged) {
      const p = JSON.parse(k);
      if (p[0] !== 'a') continue;
      const id = p[1];
      if (!apts.has(id)) apts.set(id, { id, number: '', owner: '', defaultPersons: null, meters: {}, print: true, _live: false });
      const a = apts.get(id);
      if (p[2] === '*') a._live = true;
      else if (p[2] === 'm') a.meters[p[3]] = v;
      else a[p[2]] = v;
    }
    const apartments = order.filter((id) => apts.has(id) && apts.get(id)._live).map((id) => {
      const a = apts.get(id); delete a._live; return a;
    });
    const alive = new Set(apartments.map((a) => a.id));
    const months = {};
    for (const [k, v] of merged) {
      const p = JSON.parse(k);
      if (p[0] !== 'm') continue;
      const mk = p[1];
      const mo = months[mk] || (months[mk] = { period: null, apts: {} });
      if (p[2] === 'period') { mo.period = v; continue; }
      const aid = p[2];
      if (!alive.has(aid)) continue; // apartament șters: intrările lui dispar
      const e = mo.apts[aid] || (mo.apts[aid] = { persons: null, readings: {} });
      if (p[3] === 'persons') e.persons = v;
      else if (p[3] === 'r') {
        const r = e.readings[p[4]] || (e.readings[p[4]] = { old: null, new: null });
        r[p[5]] = v;
      }
    }
    for (const [mk, mo] of Object.entries(months)) if (!mo.period && !Object.keys(mo.apts).length) delete months[mk];

    const ua = [local.updatedAt, remote.updatedAt].filter(Boolean).sort().pop() || null;
    const perSheet = merged.get(SEP(['s', 'perSheet']));
    return {
      data: { schema: 1, updatedAt: ua, settings: { perSheet: perSheet === 2 ? 2 : 3 }, apartments, months },
      notes,
    };
  }

  const api = { merge, flatten };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Merge = api;
})(typeof window !== 'undefined' ? window : globalThis);
