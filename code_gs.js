/**
 * 快訊雷達後端（Apps Script 網頁應用程式）
 * 美股、台股來自兩份不同的 Google Sheet：在 SOURCES 填入各自的 Sheet ID
 * （網址 /d/ 與 /edit 中間那串）。留空代表使用此腳本所綁定的試算表。
 * 欄位依位置讀取：A 時間 ｜ B 股票 ｜ C 價格 ｜ D 訊號（其餘欄位忽略）
 * 部署：部署 → 新增部署作業 → 網頁應用程式 → 執行身分「我」→ 存取權「所有人」
 */
const CFG = {
  TZ: 'Asia/Taipei',
  MAX_ROWS: 8000, // 每份 Sheet 只讀最後幾列；更早的日期查不到時可調大
  PASS: '888888',  // 🔒 存取密碼設定（請自行修改為您的自訂密碼；若設為 '' 則不驗證）
  SOURCES: [
    { market: '美股', id: '', sheet: '美股紀錄' },
    { market: '台股', id: '', sheet: '台股紀錄' }
  ]
};

function doGet(e) {
  const p = e.parameter || {};
  
  // 🔒 密碼安全驗證
  if (CFG.PASS && p.pass !== CFG.PASS) {
    return ContentService.createTextOutput(JSON.stringify({ error: '密碼驗證失敗！請確認存取密碼。' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  let out;
  try {
    out = p.action === 'quotes' ? quotes_(p.symbols || '') : alerts_(Number(p.days) || 3, p.from, p.to);
  } catch (err) {
    out = { error: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

// 有指定日期（from/to，格式 yyyy-MM-dd）時以日期為準，否則取最近 days 天
function alerts_(days, from, to) {
  const f = d => Utilities.formatDate(d, CFG.TZ, 'yyyy-MM-dd HH:mm:ss');
  const byDate = from || to;
  const lo = from ? from + ' 00:00:00' : byDate ? '0000' : f(new Date(Date.now() - days * 864e5));
  const hi = byDate ? (to || from) + ' 23:59:59' : '9999';
  const items = [], errors = [];
  CFG.SOURCES.forEach(src => {
    try {
      const ss = src.id ? SpreadsheetApp.openById(src.id) : SpreadsheetApp.getActive();
      const sh = ss.getSheetByName(src.sheet);
      if (!sh) throw new Error('找不到分頁「' + src.sheet + '」');
      const tz = ss.getSpreadsheetTimeZone();
      const last = sh.getLastRow();
      if (last < 2) return;
      const start = Math.max(2, last - CFG.MAX_ROWS + 1);
      sh.getRange(start, 1, last - start + 1, 4).getValues().forEach(r => {
        const time = fmt_(r[0], tz);
        const raw = String(r[1]).trim();
        if (!time || time < lo || time > hi || !raw) return;
        const i = raw.indexOf('_'); // 台股格式：6223_旺矽
        items.push({
          time: time, market: src.market,
          code: i < 0 ? raw : raw.slice(0, i),
          name: i < 0 ? '' : raw.slice(i + 1),
          price: Number(r[2]) || null,
          signal: String(r[3]).trim()
        });
      });
    } catch (err) {
      errors.push(src.market + '：' + err);
    }
  });
  items.sort((a, b) => (a.time < b.time ? 1 : -1)); // 新的在前
  return { items: items, errors: errors };
}

function fmt_(t, tz) {
  if (t instanceof Date) return Utilities.formatDate(t, tz, 'yyyy-MM-dd HH:mm:ss');
  const m = String(t).match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\s+(\d{1,2}):(\d{2}):?(\d{2})?/);
  if (!m) return '';
  const p = n => ('0' + n).slice(-2);
  return m[1] + '-' + p(m[2]) + '-' + p(m[3]) + ' ' + p(m[4]) + ':' + m[5] + ':' + p(m[6] || 0);
}

function quotes_(s) {
  const codes = s.split(',').filter(Boolean).slice(0, 40);
  const cache = CacheService.getScriptCache();
  const out = {}, todo = [];
  codes.forEach(c => {
    const hit = cache.get('q_' + c);
    if (hit) out[c] = JSON.parse(hit); else todo.push(c);
  });
  const fetchAll = list => UrlFetchApp.fetchAll(list.map(y => ({
    url: 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(y) + '?interval=1d&range=1d',
    muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' }
  })));
  const parse = r => {
    try {
      const m = JSON.parse(r.getContentText()).chart.result[0].meta;
      return { price: m.regularMarketPrice, prev: m.chartPreviousClose };
    } catch (e) { return null; }
  };
  if (todo.length) {
    const res = fetchAll(todo.map(c => ysym_(c, false)));
    const retry = [];
    res.forEach((r, i) => {
      const q = parse(r);
      if (q) out[todo[i]] = q; else if (isTw_(todo[i])) retry.push(todo[i]);
    });
    if (retry.length) { // 上市(.TW)查不到，改試上櫃(.TWO)
      fetchAll(retry.map(c => ysym_(c, true))).forEach((r, i) => {
        const q = parse(r);
        if (q) out[retry[i]] = q;
      });
    }
    todo.forEach(c => { if (out[c]) cache.put('q_' + c, JSON.stringify(out[c]), 60); });
  }
  return { quotes: out };
}

function isTw_(c) { return /^\d{4,6}[A-Z]?$/.test(c); }
function ysym_(c, otc) { return isTw_(c) ? c + (otc ? '.TWO' : '.TW') : c.replace('.', '-'); }