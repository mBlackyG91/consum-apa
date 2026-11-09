/* Copii de siguranță zilnice în Drive: cât timp se păstrează.
 *
 * Regula (pură, fără rețea, testabilă):
 *   - toate copiile din ultimele 14 zile;
 *   - pentru fiecare dintre ultimele 12 luni, cea mai veche copie din lună
 *     (adică starea de la începutul lunii);
 *   - orice altceva se pune la gunoi.
 * Fișierele al căror nume nu respectă formatul NU sunt atinse niciodată.
 */
(function (root) {
  'use strict';

  const RE = /^evidenta-apa-backup-(\d{4})-(\d{2})-(\d{2})\.json$/;
  const DAILY_DAYS = 14;
  const MONTHS_KEPT = 12;

  function toDelete(names, today) {
    const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
    if (!t) return [];
    const tDay = Date.UTC(+t[1], +t[2] - 1, +t[3]);
    const tMonth = +t[1] * 12 + +t[2];
    const items = [];
    for (const name of names) {
      const m = RE.exec(name);
      if (!m) continue;
      items.push({ name, day: Date.UTC(+m[1], +m[2] - 1, +m[3]), month: +m[1] * 12 + +m[2] });
    }
    items.sort((a, b) => a.day - b.day);
    const keep = new Set();
    const firstOfMonth = new Map();
    for (const it of items) {
      if ((tDay - it.day) / 86400000 <= DAILY_DAYS) keep.add(it.name);
      if (!firstOfMonth.has(it.month)) firstOfMonth.set(it.month, it);
    }
    for (const [month, it] of firstOfMonth) if (tMonth - month <= MONTHS_KEPT) keep.add(it.name);
    return items.filter((it) => !keep.has(it.name)).map((it) => it.name);
  }

  const api = { toDelete, NAME_RE: RE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Backup = api;
})(typeof window !== 'undefined' ? window : globalThis);
