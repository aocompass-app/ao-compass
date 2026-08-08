/* 提出書類：タイトル・設問の後付け編集／閉じたときの自動保存   使い方: node tests/doc-title-question.mjs
   確かめること：
   ・編集タブの「タイトル・設問を直す」から、あとからタイトルと設問を入れられること
   ・設問を入れると上の設問の枠がその場で出て、消すと引っ込むこと（エスケープも）
   ・タイトルを必要書類名に合わせると取り組み状況に結びつき、未着手の緊急タスクが減ること
   ・タイトルは空にできず、元に戻ること
   ・本文の入力欄が data-body で名指しでき、設問の入力欄が増えても AI分析タブが本文を壊さないこと
   ・打った直後に「×」や背景タップで閉じても、本文の最後の一文が消えないこと
   ・設問・タイトルを持たない古いデータでも、エディターがそのまま開くこと            */
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

/* ページ側の小道具：たたんだカードを開く／ラベルで入力欄を探す／値を入れて確定させる */
const HELPERS = `
  window.__openMeta = function(){
    var hit = null;
    document.querySelectorAll('#sheet details.tg').forEach(function(d){
      var s = d.querySelector('summary');
      if (s && s.textContent.indexOf('タイトル・設問') >= 0) hit = d;
    });
    if (hit) hit.open = true;
    return !!hit;
  };
  window.__inp = function(label){
    var out = null;
    document.querySelectorAll('#sheet .field').forEach(function(f){
      var lb = f.querySelector('label');
      if (lb && lb.textContent.trim().indexOf(label) === 0 && !out) out = f.querySelector('input,textarea,select');
    });
    return out;
  };
  window.__set = function(label, v){
    var i = window.__inp(label); if (!i) return false;
    i.value = v;
    i.dispatchEvent(new Event('input', {bubbles:true}));
    i.dispatchEvent(new Event('change', {bubbles:true}));
    return true;
  };
  window.__qbox = function(){
    var n = document.querySelector('#sheet .note.info');
    if (!n) return null;
    return { shown: n.style.display !== 'none', html: n.innerHTML };
  };
  window.__head = function(){ var h = document.querySelector('#sheet .sheet-head h3'); return h ? h.textContent : ''; };
  window.__body = function(){ return document.querySelector('#sheet textarea[data-body]'); };
  window.__tab = function(name){
    var b = [].slice.call(document.querySelectorAll('#sheet .seg button'))
             .filter(function(x){ return x.textContent.indexOf(name) >= 0; })[0];
    if (b) b.click();
    return !!b;
  };
  window.__saved = function(){
    try { return JSON.parse(localStorage.getItem('aoCompass_v1')); } catch(e) { return null; }
  };
`;

/* ===== 1. 設問が空の書類：枠は出ないが、あとから入れるとその場で出る ===== */
{
  const p = await open();
  await p.evaluate(() => {
    S.schools = [{ id: 's1', name: '見本大学', faculty: '法学部', deadline: '2026-11-01',
                   docs: '志望理由書、活動報告書', checklist: {}, tasks: [] }];
    S.documents = [{ id: 'd1', schoolId: 's1', title: '無題のメモ', type: 'その他', question: '',
                     charLimit: 0, status: '下書き', body: '', notes: '', feedbacks: [], versions: [],
                     updatedAt: Date.now() }];
    S.tasks = []; save(); render();
  });
  await p.evaluate(HELPERS);
  await p.evaluate(() => openDocEditor('d1'));
  await p.waitForTimeout(300);

  const q0 = await p.evaluate(() => window.__qbox());
  ok(q0 && q0.shown === false, '設問が空のうちは、設問の枠が出ない');

  ok(await p.evaluate(() => window.__openMeta()), '「タイトル・設問を直す」カードが編集タブにある');

  ok(await p.evaluate(() => window.__set('設問', '学びたいことと、その理由を述べてください')),
     '設問の入力欄がある');
  await p.waitForTimeout(150);
  const q1 = await p.evaluate(() => window.__qbox());
  ok(q1 && q1.shown === true, '設問を入れると設問の枠がその場で出る');
  ok(q1 && q1.html.indexOf('学びたいこと') >= 0, `設問の中身が枠に出る (${q1 && q1.html.slice(0, 30)})`);
  ok(await p.evaluate(() => S.documents[0].question.indexOf('学びたいこと') >= 0), '設問が S に入る');
  ok(await p.evaluate(() => (window.__saved().documents[0].question || '').indexOf('学びたいこと') >= 0),
     '設問が端末（localStorage）に保存される');

  /* 改行とタグ：生の HTML として入らないこと */
  await p.evaluate(() => window.__set('設問', '一行目\n<b>強調</b>'));
  await p.waitForTimeout(150);
  const q2 = await p.evaluate(() => window.__qbox());
  ok(q2 && q2.html.indexOf('<br>') >= 0, '設問の改行が <br> で表示される');
  ok(q2 && q2.html.indexOf('<b>強調</b>') < 0 && q2.html.indexOf('&lt;b&gt;') >= 0,
     '設問に書いたタグはそのまま文字として出る（エスケープされる）');

  /* 空に戻すと引っ込む */
  await p.evaluate(() => window.__set('設問', ''));
  await p.waitForTimeout(150);
  const q3 = await p.evaluate(() => window.__qbox());
  ok(q3 && q3.shown === false, '設問を空に戻すと枠が引っ込む');
  ok(await p.evaluate(() => S.documents[0].question === ''), '設問を空にしたことも保存される');
  await p.context().close();
}

/* ===== 2. タイトルの後付け：見出し・一覧・必要書類の突き合わせに効く ===== */
{
  const p = await open();
  await p.evaluate(() => {
    S.schools = [{ id: 's1', name: '見本大学', faculty: '法学部', deadline: '2026-11-01',
                   docs: '志望理由書、活動報告書', checklist: {}, tasks: [] }];
    S.documents = [{ id: 'd1', schoolId: 's1', title: '無題のメモ', type: 'その他', question: '',
                     charLimit: 0, status: '下書き', body: 'あ'.repeat(300), notes: '', feedbacks: [],
                     versions: [], updatedAt: Date.now() }];
    S.tasks = []; save(); go('documents');
  });
  await p.waitForTimeout(400);
  await p.evaluate(HELPERS);

  const before = await p.evaluate(() => ({
    state: docProgress(S.schools[0], '志望理由書').state,
    auto: S.tasks.filter(t => t.docauto && !t.done).length
  }));
  ok(before.state === 'none', `直す前は志望理由書が未登録 (${before.state})`);
  ok(before.auto === 2, `直す前は未着手の緊急タスクが2件 (${before.auto}件)`);

  await p.evaluate(() => openDocEditor('d1'));
  await p.waitForTimeout(300);
  await p.evaluate(() => window.__openMeta());
  ok(await p.evaluate(() => { var i = window.__inp('書類タイトル'); return !!i && i.value === '無題のメモ'; }),
     'タイトル欄に今のタイトルが入っている');

  await p.evaluate(() => window.__set('書類タイトル', '見本大 志望理由書 第1稿'));
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => window.__head().indexOf('志望理由書') >= 0),
     `シートの見出しがその場で変わる (${await p.evaluate(() => window.__head())})`);
  ok(await p.evaluate(() => S.documents[0].title === '見本大 志望理由書 第1稿'), 'タイトルが S に入る');
  ok(await p.evaluate(() => window.__saved().documents[0].title === '見本大 志望理由書 第1稿'),
     'タイトルが端末に保存される');

  const after = await p.evaluate(() => ({
    state: docProgress(S.schools[0], '志望理由書').state,
    auto: S.tasks.filter(t => t.docauto && !t.done).length
  }));
  ok(after.state === 'wip', `タイトルを合わせると取り組み状況が作成中になる (${after.state})`);
  ok(after.auto === 1, `未着手の緊急タスクが1件に減る (${after.auto}件)`);

  /* 前回入れた案内文が「反映されます」に切りかわること */
  const note = await p.evaluate(() => document.querySelector('#sheet').innerText);
  ok(note.indexOf('反映されます') >= 0, '「必要書類として反映されます」の案内に切りかわる');

  /* 空タイトルは受け付けない */
  await p.evaluate(() => window.__set('書類タイトル', '   '));
  await p.waitForTimeout(250);
  ok(await p.evaluate(() => S.documents[0].title === '見本大 志望理由書 第1稿'), 'タイトルは空にできない');
  ok(await p.evaluate(() => { var i = window.__inp('書類タイトル'); return i.value === '見本大 志望理由書 第1稿'; }),
     '空にしようとすると入力欄が元に戻る');
  ok(await p.evaluate(() => window.__head().indexOf('志望理由書') >= 0), '空にしようとしても見出しは元のまま');

  /* 一覧にも反映されている */
  await p.evaluate(() => closeSheet());
  await p.waitForTimeout(300);
  ok((await p.evaluate(() => document.querySelector('#root').innerText)).indexOf('見本大 志望理由書 第1稿') >= 0,
     '書類の一覧にも新しいタイトルが出る');
  await p.context().close();
}

/* ===== 3. 本文の入力欄が名指しでき、AI分析タブが本文を壊さない ===== */
{
  const p = await open();
  await p.evaluate(() => {
    S.schools = []; S.tasks = [];
    S.documents = [{ id: 'd1', schoolId: null, title: '志望理由書', type: '志望理由書',
                     question: 'これは設問です', charLimit: 0, status: '下書き',
                     body: '本文です。'.repeat(20), notes: '', feedbacks: [], versions: [], updatedAt: Date.now() }];
    save(); render();
  });
  await p.evaluate(HELPERS);
  await p.evaluate(() => openDocEditor('d1'));
  await p.waitForTimeout(300);
  await p.evaluate(() => window.__openMeta());

  ok(await p.evaluate(() => { var t = window.__body(); return !!t && t.getAttribute('aria-label') === '本文'; }),
     '本文の入力欄を data-body で名指しできる');
  const n = await p.evaluate(() => document.querySelectorAll('#sheet textarea').length);
  ok(n >= 3, `編集タブに設問・本文・メモの入力欄がそろっている (${n}個)`);
  ok(await p.evaluate(() => document.querySelectorAll('#sheet textarea[data-body]').length === 1),
     '本文の目印が付いた入力欄はひとつだけ');

  /* 設問の入力欄のほうが先にあっても、本文が設問で上書きされないこと */
  const order = await p.evaluate(() => {
    var all = [].slice.call(document.querySelectorAll('#sheet textarea'));
    return all.indexOf(window.__body());
  });
  ok(order > 0, `設問の入力欄が本文より前にある（＝順番に頼れない状況を再現できている, index ${order}）`);

  await p.evaluate(() => { window.__body().value = 'あ'.repeat(120); });
  await p.evaluate(() => window.__tab('AI分析'));
  await p.waitForTimeout(500);
  const body = await p.evaluate(() => S.documents[0].body);
  ok(body === 'あ'.repeat(120), `AI分析タブに移っても本文がそのまま拾われる (${body.length}字)`);
  ok(body.indexOf('これは設問') < 0, '設問の内容が本文に入り込まない');
  await p.context().close();
}

/* ===== 4. 打った直後に閉じても、本文の最後の一文が消えない ===== */
{
  const p = await open();
  await p.evaluate(() => {
    S.schools = []; S.tasks = [];
    S.documents = [{ id: 'd1', schoolId: null, title: '志望理由書', type: '志望理由書', question: '',
                     charLimit: 0, status: '下書き', body: '', notes: '', feedbacks: [], versions: [],
                     updatedAt: Date.now() }];
    save(); render();
  });
  await p.evaluate(HELPERS);
  await p.evaluate(() => openDocEditor('d1'));
  await p.waitForTimeout(300);

  /* 自動保存（700ms）が走る前に、blur を出さずに閉じる＝端末で起きていた消え方 */
  await p.evaluate(() => {
    var t = window.__body();
    t.value = '最後に打った一文です。';
    t.dispatchEvent(new Event('input', { bubbles: true }));
    closeSheet();
  });
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => S.documents[0].body === '最後に打った一文です。'),
     '打った直後に閉じても本文が残る');
  ok(await p.evaluate(() => window.__saved().documents[0].body === '最後に打った一文です。'),
     '打った直後に閉じても端末に保存されている');

  /* 続きを書いて、背景タップ（overlay クリック）で閉じても同じ */
  await p.evaluate(() => openDocEditor('d1'));
  await p.waitForTimeout(300);
  await p.evaluate(() => {
    var t = window.__body();
    t.value = '最後に打った一文です。続きも書きました。';
    t.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.evaluate(() => { document.querySelector('#overlay').click(); });
  await p.waitForTimeout(250);
  ok(await p.evaluate(() => S.documents[0].body.indexOf('続きも書きました') >= 0),
     '背景タップで閉じても続きが残る');

  /* 保存待ちが持ち越されないこと（閉じたあとに別の書類を開いて上書きされない） */
  await p.evaluate(() => {
    S.documents.push({ id: 'd2', schoolId: null, title: 'べつの書類', type: 'その他', question: '',
                       charLimit: 0, status: '下書き', body: 'もとの本文', notes: '', feedbacks: [],
                       versions: [], updatedAt: Date.now() });
    save(); openDocEditor('d2');
  });
  await p.waitForTimeout(300);
  await p.evaluate(() => closeSheet());
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => S.documents[1].body === 'もとの本文'), '何も書かずに閉じても別の書類は変わらない');
  ok(await p.evaluate(() => S.documents[0].body.indexOf('続きも書きました') >= 0),
     '前に開いていた書類の本文も無事');
  await p.context().close();
}

/* ===== 5. 古いデータ・他のシートを壊していない ===== */
{
  const p = await open();
  const res = await p.evaluate(() => {
    const old = { schools: [{ id: 'o1', name: '旧データ大学' }],
                  documents: [{ id: 'o2', title: '旧書類', body: 'あ' }],
                  tasks: [{ id: 'o3', title: '旧タスク' }] };
    S = migrate(old); save();
    try {
      ['home', 'schools', 'documents', 'interview', 'tasks', 'portfolio', 'settings'].forEach(v => go(v));
      openDocEditor('o2');
      const has = !!document.querySelector('#sheet textarea[data-body]');
      closeSheet();
      return { okAll: true, has: has, body: S.documents[0].body };
    } catch (e) { return { okAll: String(e) }; }
  });
  ok(res.okAll === true, `設問もタイトルも無い古いデータで全画面＋エディターが開く (${res.okAll})`);
  ok(res.has === true, '古いデータでも本文の入力欄に目印が付く');
  ok(res.body === 'あ', '古いデータの本文が閉じたときに壊れない');

  /* 書類以外のシートも、閉じる処理を変えたあとで従来どおり動く */
  const other = await p.evaluate(() => {
    try {
      editTask(null); closeSheet();
      newDoc(); closeSheet();
      go('schools'); editSchool(null); closeSheet();
      return true;
    } catch (e) { return String(e); }
  });
  ok(other === true, `タスク・新規書類・志望校のシートも開いて閉じられる (${other})`);
  await p.context().close();
}

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
if (errors.length) { console.log('JSエラー:', errors.slice(0, 5)); }
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
