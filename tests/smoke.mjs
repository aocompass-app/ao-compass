/* AO Compass スモークテスト
   使い方: node tests/smoke.mjs
   index.html を file:// で iPhone サイズ(390x844)で開き、壊れていないかを確かめます。 */
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const APP_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;

/* ---- 小さなテスト道具 ---- */
let pass = 0, fail = 0;
export function ok(cond, msg) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + msg); }
  else { fail++; console.log('  \x1b[31m✗ ' + msg + '\x1b[0m'); }
}
export function eq(a, b, msg) { ok(a === b, msg + ' (実際: ' + JSON.stringify(a) + ' / 期待: ' + JSON.stringify(b) + ')'); }
export function summary(title) {
  console.log('\n' + title + ': ' + pass + '件 通過 / ' + fail + '件 失敗');
  return fail;
}

/* CDN(supabase等)は file:// では読めないので、読み込み失敗だけは無視します */
const IGNORE = /jsdelivr|supabase|cdn\.|ERR_|Failed to load resource|net::/i;
export async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });
  await page.addInitScript(() => { window.__AO_NO_ONBOARD = 1; });
  if (opts.seed) await page.addInitScript(opts.seed, opts.seedArg);
  await page.goto(APP_URL);
  await page.waitForFunction(() => typeof window.render === 'function');
  page.__errors = errors;
  return page;
}

export const VIEWS = [
  ['home', 'ホーム'], ['schools', '志望校'], ['documents', '提出書類'],
  ['interview', '面接'], ['tasks', 'タスク'], ['self', '自己分析'], ['settings', '設定'],
];

/* 全画面を開いて、中身が入っているかを見ます */
export async function visitAll(page, label) {
  for (const [v, name] of VIEWS) {
    await page.evaluate(v => go(v), v);
    await page.waitForTimeout(60);
    const len = await page.evaluate(() => {
      const r = document.querySelector('#root');
      /* 閉じた details の中は innerText に出ないので開いてから読みます */
      r.querySelectorAll('details').forEach(d => { d.open = true; });
      return (r.innerText || '').trim().length;
    });
    ok(len > 40, label + ' ' + name + '画面が中身つきで開く (文字数 ' + len + ')');
  }
}

/* ---- 本体 ---- */
async function main() {
  const browser = await chromium.launch();

  /* --- 1. 空の状態で7画面 --- */
  console.log('\n[1] 7画面が開く');
  const p1 = await newPage(browser);
  await visitAll(p1, '');
  eq(p1.__errors.length, 0, 'JSエラーが出ない' + (p1.__errors.length ? ' → ' + p1.__errors.join(' | ') : ''));

  /* --- 2. 免責の帯とバージョン --- */
  console.log('\n[2] 免責表示とバージョン');
  const band = await p1.evaluate(() => {
    const n = document.querySelector('.disclaimer');
    return n ? (n.innerText || '') : '';
  });
  ok(band.includes('募集要項'), '「募集要項」の免責の帯が出ている');
  ok(band.includes('大学公式サイト'), '免責に「大学公式サイト」の案内がある');
  const ver = await p1.evaluate(() => APP_VER);
  ok(/^\d{4}\.\d{2}\.\d{2}(-\d+)?$/.test(ver), 'APP_VER が YYYY.MM.DD の形 (' + ver + ')');
  await p1.context().close();

  /* --- 3. 必要書類3件 → requiredDocs 3件・緊急タスク3件 --- */
  console.log('\n[3] 必要書類と緊急タスク');
  const p2 = await newPage(browser);
  const docRes = await p2.evaluate(() => {
    S = blankState();
    S.profile.onboarded = true;
    S.schools.push({ id: 'sTest', name: 'テスト大学', faculty: '総合政策学部',
      docs: '志望理由書、活動報告書、学習計画書', deadline: isoAdd(todayISO(), 30), checklist: {} });
    save(); render();
    const req = requiredDocs(S.schools[0]);
    const auto = S.tasks.filter(t => t.docauto && t.urgent && !t.done);
    return { req: req, autoN: auto.length, titles: auto.map(t => t.title) };
  });
  eq(docRes.req.length, 3, 'requiredDocs が3件返る → ' + JSON.stringify(docRes.req));
  eq(docRes.autoN, 3, '緊急タスクが3件できる');
  ok(docRes.titles.every(t => t.indexOf('テスト大学') >= 0), '緊急タスクに志望校の名前が入る');
  /* 書類に本文を書いたら、そのぶんの緊急タスクは消える */
  const after = await p2.evaluate(() => {
    S.documents.push({ id: 'dTest', schoolId: 'sTest', title: 'テスト大学 志望理由書', type: '志望理由書',
      status: '下書き', body: '私が貴学を志望する理由は、地域の課題に取り組んできた経験があるからです。',
      notes: '', paragraphNotes: {}, feedbacks: [], versions: [], scoreHistory: [], updatedAt: Date.now() });
    save(); render();
    return S.tasks.filter(t => t.docauto && !t.done).length;
  });
  eq(after, 2, '本文を書いた書類の緊急タスクは自動で消える');
  eq(p2.__errors.length, 0, 'JSエラーが出ない' + (p2.__errors.length ? ' → ' + p2.__errors.join(' | ') : ''));
  await p2.context().close();

  /* --- 4. タスクのチェックを同じ座標で4回押す --- */
  console.log('\n[4] タスクのチェックを4回連打');
  const p3 = await newPage(browser);
  await p3.evaluate(() => {
    S = blankState(); S.profile.onboarded = true;
    for (let i = 1; i <= 6; i++) {
      S.tasks.push({ id: 'task' + i, title: 'タスク' + i + '：志望理由書の材料を集める', due: isoAdd(todayISO(), i),
        done: false, category: '書類' });
    }
    save(); go('tasks');
  });
  await p3.waitForTimeout(120);
  const rows = p3.locator('.list-row[data-tid]');
  const target = rows.nth(2);
  const tid = await target.getAttribute('data-tid');
  const box = await target.locator('.checkhit').boundingBox();
  const pt = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const h0 = (await target.boundingBox()).height;
  const others0 = await p3.evaluate(id => S.tasks.filter(t => t.id !== id).map(t => !!t.done), tid);

  let heightOK = true, othersOK = true, toggled = 0;
  for (let i = 1; i <= 4; i++) {
    await p3.mouse.click(pt.x, pt.y);
    await p3.waitForTimeout(300);   /* tapOK の 220ms ガードを越える */
    const st = await p3.evaluate(id => ({
      me: !!(S.tasks.filter(t => t.id === id)[0] || {}).done,
      others: S.tasks.filter(t => t.id !== id).map(t => !!t.done),
    }), tid);
    const h = (await target.boundingBox()).height;
    if (Math.abs(h - h0) > 0.5) heightOK = false;
    if (JSON.stringify(st.others) !== JSON.stringify(others0)) othersOK = false;
    if (st.me === (i % 2 === 1)) toggled++;
  }
  ok(othersOK, '押した行以外の done が変わらない');
  ok(heightOK, '行の高さが変わらない (' + h0.toFixed(1) + 'px のまま)');
  eq(toggled, 4, '押した行だけが毎回きちんと切り替わる');
  eq(p3.__errors.length, 0, 'JSエラーが出ない' + (p3.__errors.length ? ' → ' + p3.__errors.join(' | ') : ''));
  await p3.context().close();

  /* --- 5. 古い形のデータでも全画面が開く --- */
  console.log('\n[5] 古いデータの読み込み(migrate)');
  const OLD = {
    /* 昔のバージョンで保存されたデータ。新しく増えた項目が丸ごと無い */
    schools: [{ id: 's1', name: '旧制大学', faculty: '文学部', docs: '志望理由書、活動報告書', deadline: '2026-09-30' }],
    documents: [{ id: 'd1', schoolId: 's1', title: '志望理由書', body: '昔に書いた本文です。', status: '下書き' }],
    activities: [{ id: 'a1', title: '生徒会', body: '会計を担当しました' }],
    self: { answers: { q1: 'こたえ' } },
    story: { origin: 'きっかけ' },
    profile: { name: 'テスト太郎', grade: '高3' },
    tasks: [{ id: 't1', title: '昔のタスク', due: '2026-09-01' }],
    interview: null, essays: undefined, certs: 'こわれた値', feedback: {},
  };
  const p4 = await newPage(browser, {
    seed: old => { localStorage.setItem('aoCompass_v1', JSON.stringify(old)); },
    seedArg: OLD,
  });
  const mig = await p4.evaluate(() => ({
    schools: S.schools.length, docs: S.documents.length,
    arrays: ['schools', 'activities', 'documents', 'interview', 'essays', 'tasks', 'feedback', 'certs']
      .every(k => Array.isArray(S[k])),
    checklist: S.schools.every(s => s.checklist && typeof s.checklist === 'object'),
    docFields: S.documents.every(d => Array.isArray(d.feedbacks) && Array.isArray(d.versions) && Array.isArray(d.scoreHistory)),
    prefs: !!(S.prefs && S.prefs.textSize),
  }));
  eq(mig.schools, 1, '古いデータの志望校が残る');
  eq(mig.docs, 1, '古いデータの書類が残る');
  ok(mig.arrays, '足りなかった一覧がすべて配列になる');
  ok(mig.checklist, '志望校に checklist が足される');
  ok(mig.docFields, '書類に feedbacks / versions / scoreHistory が足される');
  ok(mig.prefs, 'prefs の既定値が入る');
  await visitAll(p4, '古いデータで');
  eq(p4.__errors.length, 0, 'JSエラーが出ない' + (p4.__errors.length ? ' → ' + p4.__errors.join(' | ') : ''));
  await p4.context().close();

  await browser.close();
  return summary('スモークテスト');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(n => process.exit(n ? 1 : 0)).catch(e => { console.error(e); process.exit(1); });
}
