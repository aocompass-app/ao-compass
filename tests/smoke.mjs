/* AO Compass スモークテスト
   使い方: node tests/smoke.mjs
   index.html を file:// で 390x844（iPhone 相当）で開き、壊れていないかを確認します。 */
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = pathToFileURL(path.join(HERE, '..', 'index.html')).href;

let pass = 0, fail = 0;
const errors = [];
function ok(name) { pass++; console.log('  [32m✓[0m ' + name); }
function ng(name, detail) { fail++; console.log('  [31m✗[0m ' + name + (detail ? '\n      → ' + detail : '')); }
function check(name, cond, detail) { cond ? ok(name) : ng(name, detail); }

export async function openApp(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text())) jsErrors.push('console: ' + m.text()); });
  await page.addInitScript(() => { window.__AO_NO_ONBOARD = 1; });
  await page.goto(APP);
  await page.waitForFunction(() => typeof go === 'function' && typeof S === 'object');
  return { ctx, page, jsErrors };
}

const VIEWS = [
  ['home', 'ホーム'],
  ['schools', '志望校'],
  ['documents', '提出書類'],
  ['interview', '面接'],
  ['tasks', 'タスク・締切'],
  ['self', '自己分析'],
  ['settings', '設定'],
];

async function main() {
  const browser = await chromium.launch();
  const { ctx, page, jsErrors } = await openApp(browser);

  /* ---- 1. 7画面が中身つきで開く ---- */
  console.log('\n[1] 7画面が中身つきで開く');
  for (const [v, label] of VIEWS) {
    const info = await page.evaluate(v => {
      go(v);
      const r = document.getElementById('root');
      return { kids: r.childElementCount, len: r.innerText.replace(/\s/g, '').length };
    }, v);
    check(`${label}（${v}）が描画される`, info.kids > 0 && info.len > 30, JSON.stringify(info));
  }
  check('7画面を開いてもJSエラーが出ない', jsErrors.length === 0, jsErrors.join(' | '));

  /* ---- 2. 必要書類3件 → requiredDocs 3件・緊急タスク3件 ---- */
  console.log('\n[2] 必要書類と緊急タスクの自動作成');
  const docRes = await page.evaluate(() => {
    S = migrate({});
    S.schools = [{
      id: 'sTest', name: 'テスト大学', deadline: isoAdd(todayISO(), 20),
      docs: '志望理由書、活動報告書、学習計画書', checklist: {}
    }];
    S.documents = []; S.tasks = [];
    save();
    const req = requiredDocs(S.schools[0]);
    syncDocTasks();
    const urgent = S.tasks.filter(t => t.docauto && t.urgent && !t.done);
    return { req: req, urgent: urgent.map(t => t.title) };
  });
  check('requiredDocs が3件を返す', docRes.req.length === 3, JSON.stringify(docRes.req));
  check('必要書類3件がすべて拾えている',
    ['志望理由書', '活動報告書', '学習計画書'].every(x => docRes.req.indexOf(x) >= 0), JSON.stringify(docRes.req));
  check('緊急タスクが3件できる', docRes.urgent.length === 3, JSON.stringify(docRes.urgent));

  /* ---- 3. タスクのチェックを同じ座標で4回押す ---- */
  console.log('\n[3] タスクのチェックを同じ座標で4回押す');
  await page.evaluate(() => {
    S = migrate({});
    S.tasks = [1, 2, 3, 4, 5].map(function (n) {
      return { id: 'tk' + n, title: 'テストタスク' + n + '（本文の長さをそろえる）', due: isoAdd(todayISO(), n), category: '書類', done: false };
    });
    save(); go('tasks');
  });
  const rowSel = '.list-row[data-tid]';
  await page.waitForSelector(rowSel);

  const snapshot = () => page.evaluate(sel => {
    const rows = Array.from(document.querySelectorAll(sel));
    return {
      heights: rows.map(r => Math.round(r.getBoundingClientRect().height)),
      done: S.tasks.map(t => t.id + ':' + (t.done ? 1 : 0)),
    };
  }, rowSel);

  const before = await snapshot();
  const target = await page.evaluate(sel => {
    const r = document.querySelectorAll(sel)[1];
    const b = r.querySelector('.checkhit').getBoundingClientRect();
    return { tid: r.getAttribute('data-tid'), x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, rowSel);

  let heightStable = true, othersStable = true;
  const seen = [];
  for (let i = 1; i <= 4; i++) {
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(160);
    const now = await snapshot();
    if (now.heights.join(',') !== before.heights.join(',')) heightStable = false;
    const others = s => s.done.filter(x => x.indexOf(target.tid + ':') !== 0).join(',');
    if (others(now) !== others(before)) othersStable = false;
    seen.push(now.done.find(x => x.indexOf(target.tid + ':') === 0));
  }
  check('押した行以外の done が変わらない', othersStable, seen.join(' / '));
  check('行の高さが変わらない', heightStable, JSON.stringify(before.heights));
  check('4回押すと元の状態に戻る（1,0,1,0）', seen.join(',') === [target.tid + ':1', target.tid + ':0', target.tid + ':1', target.tid + ':0'].join(','), seen.join(','));

  /* ---- 4. 古い形のデータを migrate に通しても全画面が開く ---- */
  console.log('\n[4] 古い形のデータでも全画面が開く');
  const legacyErrors = [];
  page.on('pageerror', e => legacyErrors.push(String(e)));
  const legacyRes = await page.evaluate(views => {
    /* 昔のバージョンで保存された、項目の足りないデータ */
    const legacy = {
      schools: [{ id: 'old1', name: '旧大学', deadline: '2026-10-01', docs: '志望理由書' }],
      tasks: [{ id: 'oldT', title: '古いタスク', done: false }],
      self: { answers: { q1: '昔の回答' } },
      profile: { name: '旧ユーザー' }
    };
    S = migrate(legacy);
    save();
    const out = [];
    views.forEach(function (v) {
      let e = '';
      try { go(v); } catch (x) { e = String(x); }
      const r = document.getElementById('root');
      out.push({ v: v, kids: r.childElementCount, len: r.innerText.replace(/\s/g, '').length, err: e });
    });
    return {
      views: out,
      keptSchool: S.schools.length === 1 && S.schools[0].name === '旧大学',
      keptAnswer: S.self.answers.q1 === '昔の回答',
      tagsArray: Object.keys(S.self.tags).every(function (k) { return Array.isArray(S.self.tags[k]); }),
      lists: ['activities', 'documents', 'interview', 'essays', 'feedback', 'certs'].every(function (k) { return Array.isArray(S[k]); }),
    };
  }, VIEWS.map(x => x[0]));
  legacyRes.views.forEach(o => check(`古いデータで ${o.v} が開く`, !o.err && o.kids > 0 && o.len > 30, o.err || JSON.stringify(o)));
  check('古いデータの志望校が消えない', legacyRes.keptSchool);
  check('古いデータの自己分析の回答が消えない', legacyRes.keptAnswer);
  check('self.tags がすべて配列になる', legacyRes.tagsArray);
  check('足りないリストが配列で補われる', legacyRes.lists);
  check('古いデータでもJSエラーが出ない', legacyErrors.length === 0, legacyErrors.join(' | '));

  /* ---- 5. 免責の帯とバージョン ---- */
  console.log('\n[5] 免責の帯とバージョン表記');
  const meta = await page.evaluate(() => {
    const d = document.querySelector('.disclaimer');
    const st = d ? getComputedStyle(d) : null;
    return {
      text: d ? d.innerText : '',
      visible: !!(d && st.display !== 'none' && st.visibility !== 'hidden' && d.getBoundingClientRect().height > 0),
      ver: APP_VER,
    };
  });
  check('免責の帯に「募集要項」の文言が残っている', meta.text.indexOf('募集要項') >= 0, meta.text);
  check('免責の帯に「大学公式サイト」の文言が残っている', meta.text.indexOf('大学公式サイト') >= 0, meta.text);
  check('免責の帯が常時表示されている', meta.visible);
  check('APP_VER が YYYY.MM.DD の形', /^\d{4}\.\d{2}\.\d{2}(-\d+)?$/.test(meta.ver || ''), meta.ver);

  check('最後までJSエラーが出ない', jsErrors.length === 0, jsErrors.join(' | '));

  await ctx.close();
  await browser.close();

  console.log(`\n=== smoke: ${pass} 件成功 / ${fail} 件失敗 ===`);
  if (fail) { errors.forEach(e => console.log(e)); process.exit(1); }
}

/* 直接 node tests/smoke.mjs で呼ばれたときだけ実行する（他のテストから openApp を借りられるように） */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(e => { console.error(e); process.exit(1); });
}
