// Test pentru regula de păstrare a copiilor de siguranță. Rulează cu: node tests/backup-test.js
const assert = require('assert');
const { toDelete } = require('../backup.js');

const nm = (d) => 'evidenta-apa-backup-' + d + '.json';
let n = 0;
function t(name, fn) { fn(); n++; console.log('✔', name); }

t('copiile din ultimele 14 zile se păstrează toate', () => {
  const names = ['2026-11-09', '2026-11-08', '2026-11-01', '2026-10-27'].map(nm);
  assert.deepStrictEqual(toDelete(names, '2026-11-09'), []);
});

t('din luna veche rămâne doar cea mai veche copie; restul se șterg', () => {
  const names = ['2026-08-03', '2026-08-10', '2026-08-20', '2026-11-09'].map(nm);
  assert.deepStrictEqual(toDelete(names, '2026-11-09').sort(), [nm('2026-08-10'), nm('2026-08-20')].sort());
});

t('lunile mai vechi de 12 luni se șterg complet', () => {
  const names = ['2025-01-05', '2025-10-02', '2025-11-02', '2026-11-09'].map(nm);
  assert.deepStrictEqual(toDelete(names, '2026-11-09').sort(), [nm('2025-01-05'), nm('2025-10-02')].sort());
});

t('fișierele cu alt nume nu sunt atinse niciodată', () => {
  const names = ['evidenta-apa.json', 'altceva.json', 'evidenta-apa-backup-x.json', nm('2020-01-01')];
  assert.deepStrictEqual(toDelete(names, '2026-11-09'), [nm('2020-01-01')]);
});

t('o zi din viitor (ceas dereglat) nu duce la ștergeri', () => {
  assert.deepStrictEqual(toDelete([nm('2026-11-20'), nm('2026-11-09')], '2026-11-09'), []);
});

t('data de azi invalidă: nu se șterge nimic', () => {
  assert.deepStrictEqual(toDelete([nm('2020-01-01')], 'azi'), []);
});

t('numărul total rămas e mărginit (zilnic timp de 3 ani)', () => {
  const names = [];
  for (let i = 0; i < 365 * 3; i++) { const d = new Date(Date.UTC(2023, 10, 9) + i * 86400000); names.push(nm(d.toISOString().slice(0, 10))); }
  const del = new Set(toDelete(names, '2026-11-08'));
  const kept = names.filter((x) => !del.has(x));
  assert.ok(kept.length <= 14 + 13 + 1, 'rămase: ' + kept.length);
});

console.log('\nTOATE CELE ' + n + ' TESTE AU TRECUT');
