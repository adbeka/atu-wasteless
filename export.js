// Выгрузка сводного отчёта в Excel по структуре действующих таблиц учёта АО «АТУ»
const ExcelJS = require('exceljs');
const { db } = require('./db');
// число остаётся числом (можно суммировать в Excel), единица показывается форматом ячейки
const unitFmt = (u) => `#,##0.0#" ${u}"`;

const GREEN = 'FF1F6F4A', LIGHT = 'FFE8F3EC', GREY = 'FFF2F2F2';
const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };
const STATUS_RU = { draft: 'черновик', submitted: 'отправлено', in_review: 'на проверке', accepted: 'принято', returned: 'возвращено', 'нет': 'нет отчёта' };

function header(ws, row, values) {
  const r = ws.getRow(row); r.values = values;
  r.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; c.border = border; });
  r.height = 32;
}
function title(ws, text, sub, cols) {
  ws.mergeCells(1, 1, 1, cols); ws.getCell(1, 1).value = text; ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.mergeCells(2, 1, 2, cols); ws.getCell(2, 1).value = sub; ws.getCell(2, 1).font = { italic: true, color: { argb: 'FF555555' } };
}

async function buildSummaryXlsx(s) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'АТУ · Цифровая система учёта пищевых отходов';
  wb.created = new Date();

  // 1. Сводный отчёт: организации × виды отходов × месяцы
  const ws = wb.addWorksheet('Сводный отчёт', { views: [{ state: 'frozen', ySplit: 4 }] });
  const mcols = s.months.length;
  const cols = 3 + mcols + 5;
  title(ws, `Сводный отчёт по пищевым отходам университетского комплекса АО «АТУ» — ${s.label}`,
    `Период ${s.from} — ${s.to}. Источник: единый реестр (только принятые отчёты). Сформировано ${new Date().toLocaleString('ru-RU')}`, cols);
  header(ws, 4, ['Организация', 'Наименование отходов', 'Ед.', ...s.months, 'Итого за период', 'Масса, кг', 'Способ переработки / утилизации', 'Пригоден к переработке', 'CO₂-экв., кг']);
  let row = 5;
  for (const o of s.orgs) {
    const start = row;
    if (!o.types.length) {
      ws.getRow(row).values = [o.name, 'нет принятых данных', '', ...o.statuses.map((x) => STATUS_RU[x] || x)];
      ws.getRow(row).font = { italic: true, color: { argb: 'FFC00000' } }; row++;
    }
    for (const t of o.types) {
      ws.getRow(row).values = [o.name, t.name, t.unit, ...t.byMonth, t.qty, t.kg, t.methods, ['нет', 'частично', 'да'][t.recyclable] || 'нет', t.co2];
      ws.getRow(row).eachCell({ includeEmpty: true }, (c, i) => { if (i <= cols) c.border = border; });
      row++;
    }
    const tr = ws.getRow(row);
    tr.values = ['', `Итого: ${o.short}`, 'кг', ...Array(mcols).fill(''), '', o.kg, `статус отчётов: ${o.statuses.map((x) => STATUS_RU[x] || x).join(' / ')}`, `${o.kg ? Math.round(o.recyclableKg / o.kg * 100) : 0}%`, o.co2];
    tr.font = { bold: true }; tr.eachCell({ includeEmpty: true }, (c, i) => { if (i <= cols) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } }; c.border = border; } });
    if (row - 1 > start) ws.mergeCells(start, 1, row - 1, 1);
    ws.getCell(start, 1).alignment = { vertical: 'top', wrapText: true };
    row++;
  }
  const g = ws.getRow(row);
  g.values = ['ВСЕГО по университетскому комплексу', '', 'кг', ...Array(mcols).fill(''), '', s.totalKg, `переработано: ${s.recycledShare}%`, `${s.recyclableShare}%`, s.totalCo2];
  g.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  g.eachCell({ includeEmpty: true }, (c, i) => { if (i <= cols) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }; });
  ws.columns.forEach((c, i) => { c.width = i === 0 ? 34 : i === 1 ? 40 : i === 2 ? 6 : i === cols - 3 ? 34 : 14; });
  for (let r = 5; r <= row; r++) for (let c = 4; c <= 3 + mcols + 2; c++) ws.getCell(r, c).numFmt = '#,##0.0';

  // 2. Автовыводы
  const wi = wb.addWorksheet('Автовыводы');
  title(wi, `Автоматические выводы и рекомендации — ${s.label}`, 'Числа посчитаны системой по данным реестра; текст заключения сформулирован ИИ (Claude) или по правилам', 3);
  let off = 0;
  if (s.conclusion?.text) {
    wi.mergeCells(4, 1, 4, 3); wi.getCell(4, 1).value = s.conclusion.source === 'ai' ? 'Заключение (сформулировано ИИ по фактам системы)' : 'Заключение (по правилам системы)';
    wi.getCell(4, 1).font = { bold: true, color: { argb: GREEN } };
    wi.mergeCells(5, 1, 5, 3); wi.getCell(5, 1).value = s.conclusion.text; wi.getCell(5, 1).alignment = { wrapText: true, vertical: 'top' };
    wi.getRow(5).height = Math.min(400, 15 * (s.conclusion.text.split('\n').length + s.conclusion.text.length / 110));
    off = 3;
  }
  header(wi, 4 + off, ['Тип', 'Вывод', 'Описание и рекомендация']);
  const LV = { warn: 'Внимание', good: 'Хорошо', tip: 'Рекомендация', info: 'Факт' };
  s.insights.forEach((x, i) => { const r = wi.getRow(5 + off + i); r.values = [LV[x.level] || x.level, x.title, x.text]; r.alignment = { wrapText: true, vertical: 'top' };
    r.eachCell((c) => { c.border = border; }); if (x.level === 'warn') r.getCell(1).font = { bold: true, color: { argb: 'FFC00000' } }; });
  wi.columns = [{ width: 16 }, { width: 28 }, { width: 110 }];
  if (s.anomalies.length) {
    const st = 7 + off + s.insights.length;
    header(wi, st, ['Месяц', 'Организация / вид', 'Отклонение']);
    s.anomalies.forEach((a, i) => { wi.getRow(st + 1 + i).values = [a.monthLabel, `${a.org} — ${a.type}`, `+${a.changePct}% к среднему за 3 мес.: ${a.curPerDay} против ${a.avgPerDay} кг/день (≈${a.extraKg} кг сверх нормы)`]; });
  }

  // 3. Экопоказатели
  const we = wb.addWorksheet('Экопоказатели');
  title(we, 'Экологические показатели', 'ЦУР 12.3 · ESG (E)', 3);
  header(we, 4, ['Показатель', 'Значение', 'Комментарий']);
  [
    ['Общая масса отходов, т', +(s.totalKg / 1000).toFixed(3), 'л пересчитаны в кг по плотности 0,92 (масло)'],
    ['CO₂-эквивалент, т', +(s.totalCo2 / 1000).toFixed(3), 'по коэффициентам видов отходов'],
    ['Доля пригодных к переработке, %', s.recyclableShare, 'по признаку вида отхода'],
    ['Доля фактически переработанных, %', s.recycledShare, 'по способу утилизации'],
    ['Источник коэффициентов', 'DEFRA / BEIS 2024', 'Greenhouse gas reporting: conversion factors 2024, раздел Waste disposal (справочник организаторов Трека 1)'],
    ['Формула экономии', 'масса (т) × (коэф. ТБО − коэф. нового способа)', 'масло: литры × 0,92 = кг'],
    ...db.prepare('SELECT code, name, co2_factor, rank FROM disposal_methods WHERE active=1 ORDER BY rank, id').all()
      .map((m) => [`Способ ${m.code || ''}: ${m.name}`, m.co2_factor == null ? (/TBO/.test(m.code || '') ? 'по виду отхода' : 'нет коэффициента') : `${(m.co2_factor * 1000).toLocaleString('ru-RU')} кг CO₂e/т`, `иерархия: ${m.rank} (1 — лучше)`]),
  ].forEach((v, i) => { const r = we.getRow(5 + i); r.values = v; r.eachCell((c) => { c.border = border; }); });
  we.columns = [{ width: 44 }, { width: 22 }, { width: 80 }];

  // 4. Журналы организаций — в формате «Таблица учёта пищевых отходов в университетском комплексе АО «АТУ»»
  for (const o of s.orgs) {
    const name = o.short.replace(/[\\/?*[\]:«»"]/g, '').slice(0, 31);
    const wo = wb.addWorksheet(name);
    title(wo, 'Таблица учёта пищевых отходов в университетском комплексе АО «АТУ»', `${o.name} · ${s.label}`, 6);
    header(wo, 4, ['№', 'Дата', 'Наименование отходов', 'Вес (кг) / Объём (л)', 'Способ переработки / утилизации', 'Ответственное лицо']);
    const rows = s.rows.filter((r) => r.org_id === o.id).sort((a, b) => a.date.localeCompare(b.date) || a.type_id - b.type_id);
    rows.forEach((r, i) => { const x = wo.getRow(5 + i); x.values = [i + 1, r.date.split('-').reverse().join('.'), r.type_name, r.qty, r.method_name, r.user_name]; x.getCell(4).numFmt = unitFmt(r.unit); x.eachCell((c) => { c.border = border; }); });
    let rr = 6 + rows.length;
    wo.getCell(rr, 3).value = 'ИТОГО за период по наименованию:'; wo.getCell(rr, 3).font = { bold: true }; rr++;
    for (const t of o.types) { wo.getRow(rr).values = ['', '', t.name, t.qty]; wo.getRow(rr).getCell(4).numFmt = unitFmt(t.unit); wo.getRow(rr).getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } }; rr++; }
    wo.getRow(rr).values = ['', '', 'ВСЕГО (л пересчитаны в кг)', o.kg]; wo.getRow(rr).getCell(4).numFmt = unitFmt('кг'); wo.getRow(rr).font = { bold: true };
    wo.getCell(rr + 2, 3).value = 'Примечание: если вида отхода нет в таблице, строка добавляется (справочник расширяется в системе).';
    wo.getCell(rr + 2, 3).font = { italic: true, color: { argb: 'FF777777' } };
    wo.columns = [{ width: 6 }, { width: 12 }, { width: 44 }, { width: 18 }, { width: 30 }, { width: 32 }];
  }
  return wb.xlsx.writeBuffer();
}

// Журнал записей по произвольному срезу (реестр с фильтрами, «мой месяц», отчёт из Telegram)
const SRC = { manual: 'форма', voice: 'фраза/голос', scale: 'весы', telegram: 'Telegram' };
async function buildEntriesXlsx(rows, { title: heading, sub }) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Wasteless';
  const ws = wb.addWorksheet('Журнал', { views: [{ state: 'frozen', ySplit: 4 }] });
  title(ws, heading, sub, 9);
  header(ws, 4, ['№', 'Дата', 'Подразделение', 'Наименование отходов', 'Вес (кг) / Объём (л)', 'Способ переработки / утилизации', 'CO₂-экв., кг', 'Ответственное лицо', 'Источник']);
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.org_short.localeCompare(b.org_short));
  sorted.forEach((r, i) => { const x = ws.getRow(5 + i); x.values = [i + 1, r.date.split('-').reverse().join('.'), r.org_short, r.type_name, r.qty, r.method_name, Math.round(r.co2 * 100) / 100, r.user_name, SRC[r.source] || r.source || '']; x.getCell(5).numFmt = unitFmt(r.unit); x.eachCell((c) => { c.border = border; }); });
  ws.columns = [{ width: 6 }, { width: 12 }, { width: 20 }, { width: 40 }, { width: 18 }, { width: 34 }, { width: 13 }, { width: 30 }, { width: 13 }];
  const wt = wb.addWorksheet('Итоги');
  title(wt, 'Итоги по видам отходов', sub, 5);
  header(wt, 4, ['Наименование отходов', 'Количество', 'Масса, кг', 'CO₂-экв., кг', 'Доля массы']);
  const m = {}; for (const r of rows) { m[r.type_name] ??= { qty: 0, kg: 0, co2: 0, unit: r.unit }; m[r.type_name].qty += r.qty; m[r.type_name].kg += r.kg; m[r.type_name].co2 += r.co2; }
  const total = rows.reduce((a, r) => a + r.kg, 0);
  Object.entries(m).sort((a, b) => b[1].kg - a[1].kg).forEach(([n, v], i) => { const x = wt.getRow(5 + i); x.values = [n, v.qty, Math.round(v.kg * 10) / 10, Math.round(v.co2 * 10) / 10, total ? v.kg / total : 0];
    x.getCell(2).numFmt = unitFmt(v.unit); x.getCell(5).numFmt = '0.0%'; x.eachCell((c) => { c.border = border; }); });
  const tr = wt.getRow(6 + Object.keys(m).length); tr.values = ['ИТОГО', '', Math.round(total * 10) / 10, Math.round(rows.reduce((a, r) => a + r.co2, 0) * 10) / 10, 1]; tr.font = { bold: true }; tr.getCell(5).numFmt = '0%';
  wt.columns = [{ width: 42 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 12 }];
  return wb.xlsx.writeBuffer();
}
// CSV для Power BI / Google Sheets: «;» и UTF-8 BOM (открывается в Excel), защита от формул в ячейках
function buildEntriesCsv(rows) {
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['date', 'org', 'waste_type', 'qty', 'unit', 'kg', 'method', 'co2_kg', 'responsible', 'source', 'report_period'];
  const lines = rows.map((r) => [r.date, r.org_short, r.type_name, r.qty, r.unit, Math.round(r.kg * 100) / 100, r.method_name, Math.round(r.co2 * 1000) / 1000, r.user_name, r.source, r.period].map(cell).join(';'));
  return '\ufeff' + [head.join(';'), ...lines].join('\r\n');
}

module.exports = { buildSummaryXlsx, buildEntriesXlsx, buildEntriesCsv };
