// Справочник продуктов (датасет): «что именно выбросили» → вид отхода организации.
// Продукт распознаётся во фразе, на фото или выбирается вручную; вид отхода подбирается по «роду» (kind)
// под справочник конкретной организации. Цена ₸/кг — для оценки потерь в деньгах (ориентировочная, правится в админке).
const fs = require('fs');
const path = require('path');
const { db, nowIso } = require('./db');

// таблица products — в db.js (synonyms через запятую, kind — род отхода, см. KINDS); справочник общий для платформы

// род → какие виды отходов организации подходят (по названию), по порядку предпочтения
const KINDS = {
  plate: { label: 'Остатки блюд', re: [/из зала|остатки еды/i, /нереализ/i, /брак готов/i] },
  unsold: { label: 'Нереализованная продукция', re: [/нереализ/i, /брак готов/i, /остатки еды|из зала/i] },
  bakery: { label: 'Хлеб и выпечка', re: [/хлеб/i, /нереализ/i, /остатки еды|из зала/i] },
  confectionery: { label: 'Кондитерские изделия', re: [/кондитер/i, /сахар/i, /нереализ/i, /остатки еды|из зала/i] },
  peel: { label: 'Овощи, очистки', re: [/очистк|овощ/i, /отходы очистки|некондиц/i, /остатки еды|из зала/i] },
  fruit: { label: 'Фрукты', re: [/фрукт/i, /очистк|овощ/i, /остатки еды|из зала/i] },
  meat: { label: 'Мясо и рыба', re: [/обрезки мяс/i, /технолог/i, /остатки еды|из зала/i] },
  bones: { label: 'Кости', re: [/рыбные кост/i, /кост/i, /обрезки мяс/i, /остатки еды|из зала/i] },
  dairy: { label: 'Молочные продукты', re: [/нереализ/i, /просроч/i, /остатки еды|из зала/i] },
  eggshell: { label: 'Яичная скорлупа', re: [/скорлуп/i, /очистк/i, /остатки еды|из зала/i] },
  coffee: { label: 'Кофе и чай', re: [/кофейн/i, /остатки еды|из зала/i] },
  expired: { label: 'Сырьё', re: [/просроч/i, /некондиц/i, /нереализ/i, /остатки еды|из зала/i] },
  oil: { label: 'Масло', re: [/масл/i] },
  cardboard: { label: 'Картон', re: [/картон/i, /упаков/i] },
  pet: { label: 'Пластик', re: [/пэт|пластик/i, /плёнк|пленк|полимер/i, /упаков/i] },
  film: { label: 'Плёнка', re: [/плёнк|пленк|полимер/i, /упаков/i] },
  glass: { label: 'Стекло', re: [/стекл/i, /упаков/i] },
  can: { label: 'Металл', re: [/алюмин|банк/i, /упаков/i] },
  packaging: { label: 'Упаковка', re: [/упаков/i, /плёнк|пленк|полимер/i, /картон/i] },
};

const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').trim();

async function importRows(rows) {
  let added = 0, updated = 0;
  const up = db.prepare('SELECT id FROM products WHERE lower(name)=lower(?)');
  for (const r of rows) {
    const name = String(r.name || '').trim(); if (!name) continue;
    const kind = KINDS[String(r.kind || '').trim()] ? String(r.kind).trim() : 'plate';
    const price = Number(String(r.price_kzt_kg ?? 0).replace(',', '.')) || 0;
    const syn = String(r.synonyms || '').split(/[,;|]/).map((x) => x.trim()).filter(Boolean).join(',');
    const ex = await up.get(name);
    if (ex) { await db.prepare('UPDATE products SET name_kz=?, synonyms=?, kind=?, price_kzt_kg=?, active=1, updated_at=? WHERE id=?').run(r.name_kz || null, syn, kind, price, nowIso(), ex.id); updated++; }
    else { await db.prepare('INSERT INTO products (name, name_kz, synonyms, kind, price_kzt_kg, updated_at) VALUES (?,?,?,?,?,?)').run(name, r.name_kz || null, syn, kind, price, nowIso()); added++; }
  }
  return { added, updated };
}
function parseCsv(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : '\t';
  const head = lines[0].split(sep).map((h) => norm(h));
  return lines.slice(1).map((l) => { const c = l.split(sep); return Object.fromEntries(head.map((h, i) => [h, (c[i] || '').trim()])); });
}
async function seedIfEmpty() {
  if ((await db.prepare('SELECT COUNT(*) n FROM products').get()).n) return 0;
  return (await importRows(parseCsv(fs.readFileSync(path.join(__dirname, 'reference', 'products.csv'), 'utf8')))).added;
}

const list = (all) => db.prepare(`SELECT * FROM products ${all ? '' : 'WHERE active=1'} ORDER BY kind, name`).all();

// вид отхода организации для продукта
function typeFor(product, types) {
  const k = KINDS[product.kind] || KINDS.plate;
  for (const re of k.re) { const t = types.find((x) => re.test(x.name)); if (t) return t; }
  return types.find((x) => x.category === 'organic' && ['plate', 'bakery', 'confectionery', 'dairy', 'meat', 'peel', 'fruit'].includes(product.kind)) || null;
}

// найти продукты во фрагменте текста: самое длинное совпадение синонима
function findProduct(fragment, products) {
  const t = ' ' + norm(fragment).replace(/[^a-zа-яәіңғүұқөһ0-9 -]/gi, ' ') + ' ';
  let best = null, bestLen = 0;
  for (const p of products) {
    for (const s of [p.name, p.name_kz, ...String(p.synonyms).split(',')].filter(Boolean).map(norm)) {
      const stem = s.length > 5 ? s.slice(0, s.length - 1) : s; // «картошки» ~ «картошк»
      if (s.length < 3) continue;
      // точное слово важнее совпадения по основе («картоп» ≠ «картон»)
      const score = t.includes(' ' + s + ' ') ? 100 + s.length : stem.length >= 4 && t.includes(' ' + stem) ? s.length : 0;
      if (score > bestLen) { best = p; bestLen = score; }
    }
  }
  return best;
}

module.exports = { KINDS, list, importRows, parseCsv, typeFor, findProduct, seedIfEmpty };
