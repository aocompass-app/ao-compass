/* タスク・締切まわりの追加テスト   使い方: node tests/task-groups.mjs
   1) 未完了タスクが「期限を過ぎた／今日／7日以内／それ以降／期限なし」で区切られる
   2) 区切っても行の並び・高さは従来どおり（チェックしても隣の行に入らない）
   3) カレンダーに出願締切だけでなく エントリー開始・試験日・合格発表 が出る
   4) カレンダーを先の月に送ったあと「今月に戻る」で戻れる                         */
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

/* 5つの時期にまたがるタスクを置く（日付は端末の「今日」から作るので、いつ動かしても同じ） */
const SEED = () => {
  const T = todayISO();
  S.schools = []; S.documents = [];
  S.tasks = [
    { id: 'g_late', title: 'それ以降のタスク',   due: isoAdd(T, 20), done: false },
    { id: 'g_none', title: '期限なしのタスク',   due: '',             done: false },
    { id: 'g_ov2',  title: '期限切れ その2',     due: isoAdd(T, -2),  done: false },
    { id: 'g_wk',   title: '7日以内のタスク',     due: isoAdd(T, 4),   done: false },
    { id: 'g_ov1',  title: '期限切れ その1',     due: isoAdd(T, -9),  done: false },
    { id: 'g_td',   title: '今日のタスク',        due: T,              done: false },
    { id: 'g_dn',   title: '終わったタスク',      due: isoAdd(T, 1),   done: true  }
  ];
  save(); go('tasks');
};

/* ---- 1. 区切り見出しと件数 ---- */
{
  const p = await open();
  await p.evaluate(SEED); await p.waitForTimeout(400);

  const heads = await p.evaluate(() => [...document.querySelectorAll('#root .tgh')].map(h => ({
    key: h.getAttribute('data-tgh'),
    text: h.querySelector('.tgh-t').textContent,
    n: h.querySelector('[data-tkg]').textContent
  })));
  ok(heads.map(h => h.key).join(',') === 'over,today,week,later,none',
    `見出しが時期の順に5つ出る (${heads.map(h => h.key).join(',')})`);
  ok(heads[0].text.indexOf('期限を過ぎた') >= 0, `最初の見出しが「期限を過ぎた」(${heads[0].text})`);
  ok(heads.map(h => h.n).join(',') === '2件,1件,1件,1件,1件', `各見出しの件数が正しい (${heads.map(h => h.n).join(',')})`);

  /* 行の並びは締切順そのまま（期限なしは末尾）＝これまでと同じ順序 */
  const order = await p.evaluate(() => [...document.querySelectorAll('#root .card .list-row[data-tid]')].map(r => r.getAttribute('data-tid')).join(','));
  ok(order === 'g_ov1,g_ov2,g_td,g_wk,g_late,g_none', `行は締切順のまま並ぶ (${order})`);

  /* 未完了の総数は従来の見出しどおり */
  const openTitle = await p.evaluate(() => document.querySelector('#root [data-tk="open"]').textContent);
  ok(openTitle === '未完了（6）', `「未完了（N）」は従来どおり (${openTitle})`);

  /* 期限切れがあるときだけ案内文を出す */
  const tx = await p.evaluate(() => document.querySelector('#root').innerText);
  ok(tx.indexOf('期限を過ぎたタスクは消えません') >= 0, '期限切れがあるときは案内文が出る');

  /* 見出しは装飾。前回の不具合（見出しが右に寄る）を防ぐため左寄せを確認 */
  const lay = await p.evaluate(() => {
    const h = document.querySelector('#root .tgh');
    const t = h.querySelector('.tgh-t').getBoundingClientRect(), b = h.getBoundingClientRect();
    return { left: Math.round(t.left - b.left), inside: t.right <= b.right + 1 };
  });
  ok(lay.left <= 2 && lay.inside, `見出しの文字は左端にある (左から${lay.left}px)`);
  await p.context().close();
}

/* ---- 2. チェックしても行が動かず、件数だけ減る ---- */
{
  const p = await open();
  await p.evaluate(SEED); await p.waitForTimeout(400);
  const before = await p.evaluate(() => ({
    order: [...document.querySelectorAll('#root .list-row[data-tid]')].map(r => r.getAttribute('data-tid')).join(','),
    h: [...document.querySelectorAll('#root .list-row[data-tid]')].map(r => Math.round(r.getBoundingClientRect().height)).join(','),
    over: document.querySelector('#root [data-tkg="over"]').textContent,
    open: document.querySelector('#root [data-tk="open"]').textContent
  }));
  const box = await p.evaluate(() => { const b = document.querySelector('#root .list-row[data-tid="g_ov1"] .check').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await p.mouse.click(box.x, box.y); await p.waitForTimeout(350);
  const after = await p.evaluate(() => ({
    order: [...document.querySelectorAll('#root .list-row[data-tid]')].map(r => r.getAttribute('data-tid')).join(','),
    h: [...document.querySelectorAll('#root .list-row[data-tid]')].map(r => Math.round(r.getBoundingClientRect().height)).join(','),
    over: document.querySelector('#root [data-tkg="over"]').textContent,
    open: document.querySelector('#root [data-tk="open"]').textContent,
    done: S.tasks.filter(t => t.done).map(t => t.id).join(',')
  }));
  ok(before.order === after.order, `チェックしても行は動かない (${after.order})`);
  ok(before.h === after.h, `チェックしても行の高さが変わらない (${before.h} / ${after.h})`);
  ok(after.over === '1件' && before.over === '2件', `見出しの件数だけ減る (${before.over}→${after.over})`);
  ok(after.open === '未完了（5）', `「未完了（N）」も一緒に減る (${after.open})`);
  ok(after.done === 'g_ov1,g_dn', `押した行だけが完了になる (${after.done})`);

  /* 同じ場所を続けて押しても隣の行に入らない（既存の不具合の再発防止） */
  for (let i = 0; i < 3; i++) { await p.mouse.click(box.x, box.y); await p.waitForTimeout(320); }
  const st = await p.evaluate(() => S.tasks.filter(t => t.id !== 'g_dn' && t.done).map(t => t.id).join(','));
  ok(st === '' || st === 'g_ov1', `続けて押しても他の行に入らない (${st || 'なし'})`);
  await p.context().close();
}

/* ---- 3. 該当しない時期の見出しは出ない ---- */
{
  const p = await open();
  const r = await p.evaluate(() => {
    S.schools = []; S.documents = [];
    S.tasks = [{ id: 'a', title: '今日のこと', due: todayISO(), done: false }];
    save(); go('tasks');
    return { keys: [...document.querySelectorAll('#root .tgh')].map(h => h.getAttribute('data-tgh')).join(','), tx: document.querySelector('#root').innerText };
  });
  ok(r.keys === 'today', `今日のタスクだけなら見出しは1つ (${r.keys})`);
  ok(r.tx.indexOf('期限を過ぎたタスクは消えません') < 0, '期限切れが無いときは案内文を出さない');

  /* タスクが1件も無いときは見出しを出さない（空の案内はそのまま） */
  const r2 = await p.evaluate(() => { S.tasks = []; save(); go('tasks'); return { n: document.querySelectorAll('#root .tgh').length, tx: document.querySelector('#root').innerText }; });
  ok(r2.n === 0, `タスクが無ければ見出しは出ない (${r2.n}個)`);
  ok(r2.tx.indexOf('タスクがありません') >= 0, 'タスクが無いときの案内はそのまま出る');
  await p.context().close();
}

/* ---- 4. taskGroup / taskGroupCounts の単体 ---- */
{
  const p = await open();
  const r = await p.evaluate(() => {
    const T = todayISO();
    return {
      none1: taskGroup({}), none2: taskGroup({ due: '' }), none3: taskGroup(null),
      ov: taskGroup({ due: isoAdd(T, -1) }), td: taskGroup({ due: T }),
      w1: taskGroup({ due: isoAdd(T, 1) }), w7: taskGroup({ due: isoAdd(T, 7) }),
      l8: taskGroup({ due: isoAdd(T, 8) })
    };
  });
  ok(r.none1 === 'none' && r.none2 === 'none' && r.none3 === 'none', '期限なし・空・null は「期限なし」扱い');
  ok(r.ov === 'over' && r.td === 'today', '前日は期限切れ、当日は今日');
  ok(r.w1 === 'week' && r.w7 === 'week' && r.l8 === 'later', '7日後までが「7日以内」、8日後は「それ以降」（境界）');
  const c = await p.evaluate(() => { S.tasks = [{ id: '1', due: todayISO(), done: false }, { id: '2', due: todayISO(), done: true }]; return taskGroupCounts(); });
  ok(c.today === 1, `完了済みは件数に数えない (今日=${c.today})`);
  await p.context().close();
}

/* ---- 5. カレンダーに志望校の重要日程が出る ---- */
{
  const p = await open();
  const r = await p.evaluate(() => {
    const T = todayISO(), M = T.slice(0, 8);
    S.schools = [{ id: 's1', name: '見本大学', faculty: '法学部', checklist: {}, tasks: [], docs: '',
      entryStart: M + '10', deadline: M + '11', examDate: M + '12', resultDate: M + '13' }];
    S.documents = []; S.tasks = []; save();
    vTasks._v = 'cal'; go('tasks');
    /* マスには自動作成された緊急タスクの名前も入るので、日程の名前で絞る。
       印は日付の行（最初の子）だけを読む */
    const cells = [...document.querySelectorAll('#root [title]')].filter(x => /エントリー開始|出願締切|試験日|合格発表/.test(x.getAttribute('title')));
    return {
      n: cells.length,
      icons: cells.map(c => c.firstElementChild.textContent.replace(/[0-9]/g, '')).join('|'),
      titles: cells.map(c => c.getAttribute('title')).join('|'),
      legend: document.querySelector('#root').innerText,
      ev: schoolEventsOn(M + '12').map(e => e.kind + ':' + e.label).join(','),
      none: schoolEventsOn(M + '20').length
    };
  });
  ok(r.n === 4, `4つの日程それぞれのマスに印が付く (${r.n}マス)`);
  ok(/✏️/.test(r.icons) && /📮/.test(r.icons) && /📝/.test(r.icons) && /🎉/.test(r.icons),
    `エントリー開始・出願締切・試験日・合格発表の印が出る (${r.icons})`);
  ok(/試験日/.test(r.titles) && /合格発表/.test(r.titles) && /エントリー開始/.test(r.titles), '長押し（title）に日程の名前が入る');
  ok(/試験日/.test(r.legend) && /合格発表/.test(r.legend), 'カレンダーの凡例に新しい印の説明がある');
  ok(/募集要項/.test(r.legend), 'カレンダーにも要項で確認する注意が出る');
  ok(r.ev === 'examDate:試験日', `schoolEventsOn が日程を引ける (${r.ev})`);
  ok(r.none === 0, '何も無い日は空で返る');

  /* その日のプランのシートにも出る */
  await p.evaluate(() => openDaySheet(todayISO().slice(0, 8) + '12')); await p.waitForTimeout(350);
  const sh = await p.evaluate(() => document.querySelector('#overlay') ? document.querySelector('#overlay').innerText : '');
  ok(/見本大学/.test(sh) && /試験日/.test(sh), 'その日のプランに「試験日です」と出る');
  await p.evaluate(() => closeSheet()); await p.waitForTimeout(250);

  /* 出願締切だけの古いデータでも従来どおり動く */
  const old = await p.evaluate(() => {
    S.schools = [{ id: 'o1', name: '旧データ大学', deadline: todayISO().slice(0, 8) + '11' }];
    save(); go('tasks');
    const c = [...document.querySelectorAll('#root [title]')].filter(x => /出願締切/.test(x.getAttribute('title')));
    return { n: c.length, ic: c.map(x => x.firstElementChild.textContent).join('') };
  });
  ok(old.n === 1 && /📮/.test(old.ic), `試験日などが未入力でも出願締切は従来どおり出る (${old.n}マス ${old.ic})`);
  await p.context().close();
}

/* ---- 6. 「今月に戻る」 ---- */
{
  const p = await open();
  await p.evaluate(() => { S.schools = []; S.documents = []; S.tasks = []; save(); vTasks._v = 'cal'; go('tasks'); });
  await p.waitForTimeout(350);
  const t0 = await p.evaluate(() => ({ ttl: document.querySelector('#root h4').textContent, back: document.querySelector('#root').innerText.indexOf('に戻る') >= 0 }));
  ok(!t0.back, '今月を見ているときは「今月に戻る」を出さない');

  await p.evaluate(() => [...document.querySelectorAll('#root button')].filter(b => /次の月/.test(b.textContent))[0].click());
  await p.waitForTimeout(350);
  await p.evaluate(() => [...document.querySelectorAll('#root button')].filter(b => /次の月/.test(b.textContent))[0].click());
  await p.waitForTimeout(350);
  const t1 = await p.evaluate(() => ({ ttl: document.querySelector('#root h4').textContent, off: taskCalendar._off, back: [...document.querySelectorAll('#root button')].filter(b => /に戻る/.test(b.textContent)).length }));
  ok(t1.off === 2 && t1.ttl !== t0.ttl, `先の月に送れる (${t1.ttl})`);
  ok(t1.back === 1, '先の月を見ていると「今月に戻る」が出る');

  await p.evaluate(() => [...document.querySelectorAll('#root button')].filter(b => /に戻る/.test(b.textContent))[0].click());
  await p.waitForTimeout(350);
  const t2 = await p.evaluate(() => ({ ttl: document.querySelector('#root h4').textContent, off: taskCalendar._off, back: [...document.querySelectorAll('#root button')].filter(b => /に戻る/.test(b.textContent)).length }));
  ok(t2.off === 0 && t2.ttl === t0.ttl, `押すと今月に戻る (${t2.ttl})`);
  ok(t2.back === 0, '戻ったらボタンは消える');

  /* 今月のマスに「今日」の色が付いている＝今日が画面に映っている */
  const hasToday = await p.evaluate(() => [...document.querySelectorAll('#root [title]')].some(x => /teal/.test(x.getAttribute('style') || '')));
  ok(hasToday, '今月表示では今日のマスに色が付く');
  await p.context().close();
}

/* ---- 7. 古いデータ・欠けたデータで全画面が開く ---- */
{
  const p = await open();
  const r = await p.evaluate(() => {
    S = migrate({ schools: [{ id: 'o1', name: '旧大学' }], documents: [{ id: 'o2', title: '旧書類', body: 'あ' }], tasks: [{ id: 'o3', title: '旧タスク' }] });
    save();
    try {
      ['home', 'schools', 'documents', 'interview', 'tasks', 'portfolio', 'settings'].forEach(v => go(v));
      vTasks._v = 'cal'; go('tasks'); vTasks._v = 'list'; go('tasks');
      return 'ok:' + [...document.querySelectorAll('#root .tgh')].map(h => h.getAttribute('data-tgh')).join(',');
    } catch (e) { return String(e); }
  });
  /* 期限なしの旧タスク＝none、自動作成される書類の緊急タスク＝week が出る（順序は締切順） */
  ok(/^ok:/.test(r) && /(^|,)none$/.test(r.slice(3)), `期限なしの古いタスクでも一覧・カレンダーが開く (${r})`);

  /* 完了済みのたたみこみは従来どおり（閉じていると中身が読めないので開いて確認） */
  const dn = await p.evaluate(() => {
    S.tasks = [{ id: 'd1', title: '終わった', due: todayISO(), done: true }]; save(); go('tasks');
    const d = document.querySelector('#root details.acc'); if (!d) return 'なし';
    d.open = true; return d.innerText;
  });
  ok(/完了済み（1）/.test(dn) && /終わった/.test(dn), `完了済みのたたみこみは従来どおり (${String(dn).slice(0, 24)})`);
  await p.context().close();
}

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
if (errors.length) { console.log('JSエラー:', errors.slice(0, 5)); }
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
