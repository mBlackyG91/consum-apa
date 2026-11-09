// Test pentru îmbinarea cu 3 surse. Rulează cu: node tests/merge-test.js
const assert = require('assert');
const { merge } = require('../merge.js');

const apt = (id, number, extra) => Object.assign({ id, number, owner: '', defaultPersons: null,
  meters: { bucatarie: true, baie: true, serviciu: false }, print: true }, extra || {});
const mk = (apartments, months, updatedAt) => ({ schema: 1, updatedAt: updatedAt || null, settings: { perSheet: 3 }, apartments, months: months || {} });
const ent = (b, ba, persons) => ({ persons: persons == null ? null : persons, readings: { bucatarie: { old: null, new: b }, baie: { old: null, new: ba } } });
let n = 0;
function t(name, fn) { fn(); n++; console.log('✔', name); }

const base = mk([apt('a', '1'), apt('b', '2')], { '2025-01': { period: null, apts: { a: ent(10, 20), b: ent(30, 40) } } }, '2025-02-01T00:00:00Z');

t('modificări pe câmpuri diferite se îmbină fără conflict', () => {
  const local = JSON.parse(JSON.stringify(base)); local.months['2025-01'].apts.a.readings.baie.new = 21; local.updatedAt = '2025-02-02T00:00:00Z';
  const remote = JSON.parse(JSON.stringify(base)); remote.months['2025-01'].apts.b.readings.bucatarie.new = 31; remote.updatedAt = '2025-02-03T00:00:00Z';
  const r = merge(base, local, remote);
  assert.strictEqual(r.notes.length, 0);
  assert.strictEqual(r.data.months['2025-01'].apts.a.readings.baie.new, 21);
  assert.strictEqual(r.data.months['2025-01'].apts.b.readings.bucatarie.new, 31);
});

t('o lună nouă de pe alt dispozitiv se adaugă, fără să afecteze datele locale', () => {
  const local = JSON.parse(JSON.stringify(base)); local.updatedAt = '2025-02-02T00:00:00Z';
  local.months['2025-02'] = { period: null, apts: { a: ent(15, 25) } };
  const remote = JSON.parse(JSON.stringify(base)); remote.updatedAt = '2025-02-03T00:00:00Z';
  remote.months['2025-03'] = { period: 'martie', apts: { b: ent(50, 60, 2) } };
  const r = merge(base, local, remote);
  assert.deepStrictEqual(Object.keys(r.data.months).sort(), ['2025-01', '2025-02', '2025-03']);
  assert.strictEqual(r.data.months['2025-03'].period, 'martie');
  assert.strictEqual(r.data.months['2025-03'].apts.b.persons, 2);
  assert.strictEqual(r.notes.length, 0);
});

t('aceeași valoare schimbată diferit: câștigă cea mai recentă și apare o notă', () => {
  const local = JSON.parse(JSON.stringify(base)); local.months['2025-01'].apts.a.readings.baie.new = 99; local.updatedAt = '2025-02-05T00:00:00Z';
  const remote = JSON.parse(JSON.stringify(base)); remote.months['2025-01'].apts.a.readings.baie.new = 55; remote.updatedAt = '2025-02-03T00:00:00Z';
  let r = merge(base, local, remote);
  assert.strictEqual(r.data.months['2025-01'].apts.a.readings.baie.new, 99);
  assert.strictEqual(r.notes.length, 1);
  assert.strictEqual(r.notes[0].kept, 'local'); assert.strictEqual(r.notes[0].remote, 55);
  remote.updatedAt = '2025-02-09T00:00:00Z';
  r = merge(base, local, remote);
  assert.strictEqual(r.data.months['2025-01'].apts.a.readings.baie.new, 55);
  assert.strictEqual(r.notes[0].kept, 'remote');
});

t('aceeași valoare introdusă identic pe ambele: fără notă', () => {
  const local = JSON.parse(JSON.stringify(base)); local.months['2025-01'].apts.a.readings.baie.new = 77;
  const remote = JSON.parse(JSON.stringify(base)); remote.months['2025-01'].apts.a.readings.baie.new = 77;
  assert.strictEqual(merge(base, local, remote).notes.length, 0);
});

t('ștergerea unui apartament local se propagă dacă Drive nu l-a modificat', () => {
  const local = mk([apt('a', '1')], { '2025-01': { period: null, apts: { a: ent(10, 20) } } }, '2025-02-02T00:00:00Z');
  const remote = JSON.parse(JSON.stringify(base));
  const r = merge(base, local, remote);
  assert.deepStrictEqual(r.data.apartments.map((a) => a.id), ['a']);
  assert.deepStrictEqual(Object.keys(r.data.months['2025-01'].apts), ['a']);
});

t('ștergerea unei valori local (gol) se propagă', () => {
  const local = JSON.parse(JSON.stringify(base)); local.months['2025-01'].apts.a.readings.baie.new = null; local.updatedAt = '2025-02-02T00:00:00Z';
  const remote = JSON.parse(JSON.stringify(base));
  const r = merge(base, local, remote);
  assert.strictEqual(r.data.months['2025-01'].apts.a.readings.baie, undefined); // citire goală = dispare
  assert.strictEqual(r.data.months['2025-01'].apts.a.readings.bucatarie.new, 10);
});

t('prima conectare (fără bază): apartamente cu același număr se unesc, nu se dublează', () => {
  const local = mk([apt('x1', '5', { owner: 'LOCAL' })], { '2025-01': { period: null, apts: { x1: ent(1, 2) } } }, '2025-03-01T00:00:00Z');
  const remote = mk([apt('y1', '5', { owner: 'LOCAL' }), apt('y2', '6')], { '2025-02': { period: null, apts: { y1: ent(3, 4), y2: ent(5, 6) } } }, '2025-02-01T00:00:00Z');
  const r = merge(null, local, remote);
  assert.deepStrictEqual(r.data.apartments.map((a) => a.number), ['5', '6']);
  assert.strictEqual(r.data.apartments[0].id, 'x1');
  assert.strictEqual(r.data.months['2025-02'].apts.x1.readings.bucatarie.new, 3);
  assert.strictEqual(r.data.months['2025-01'].apts.x1.readings.baie.new, 2);
});

t('prima conectare: apartamente diferite se păstrează ambele', () => {
  const local = mk([apt('x1', '5')], {}, '2025-03-01T00:00:00Z');
  const remote = mk([apt('y2', '6')], {}, '2025-02-01T00:00:00Z');
  assert.strictEqual(merge(null, local, remote).data.apartments.length, 2);
});

t('rezultatul îmbinării este stabil (îmbinat cu el însuși nu se schimbă)', () => {
  const local = JSON.parse(JSON.stringify(base)); local.months['2025-01'].apts.a.readings.baie.new = 21; local.updatedAt = '2025-02-02T00:00:00Z';
  const r = merge(base, local, base);
  const again = merge(r.data, r.data, r.data);
  assert.deepStrictEqual(again.data, r.data);
});

console.log('\nTOATE CELE ' + n + ' TESTE AU TRECUT');
