/* テスト共通の道具 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PAGE_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;

let pass = 0, fail = 0;
export function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
export function summary(title) {
  console.log(`\n${title}: ${pass} 件成功 / ${fail} 件失敗`);
  if (fail) process.exit(1);
}

/* 初回の案内シートを出さずに開く。JSエラーは全部集める */
export async function openApp(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => { window.__AO_NO_ONBOARD = 1; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(PAGE_URL);
  await page.waitForFunction(() => !!document.querySelector('#root'));
  return { ctx, page, errors };
}

/* 画面を切り替える（go() は中の関数なので evaluate から呼ぶ） */
export async function goto(page, view) {
  await page.evaluate(v => go(v), view);
  await page.waitForTimeout(60);
}

/* 閉じた <details> の中は innerText に出てこないので、全部開いてから読む */
export async function visibleText(page) {
  return page.evaluate(() => {
    document.querySelectorAll('#root details').forEach(d => { d.open = true; });
    return document.querySelector('#root').innerText;
  });
}

/* 志望校1件（必要書類つき）だけの状態にする */
export async function seedSchool(page, docs, deadline) {
  await page.evaluate(a => {
    S = migrate({});
    S.schools = [{ id: 'sc1', name: 'テスト大学', faculty: 'テスト学部', deadline: a.deadline || null, checklist: {}, docs: a.docs }];
    S.meta.primarySchoolId = 'sc1';
    save(); render();
  }, { docs, deadline: deadline || null });
  await page.waitForTimeout(60);
}

export const VIEWS = [
  ['home', 'ホーム'],
  ['schools', '志望校'],
  ['documents', '提出書類'],
  ['interview', '面接'],
  ['tasks', 'タスク'],
  ['self', '自己分析'],
  ['settings', '設定'],
];
