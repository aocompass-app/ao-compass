/* タスクの締切日まわりの追加テスト   使い方: node tests/task-due.mjs
   1) タスク編集シートに「今日／明日／3日後／1週間後／期限なし」のクイック指定が出る
   2) 押すとその日付が入り、保存すると S.tasks / localStorage に残る
   3) 締切日の下に「あとN日」「N日 過ぎています」「今日が締切です」が出る（ピッカー直接入力にも追従）
   4) 期限切れタスクを開くと過ぎた日数が出て、〈今日〉1タップで「今日」グループに移る
   5) カレンダーの日セル →「＋ この日にタスクを追加」で、その日が最初から入っている
   6) 既存の挙動（新規追加・削除・完了状態の保持・古いデータ）が壊れていない            */
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
  await p.addInitScript('window.__AO_NO_ONBOARD=1;');
  await p.goto(FILE);
  await p.waitForTimeout(400);
  return p;
}

/* 「今日」を基準に作るので、いつ動かしても同じ結果になる */
const SEED = () => {
  const T = todayISO();
  S.schools = []; S.documents = [];
  S.tasks = [
    { id: 't_over', title: '期限切れのタスク', due: isoAdd(T, -5), done: false },
    { id: 't_soon', title: '3日後のタスク', due: isoAdd(T, 3), done: false },
    { id: 't_none', title: '期限なしのタスク', due: '', done: false },
    { id: 't_done', title: '完了済みのタスク', due: isoAdd(T, 1), done: true }
  ];
  save(); go('tasks');
};

/* ---------------------------------------------------------------- 1・3 */
console.log('\n[1] 締切日のクイック指定と残り日数');
{
  const p = await open();
  await p.evaluate(SEED); await p.waitForTimeout(300);

  await p.evaluate(() => editTask('t_soon')); await p.waitForTimeout(250);

  const labels = await p.evaluate(() =>
    [...document.querySelectorAll('#sheet [data-duequick] button')].map(b => b.textContent));
  ok(labels.join('/') === '今日/明日/3日後/1週間後/期限なし', `クイック指定の5つが出る (${labels.join('/')})`);

  const info0 = await p.evaluate(() => document.querySelector('#sheet [data-dueinfo]').innerText.trim());
  ok(/あと3日/.test(info0), `3日後のタスクで「あと3日」が出る (${info0})`);

  /* 〈今日〉を押す */
  await p.click('#sheet [data-duequick] button[data-due="0"]'); await p.waitForTimeout(150);
  const r1 = await p.evaluate(() => ({
    v: document.querySelector('#sheet input[type=date]').value,
    info: document.querySelector('#sheet [data-dueinfo]').innerText.trim(),
    today: todayISO()
  }));
  ok(r1.v === r1.today, `〈今日〉で今日の日付が入る (${r1.v})`);
  ok(/今日が締切/.test(r1.info), `「今日が締切です」に変わる (${r1.info})`);

  /* 〈1週間後〉 */
  await p.click('#sheet [data-duequick] button[data-due="7"]'); await p.waitForTimeout(150);
  const r2 = await p.evaluate(() => ({
    v: document.querySelector('#sheet input[type=date]').value,
    info: document.querySelector('#sheet [data-dueinfo]').innerText.trim(),
    want: isoAdd(todayISO(), 7)
  }));
  ok(r2.v === r2.want, `〈1週間後〉で7日後が入る (${r2.v})`);
  ok(/あと7日/.test(r2.info), `「あと7日」に変わる (${r2.info})`);

  /* 〈期限なし〉 */
  await p.click('#sheet [data-duequick] button[data-due=""]'); await p.waitForTimeout(150);
  const r3 = await p.evaluate(() => ({
    v: document.querySelector('#sheet input[type=date]').value,
    info: document.querySelector('#sheet [data-dueinfo]').innerText.trim()
  }));
  ok(r3.v === '', '〈期限なし〉で日付が空になる');
  ok(/期限なし/.test(r3.info), `空のときは案内文が出る (${r3.info})`);

  /* ピッカーに直接入れても残り日数が追従する */
  await p.evaluate(() => {
    const inp = document.querySelector('#sheet input[type=date]');
    inp.value = isoAdd(todayISO(), 30);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(120);
  const info4 = await p.evaluate(() => document.querySelector('#sheet [data-dueinfo]').innerText.trim());
  ok(/あと30日/.test(info4), `手入力にも追従する (${info4})`);

  await p.context().close();
}

/* ---------------------------------------------------------------- 2 保存 */
console.log('\n[2] 押した日付が保存される');
{
  const p = await open();
  await p.evaluate(SEED); await p.waitForTimeout(300);
  await p.evaluate(() => editTask('t_soon')); await p.waitForTimeout(250);
  await p.click('#sheet [data-duequick] button[data-due="1"]'); await p.waitForTimeout(120);
  await p.evaluate(() => [...document.querySelectorAll('#sheet button')].filter(b => b.textContent === '保存')[0].click());
  await p.waitForTimeout(400);

  const r = await p.evaluate(() => {
    const t = S.tasks.filter(x => x.id === 't_soon')[0];
    const raw = JSON.parse(localStorage.getItem('aoCompass_v1') || '{}');
    const saved = (raw.tasks || []).filter(x => x.id === 't_soon')[0] || {};
    return { due: t.due, want: isoAdd(todayISO(), 1), saved: saved.due, title: t.title, done: t.done };
  });
  ok(r.due === r.want, `明日に動いている (${r.due})`);
  ok(r.saved === r.want, `localStorage にも入っている (${r.saved})`);
  ok(r.title === '3日後のタスク', 'タスク名は変わっていない');
  ok(r.done === false, '完了状態は変わっていない');

  /* 完了済みタスクを編集しても done が消えない */
  await p.evaluate(() => editTask('t_done')); await p.waitForTimeout(250);
  await p.click('#sheet [data-duequick] button[data-due="3"]'); await p.waitForTimeout(120);
  await p.evaluate(() => [...document.querySelectorAll('#sheet button')].filter(b => b.textContent === '保存')[0].click());
  await p.waitForTimeout(400);
  const d2 = await p.evaluate(() => {
    const t = S.tasks.filter(x => x.id === 't_done')[0];
    return { done: t.done, due: t.due, want: isoAdd(todayISO(), 3) };
  });
  ok(d2.done === true, '完了済みのタスクを編集しても完了のまま');
  ok(d2.due === d2.want, `完了済みでも日付は変えられる (${d2.due})`);

  await p.context().close();
}

/* ---------------------------------------------------------------- 4 期限切れ */
console.log('\n[4] 期限切れタスクを1タップで今日に動かす');
{
  const p = await open();
  await p.evaluate(SEED); await p.waitForTimeout(300);

  const g0 = await p.evaluate(() => taskGroup(S.tasks.filter(x => x.id === 't_over')[0]));
  ok(g0 === 'over', `はじめは「期限を過ぎた」にいる (${g0})`);

  await p.evaluate(() => editTask('t_over')); await p.waitForTimeout(250);
  const info = await p.evaluate(() => document.querySelector('#sheet [data-dueinfo]').innerText.trim());
  ok(/5日 過ぎています/.test(info), `過ぎた日数が出る (${info})`);

  await p.click('#sheet [data-duequick] button[data-due="0"]'); await p.waitForTimeout(120);
  await p.evaluate(() => [...document.querySelectorAll('#sheet button')].filter(b => b.textContent === '保存')[0].click());
  await p.waitForTimeout(450);

  const g1 = await p.evaluate(() => taskGroup(S.tasks.filter(x => x.id === 't_over')[0]));
  ok(g1 === 'today', `〈今日〉→保存で「今日」に移る (${g1})`);

  /* 一覧の見出しにも反映されている */
  const tx = await p.evaluate(() => document.querySelector('#root').innerText);
  ok(tx.includes('📌 今日'), '一覧に「今日」の区切りが出る');
  ok(!tx.includes('⏰ 期限を過ぎた'), '「期限を過ぎた」の区切りは消える');

  await p.context().close();
}

/* ---------------------------------------------------------------- 5 カレンダー */
console.log('\n[5] カレンダーの日付が最初から入る');
{
  const p = await open();
  await p.evaluate(SEED); await p.waitForTimeout(300);

  /* 今日から10日後の「その日のプラン」を開く（月をまたいでもよいよう openDaySheet を直接呼ぶ） */
  const target = await p.evaluate(() => { const iso = isoAdd(todayISO(), 10); openDaySheet(iso); return iso; });
  await p.waitForTimeout(300);
  await p.evaluate(() => [...document.querySelectorAll('#sheet button')].filter(b => /この日にタスクを追加/.test(b.textContent))[0].click());
  await p.waitForTimeout(450);

  const r = await p.evaluate(() => ({
    head: document.querySelector('#sheet .sheet-head h3').textContent,
    v: document.querySelector('#sheet input[type=date]').value,
    info: document.querySelector('#sheet [data-dueinfo]').innerText.trim()
  }));
  ok(r.head === 'タスクを追加', 'タスク追加シートが開く');
  ok(r.v === target, `その日が最初から入っている (${r.v})`);
  ok(/あと10日/.test(r.info), `残り日数も出る (${r.info})`);

  /* そのまま保存できる */
  await p.evaluate(() => {
    const inp = document.querySelector('#sheet input[type=text]');
    inp.value = 'カレンダーから足したタスク';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.evaluate(() => [...document.querySelectorAll('#sheet button')].filter(b => b.textContent === '保存')[0].click());
  await p.waitForTimeout(400);
  const made = await p.evaluate(() => S.tasks.filter(t => t.title === 'カレンダーから足したタスク')[0] || null);
  ok(made && made.due === target, `保存したタスクにその日が入る (${made ? made.due : 'なし'})`);

  await p.context().close();
}

/* ---------------------------------------------------------------- 6 既存の挙動 */
console.log('\n[6] これまでの操作が壊れていない');
{
  const p = await open();
  await p.evaluate(SEED); await p.waitForTimeout(300);

  /* 新規追加：日付を触らなければ「期限なし」のまま */
  await p.evaluate(() => editTask(null)); await p.waitForTimeout(250);
  const emptyInfo = await p.evaluate(() => document.querySelector('#sheet [data-dueinfo]').innerText.trim());
  ok(/期限なし/.test(emptyInfo), `新規は空の案内から始まる (${emptyInfo})`);
  await p.evaluate(() => {
    const inp = document.querySelector('#sheet input[type=text]');
    inp.value = '日付なしの新規タスク';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.evaluate(() => [...document.querySelectorAll('#sheet button')].filter(b => b.textContent === '保存')[0].click());
  await p.waitForTimeout(400);
  const n1 = await p.evaluate(() => {
    const t = S.tasks.filter(x => x.title === '日付なしの新規タスク')[0];
    return t ? { due: t.due, g: taskGroup(t) } : null;
  });
  ok(n1 && n1.due === '' && n1.g === 'none', `期限なしで追加できる (${n1 && n1.g})`);

  /* タスク名が空なら保存されない */
  const before = await p.evaluate(() => S.tasks.length);
  await p.evaluate(() => editTask(null)); await p.waitForTimeout(250);
  await p.click('#sheet [data-duequick] button[data-due="0"]'); await p.waitForTimeout(100);
  await p.evaluate(() => [...document.querySelectorAll('#sheet button')].filter(b => b.textContent === '保存')[0].click());
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => S.tasks.length);
  ok(before === after, `タスク名が空なら増えない (${before}→${after})`);
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(200);

  /* 削除できる */
  await p.evaluate(() => editTask('t_none')); await p.waitForTimeout(250);
  await p.evaluate(() => [...document.querySelectorAll('#sheet button')].filter(b => b.textContent === '削除')[0].click());
  await p.waitForTimeout(300);
  await p.evaluate(() => [...document.querySelectorAll('#sheet button')].filter(b => /削除する|はい|OK|削除/.test(b.textContent) && !/キャンセル/.test(b.textContent)).pop().click());
  await p.waitForTimeout(400);
  const gone = await p.evaluate(() => S.tasks.filter(t => t.id === 't_none').length);
  ok(gone === 0, '削除がこれまでどおり効く');

  /* 一覧のチェックは行の高さを変えない（従来の守り） */
  await p.evaluate(SEED); await p.waitForTimeout(350);
  const h0 = await p.evaluate(() => [...document.querySelectorAll('#root .list-row[data-tid]')].map(x => Math.round(x.getBoundingClientRect().height)).join(','));
  await p.evaluate(() => document.querySelector('#root .list-row[data-tid="t_over"] .checkhit').click());
  await p.waitForTimeout(300);
  const h1 = await p.evaluate(() => [...document.querySelectorAll('#root .list-row[data-tid]')].map(x => Math.round(x.getBoundingClientRect().height)).join(','));
  ok(h0 === h1, `チェックしても行の高さが変わらない (${h0} / ${h1})`);

  await p.context().close();
}

/* ---------------------------------------------------------------- 7 古いデータ・横幅 */
console.log('\n[7] 古いデータと画面幅');
{
  const p = await open();
  const r = await p.evaluate(() => {
    S = migrate({ tasks: [{ id: 'z1', title: '日付の項目が無い古いタスク' }], schools: [], documents: [] });
    save(); go('tasks');
    try { editTask('z1'); } catch (e) { return String(e); }
    return document.querySelector('#sheet [data-dueinfo]').innerText.trim();
  });
  await p.waitForTimeout(250);
  ok(/期限なし/.test(r), `due が無い古いタスクでも開ける (${r}）`);

  const w = await p.evaluate(() => { const s = document.querySelector('#sheet'); return [s.scrollWidth, s.clientWidth]; });
  ok(w[0] === w[1], `390px 幅で横スクロールしない (${w.join(' / ')})`);

  /* 全画面が開く */
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(200);
  const allOk = await p.evaluate(() => {
    try { ['home', 'schools', 'documents', 'interview', 'tasks', 'portfolio', 'settings'].forEach(v => go(v)); return true; } catch (e) { return String(e); }
  });
  ok(allOk === true, `全画面が開く (${allOk})`);

  await p.context().close();
}

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
if (errors.length) { console.log('JSエラー:', errors.slice(0, 5)); }
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
