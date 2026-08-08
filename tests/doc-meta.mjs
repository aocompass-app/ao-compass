/* 提出書類エディターの「志望校」「文字数制限」テスト   使い方: node tests/doc-meta.mjs
   確かめること：
   ・編集タブに「志望校」欄があり、あとから結びつけられること
   ・結びつけると「提出書類の取り組み状況」に反映され、未着手の緊急タスクが消えること
   ・必要書類に当てはまらないときは、その理由の案内が出ること
   ・「文字数制限」をあとから入れられて、カウンターが残り字数・超過に変わること
   ・「この下書きを複製」が動くこと（{...obj} を使わない書き方に直したため）
   ・志望校や文字数制限を持たない古いデータでも、エディターが開くこと            */
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

/* シートの中から、ラベル名で入力欄を探すための小道具をページ側に置く */
const HELPERS = `
  window.__field = function(label){
    var out = null;
    document.querySelectorAll('#sheet .field').forEach(function(f){
      var lb = f.querySelector('label');
      if (lb && lb.textContent.trim().indexOf(label) === 0 && !out) out = f;
    });
    return out;
  };
  window.__limitInput = function(){ return document.querySelector('#sheet input[aria-label="文字数制限"]'); };
  window.__counter = function(){ var c = document.querySelector('#sheet .counter'); return c ? c.textContent : ''; };
  window.__scNote = function(){
    var n = document.querySelectorAll('#sheet .field');
    var f = window.__field('志望校'); if(!f) return '';
    var e = f.nextElementSibling;
    return e ? e.textContent : '';
  };
`;

/* ---------- 1. 志望校未設定の書類：欄があり、警告が出る ---------- */
{
  const p = await open();
  await p.evaluate(() => {
    S.schools = [{ id: 's1', name: '見本大学', faculty: '法学部', deadline: isoAdd(todayISO(), 30),
                   docs: '志望理由書、自己推薦書', docList: ['志望理由書', '自己推薦書'], checklist: {}, tasks: [] }];
    S.documents = [{ id: 'd1', schoolId: null, title: '志望理由書 第1稿', type: '志望理由書',
                     status: '下書き', body: 'あ'.repeat(600), charLimit: 0, feedbacks: [], versions: [], updatedAt: Date.now() }];
    S.tasks = []; save(); render();
  });
  await p.evaluate(HELPERS);
  await p.evaluate(() => openDocEditor('d1'));
  await p.waitForTimeout(300);

  const has = await p.evaluate(() => !!window.__field('志望校'));
  ok(has, '編集タブに「志望校」欄がある');
  const note = await p.evaluate(() => window.__scNote());
  ok(note.indexOf('未設定') >= 0, `未設定のときは案内が出る (${note.slice(0, 30)})`);

  /* 未設定なので、学校側から見ると「未登録」のまま＝緊急タスクが立っている */
  const before = await p.evaluate(() => {
    const rows = docCheckup();
    return { state: rows.filter(r => r.label === '志望理由書')[0].state,
             auto: S.tasks.filter(t => t.docauto && !t.done).length };
  });
  ok(before.state === 'none', `志望校未設定だと取り組み状況は未登録のまま (${before.state})`);
  ok(before.auto === 2, `未着手2件の緊急タスクが出ている (${before.auto}件)`);

  /* 志望校を選ぶ */
  await p.evaluate(() => {
    const sel = window.__field('志望校').querySelector('select');
    sel.value = 's1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => {
    const rows = docCheckup();
    return { sid: S.documents[0].schoolId,
             state: rows.filter(r => r.label === '志望理由書')[0].state,
             len: rows.filter(r => r.label === '志望理由書')[0].len,
             auto: S.tasks.filter(t => t.docauto && !t.done).length,
             note: window.__scNote(),
             stored: JSON.parse(localStorage.getItem('aoCompass_v1')).documents[0].schoolId };
  });
  ok(after.sid === 's1', `選んだ志望校が書類に入る (${after.sid})`);
  ok(after.stored === 's1', '選んだ内容が端末に保存される');
  ok(after.state === 'wip' && after.len === 600, `取り組み状況が「作成中600字」に変わる (${after.state}/${after.len})`);
  ok(after.auto === 1, `志望理由書の緊急タスクが消えて1件になる (${after.auto}件)`);
  ok(after.note.indexOf('志望理由書') >= 0, `どの必要書類として数えられるか出る (${after.note.slice(0, 40)})`);

  /* 「未設定」に戻せる */
  await p.evaluate(() => {
    const sel = window.__field('志望校').querySelector('select');
    sel.value = '';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.waitForTimeout(250);
  const back = await p.evaluate(() => ({ sid: S.documents[0].schoolId, note: window.__scNote() }));
  ok(back.sid === null, '「— 未設定 —」に戻せる');
  ok(back.note.indexOf('未設定') >= 0, '戻すと案内も戻る');
  await p.context().close();
}

/* ---------- 2. 必要書類に当てはまらない種別のとき ---------- */
{
  const p = await open();
  await p.evaluate(() => {
    S.schools = [{ id: 's1', name: '見本大学', faculty: '法学部', docs: '志望理由書、自己推薦書',
                   docList: ['志望理由書', '自己推薦書'], checklist: {}, tasks: [] }];
    S.documents = [{ id: 'd2', schoolId: 's1', title: 'メモ書き', type: 'その他', status: '下書き',
                     body: 'い'.repeat(100), charLimit: 0, feedbacks: [], versions: [], updatedAt: Date.now() }];
    S.tasks = []; save(); render();
  });
  await p.evaluate(HELPERS);
  await p.evaluate(() => openDocEditor('d2'));
  await p.waitForTimeout(300);
  const note = await p.evaluate(() => window.__scNote());
  ok(note.indexOf('当てはまっていません') >= 0, `当てはまらないときは理由が出る (${note.slice(0, 40)})`);
  ok(note.indexOf('志望理由書') >= 0, 'その学校の必要書類の名前も示す');

  /* 種別を合わせると案内が切りかわる */
  await p.evaluate(() => {
    const sel = window.__field('種別').querySelector('select');
    sel.value = '自己推薦書';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.waitForTimeout(250);
  const n2 = await p.evaluate(() => window.__scNote());
  ok(n2.indexOf('自己推薦書') >= 0 && n2.indexOf('当てはまっていません') < 0,
     `種別を合わせると「反映されます」に変わる (${n2.slice(0, 40)})`);
  await p.context().close();
}

/* ---------- 3. 文字数制限をあとから設定できる ---------- */
{
  const p = await open();
  await p.evaluate(() => {
    S.schools = []; S.tasks = [];
    S.documents = [{ id: 'd3', schoolId: null, title: '志望理由書', type: '志望理由書', status: '下書き',
                     body: 'う'.repeat(700), charLimit: 0, feedbacks: [], versions: [], updatedAt: Date.now() }];
    save(); render();
  });
  await p.evaluate(HELPERS);
  await p.evaluate(() => openDocEditor('d3'));
  await p.waitForTimeout(300);

  const c0 = await p.evaluate(() => window.__counter());
  ok(/^700 字$/.test(c0.trim()), `制限が無いときは字数だけ (${c0})`);
  ok(await p.evaluate(() => !!window.__limitInput()), 'カウンターの横に文字数制限の入力欄がある');

  await p.evaluate(() => { const i = window.__limitInput(); i.focus(); i.value = '800'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(150);
  let c1 = await p.evaluate(() => window.__counter());
  ok(c1.indexOf('700 / 800字') >= 0, `制限を入れると「/ 800字」が出る (${c1})`);
  ok(c1.indexOf('あと100字') >= 0, `残り字数が出る (${c1})`);

  /* 入力欄から離れた時点で端末に保存される */
  await p.evaluate(() => { const i = window.__limitInput(); i.dispatchEvent(new Event('change', { bubbles: true })); i.blur(); });
  await p.waitForTimeout(200);
  const st = await p.evaluate(() => ({ mem: S.documents[0].charLimit,
    disk: JSON.parse(localStorage.getItem('aoCompass_v1')).documents[0].charLimit }));
  ok(st.mem === 800 && st.disk === 800, `制限が保存される (${st.mem}/${st.disk})`);

  /* 超過の表示 */
  await p.evaluate(() => { const i = window.__limitInput(); i.value = '500'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(150);
  const c2 = await p.evaluate(() => ({ t: window.__counter(), cls: document.querySelector('#sheet .counter').className }));
  ok(c2.t.indexOf('200字 超過') >= 0, `超過すると超過字数が出る (${c2.t})`);
  ok(c2.cls.indexOf('over') >= 0, `超過は色が変わる (${c2.cls})`);

  /* 空にすると制限なしに戻る */
  await p.evaluate(() => { const i = window.__limitInput(); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(200);
  const c3 = await p.evaluate(() => ({ t: window.__counter(), v: S.documents[0].charLimit }));
  ok(c3.v === 0 && /^700 字$/.test(c3.t.trim()), `空にすると制限なしに戻る (${c3.t} / ${c3.v})`);

  /* おかしな値を入れても壊れない */
  await p.evaluate(() => { const i = window.__limitInput(); i.value = '-5'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(150);
  const c4 = await p.evaluate(() => ({ t: window.__counter(), v: S.documents[0].charLimit }));
  ok(c4.v === 0 && c4.t.indexOf('字') >= 0, `マイナスは制限なしとして扱う (${c4.t})`);
  await p.context().close();
}

/* ---------- 4. 本文の書きかけと、複製 ---------- */
{
  const p = await open();
  await p.evaluate(() => {
    S.schools = [{ id: 's1', name: '見本大学', faculty: '法学部', docs: '志望理由書', docList: ['志望理由書'], checklist: {}, tasks: [] }];
    S.documents = [{ id: 'd4', schoolId: 's1', title: '志望理由書', type: '志望理由書', status: '修正中',
                     body: 'え'.repeat(120), charLimit: 400, notes: 'メモです',
                     feedbacks: [{ id: 'f1', from: '先生', comment: 'ここを直して', done: false }],
                     versions: [{ ts: 1, body: '昔の本文' }], updatedAt: Date.now() }];
    S.tasks = []; save(); render();
  });
  await p.evaluate(HELPERS);
  await p.evaluate(() => openDocEditor('d4'));
  await p.waitForTimeout(300);
  /* 本文の textarea は data-body で名指しできること（AI分析タブが本文を拾うため）。
     以前は「シート内の最初の textarea」に頼っていたが、設問の入力欄が増えたので目印で取る。 */
  const first = await p.evaluate(() => {
    const ta = document.querySelector('#sheet textarea[data-body]');
    return ta ? ta.getAttribute('aria-label') : '';
  });
  ok(first === '本文', `本文の入力欄を data-body で特定できる (${first})`);

  await p.evaluate(() => {
    const ta = document.querySelector('#sheet textarea[data-body]'); ta.value = 'お'.repeat(50);
    [].slice.call(document.querySelectorAll('#sheet button')).filter(b => b.textContent.indexOf('複製') >= 0)[0].click();
  });
  await p.waitForTimeout(400);
  const dup = await p.evaluate(() => {
    const c = S.documents.filter(x => x.id !== 'd4')[0];
    return c ? { n: S.documents.length, title: c.title, len: countJP(c.body), sid: c.schoolId,
                 lim: c.charLimit, notes: c.notes, ver: (c.versions || []).length, fb: (c.feedbacks || []).length,
                 shared: c.feedbacks[0] === S.documents.filter(x => x.id === 'd4')[0].feedbacks[0] } : null;
  });
  ok(dup && dup.n === 2, `複製すると書類が2件になる (${dup && dup.n})`);
  ok(dup && dup.title.indexOf('（複製）') >= 0, `複製のタイトルに（複製）が付く (${dup && dup.title})`);
  ok(dup && dup.len === 50, `画面の本文が複製に入る (${dup && dup.len}字)`);
  ok(dup && dup.sid === 's1' && dup.lim === 400 && dup.notes === 'メモです', '志望校・文字数制限・メモを引き継ぐ');
  ok(dup && dup.ver === 0, `バージョン履歴は引き継がない (${dup && dup.ver}件)`);
  ok(dup && dup.fb === 1 && dup.shared === false, 'フィードバックは別物としてコピーされる');
  await p.context().close();
}

/* ---------- 5. 古いデータ・書き方の確認 ---------- */
{
  const p = await open();
  const r = await p.evaluate(() => {
    const old = { schools: [{ id: 'o1', name: '旧データ大学' }],
                  documents: [{ id: 'o2', title: '旧書類', body: 'あ' }],
                  tasks: [{ id: 'o3', title: '旧タスク' }] };
    S = migrate(old); save();
    try {
      go('documents');
      openDocEditor(S.documents[0].id);
      const sheetText = document.querySelector('#sheet').innerText;
      return { okOpen: true, hasSchool: sheetText.indexOf('志望校') >= 0,
               m1: docMatchesLabel({ type: '志望理由書', title: 'x' }, '志望理由書'),
               m2: docMatchesLabel({ type: 'その他', title: '見本大 活動報告書' }, '活動報告書'),
               m3: docMatchesLabel({ type: 'その他', title: 'メモ' }, '志望理由書'),
               m4: docMatchesLabel(null, '志望理由書'),
               m5: docMatchesLabel({ type: 'その他', title: 'メモ' }, null),
               cp: (function () { const a = { x: 1, y: { z: 2 } }; const b = shallowCopy(a); b.x = 9; return a.x === 1 && b.y === a.y; })(),
               cpNull: JSON.stringify(shallowCopy(null)) };
    } catch (e) { return { okOpen: String(e) }; }
  });
  ok(r.okOpen === true, `志望校も文字数制限も無い古い書類でエディターが開く (${r.okOpen})`);
  ok(r.hasSchool === true, '古い書類でも志望校欄が出る');
  ok(r.m1 === true && r.m2 === true && r.m3 === false, '必要書類との対応づけ（種別・タイトル）が従来どおり');
  ok(r.m4 === false && r.m5 === false, '空を渡しても対応づけで落ちない');
  ok(r.cp === true, 'shallowCopy は元のオブジェクトを書き換えない');
  ok(r.cpNull === '{}', 'shallowCopy(null) は空のオブジェクト');
  await p.context().close();
}

/* ---------- 6. 全画面がひととおり開く（後退していないか） ---------- */
{
  const p = await open();
  const bad = await p.evaluate(() => {
    const out = [];
    ['home', 'schools', 'documents', 'interview', 'tasks', 'portfolio', 'settings'].forEach(v => {
      try { go(v); if (document.querySelector('#root').innerText.trim().length < 20) out.push(v + '(空)'); }
      catch (e) { out.push(v + '(' + e + ')'); }
    });
    return out.join(',');
  });
  ok(bad === '', `全画面が開く (${bad || 'すべてOK'})`);
  await p.context().close();
}

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
if (errors.length) { console.log('JSエラー:', errors.slice(0, 5)); }
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
