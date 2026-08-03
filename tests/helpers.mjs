/* テスト用の共通部品。
   index.html は 1ファイルのままにしておきたいので、テストだけ tests/ に置きます。 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APP_PATH = path.resolve(HERE, '..', 'index.html');
export const APP_URL = 'file://' + APP_PATH;

/* 実機の iPhone 相当。ホームの見え方はこの幅で決まります */
export const VIEWPORT = { width: 390, height: 844 };

/* 7つの画面（タブから行けるもの＋その他の中身） */
export const VIEWS = [
  ['home', 'ホーム'],
  ['schools', '志望校'],
  ['documents', '提出書類'],
  ['interview', '面接・小論文'],
  ['tasks', 'タスク・締切'],
  ['self', '自己分析'],
  ['settings', '設定'],
];

/* ---- ごく簡単なテスト集計 ---- */
let pass = 0;
const fails = [];
export function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fails.push(label); console.log('  ✗ ' + label); }
  return !!cond;
}
export function eq(actual, expected, label) {
  return ok(actual === expected, label + ' → 実際: ' + JSON.stringify(actual) + ' / 期待: ' + JSON.stringify(expected));
}
export function section(name) { console.log('\n■ ' + name); }
export function finish() {
  console.log('\n=== ' + pass + '件成功 / ' + fails.length + '件失敗 ===');
  if (fails.length) { fails.forEach(f => console.log('  失敗: ' + f)); process.exit(1); }
  process.exit(0);
}

/* 390x844 で index.html を開く。
   - 初回の案内は出さない（__AO_NO_ONBOARD）
   - 外部CDNは切る（回線が無くても同じ結果になるように。アプリ側は未接続でも動く作り）
   - state を渡すと localStorage に入れてから開く */
export async function openApp(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push('JSエラー: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|net::|ERR_|ERR_FAILED/.test(t)) return; /* CDN遮断ぶんは無視 */
    errors.push('consoleエラー: ' + t);
  });

  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.indexOf('file://') === 0) return r.continue();
    return r.abort();
  });

  await page.addInitScript(() => { window.__AO_NO_ONBOARD = 1; });
  if (opts.state !== undefined) {
    await page.addInitScript(json => {
      try { localStorage.setItem('aoCompass_v1', json); } catch (e) {}
    }, JSON.stringify(opts.state));
  }

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof window.render === 'function' && document.querySelector('#root') && document.querySelector('#root').children.length > 0,
    null, { timeout: 20000 }
  );
  return { page, ctx, errors };
}

/* localStorage が file:// で使えているかの確認（使えないと state を渡すテストが無意味になる） */
export async function lsWorks(page) {
  return page.evaluate(() => {
    try { localStorage.setItem('__t', '1'); const v = localStorage.getItem('__t'); localStorage.removeItem('__t'); return v === '1'; }
    catch (e) { return false; }
  });
}

/* 画面を切り替えて、中身のある文字が出ているかを返す */
export async function openView(page, view) {
  await page.evaluate(v => { go(v); }, view);
  await page.waitForTimeout(60);
  return page.evaluate(() => {
    const r = document.querySelector('#root');
    return { text: (r.innerText || '').replace(/\s+/g, ' ').trim(), nodes: r.querySelectorAll('*').length };
  });
}
