/* AO Compass 基本動作テスト   使い方: node tests/smoke.mjs */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + path.resolve(HERE, '..', 'index.html');
const EXE = process.env.PW_CHROMIUM || '';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {});
const errors = [];

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(String(e)));
  p.on('console', m => { if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await p.addInitScript('window.__AO_NO_ONBOARD=1;');   // 初回の案内を出さない
  await p.goto(FILE);
  await p.waitForTimeout(400);
  return p;
}

/* 1. 全画面が開く */
{
  const p = await open();
  for (const v of ['home', 'schools', 'documents', 'interview', 'tasks', 'portfolio', 'settings']) {
    await p.evaluate(x => go(x), v);
    await p.waitForTimeout(300);
    const n = await p.evaluate(() => document.querySelector('#root').innerText.trim().length);
    ok(n > 20, `${v} 画面が中身つきで開く (${n}文字)`);
  }
  await p.context().close();
}

/* 2. 志望校を登録して、書類・タスクまでつながる */
{
  const p = await open();
  const r = await p.evaluate(() => {
    S.schools = [{ id: 's1', name: '見本大学', faculty: '法学部', deadline: '2026-11-01',
                   docs: '志望理由書、自己推薦書、活動報告書', checklist: {}, tasks: [] }];
    S.documents = []; S.tasks = [];
    save(); render();
    return { req: requiredDocs(S.schools[0]), auto: S.tasks.filter(t => t.docauto).length };
  });
  ok(r.req.length === 3, `必要書類に書いた3件がそのまま出る (${r.req.join('/')})`);
  ok(r.auto === 3, `未着手の3件が緊急タスクになる (${r.auto}件)`);
  await p.evaluate(() => go('documents')); await p.waitForTimeout(400);
  const tx = await p.evaluate(() => document.querySelector('#root').innerText);
  ok(tx.includes('提出書類の取り組み状況'), '書類ページに取り組み状況カードが出る');
  await p.context().close();
}

/* 3. チェックを押しても他の行に入らない（同じ座標を4回タップ） */
{
  const p = await open();
  await p.evaluate(() => {
    S.schools = []; S.documents = [{ id: 'dz', title: 'メモ', type: 'その他', body: 'あ'.repeat(50), status: '下書き', updatedAt: Date.now() }];
    S.tasks = [1, 2, 3, 4, 5].map(i => ({ id: 'x' + i, title: 'とても長いタスク名のサンプルです' + i, due: '2026-08-0' + i, done: false, category: '書類', urgent: i === 1 }));
    save(); go('tasks');
  });
  await p.waitForTimeout(400);
  const box = await p.evaluate(() => { const b = document.querySelector('#root .list-row[data-tid="x1"] .check').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  const h0 = await p.evaluate(() => [...document.querySelectorAll('#root .list-row[data-tid]')].map(x => Math.round(x.getBoundingClientRect().height)).join(','));
  for (let i = 0; i < 4; i++) { await p.mouse.click(box.x, box.y); await p.waitForTimeout(350); }
  const h1 = await p.evaluate(() => [...document.querySelectorAll('#root .list-row[data-tid]')].map(x => Math.round(x.getBoundingClientRect().height)).join(','));
  const st = await p.evaluate(() => S.tasks.map(t => t.done ? 1 : 0).join(''));
  ok(h0 === h1, `完了しても行の高さが変わらない (${h0} / ${h1})`);
  ok(st === '00000', `同じ場所を4回押しても他の行に入らない (${st})`);
  await p.context().close();
}

/* 4. 古いデータでも開ける（データを壊していない） */
{
  const p = await open();
  const okOld = await p.evaluate(() => {
    const old = { schools: [{ id: 'o1', name: '旧データ大学' }], documents: [{ id: 'o2', title: '旧書類', body: 'あ' }], tasks: [{ id: 'o3', title: '旧タスク' }] };
    S = migrate(old); save();
    try { ['home', 'schools', 'documents', 'tasks'].forEach(v => go(v)); return true; } catch (e) { return String(e); }
  });
  ok(okOld === true, `古い形のデータでも全画面が開く (${okOld})`);
  await p.context().close();
}

/* 5. 免責表示とバージョン */
{
  const p = await open();
  const t = await p.evaluate(() => document.body.innerText);
  ok(t.includes('募集要項'), '免責の帯が消えていない');
  const v = await p.evaluate(() => (typeof APP_VER !== 'undefined' ? APP_VER : ''));
  ok(/^\d{4}\.\d{2}\.\d{2}(-\d+)?$/.test(v), `APP_VER の形式が正しい (${v})`);
  await p.context().close();
}

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
if (errors.length) { console.log('JSエラー:', errors.slice(0, 5)); }
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
