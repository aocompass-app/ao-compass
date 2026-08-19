/* 志望校の検索テスト   使い方: node tests/school-search.mjs
   確かめること：
   ・検索で0件になったとき「志望校がまだありません」ではなく検索用の案内が出ること
   ・「検索をクリア」で元の一覧に戻ること
   ・入試方式・調査メモでも探せること
   ・カタカナ／ひらがな・大文字小文字・全角スペースの違いで取りこぼさないこと
   ・学部や学科が空の学校でも undefined が検索に混ざらないこと
   ・並び替え・詳細ボタンなど今までの動きが変わらないこと                 */
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

/* 画面に出ている志望校カードの名前を上から順に */
const NAMES = `(() => [...document.querySelectorAll('#root .card')]
  .filter(el => el.innerText.indexOf('詳細・チェックリスト') >= 0)
  .map(el => (el.innerText.split('\\n')[0] || '').replace(/第\\d志望/, '').trim()))()`;

/* 検索欄に文字を入れる */
const TYPE = kw => `(() => { const q = document.querySelector('#root .searchbar .input');
  q.value = ${JSON.stringify(kw)}; q.oninput(); return true; })()`;

const ROOT = `document.querySelector('#root').innerText.replace(/\\s+/g,' ')`;

/* 4校。
   ・早稲田大学 …… 一覧に載っている大学（読み「わせだだいがく」）
   ・海の星大学 …… 学部・学科がそもそも無い（undefined 混入の確認用）
   ・カタカナ学院大学 … カタカナを含む名前
   ・メモ大学 …… 入試方式と調査メモにだけ手がかりがある                */
const SETUP = `(() => {
  S.schools = [
    { id:'w', name:'早稲田大学', faculty:'政治経済学部', dept:'経済学科', method:'総合型選抜',
      notes:'', priority:1, checklist:{} },
    { id:'u', name:'海の星大学', priority:2, checklist:{} },
    { id:'k', name:'カタカナ学院大学', faculty:'国際学部', dept:'', method:'',
      notes:'', priority:3, checklist:{} },
    { id:'m', name:'メモ大学', faculty:'文学部', dept:'', method:'AO入試 II期',
      notes:'オープンキャンパスは8月', priority:4, checklist:{} }
  ];
  S.documents = []; S.tasks = [];
  vSchools._q = ''; vSchools._sort = 'pri';
  save(); go('schools');
})()`;

{
  const p = await open();
  await p.evaluate(SETUP);

  const all = await p.evaluate(NAMES);
  ok(all.length === 4, `最初は4校ぜんぶ出る (${all.join('／')})`);

  /* --- 0件のときの案内 --- */
  await p.evaluate(TYPE('存在しない大学'));
  const none = await p.evaluate(ROOT);
  ok(await p.evaluate(NAMES).then(a => a.length === 0), '当てはまらない言葉なら1件も出ない');
  ok(/見つかりませんでした/.test(none), '「見つかりませんでした」が出る');
  ok(/存在しない大学/.test(none), '入力した言葉をそのまま見せてくれる');
  ok(!/志望校がまだありません/.test(none), '「志望校がまだありません」は出さない');
  ok(!/志望校を登録/.test(none), '登録ボタン（未登録のときの案内）は出さない');

  /* 検索をクリア */
  const cleared = await p.evaluate(`(() => {
    const b = [...document.querySelectorAll('#root button')].filter(x => x.textContent === '検索をクリア')[0];
    if (!b) return 'ボタンが無い';
    b.click();
    return { n: [...document.querySelectorAll('#root .card')]
               .filter(el => el.innerText.indexOf('詳細・チェックリスト') >= 0).length,
             box: document.querySelector('#root .searchbar .input').value }; })()`);
  ok(cleared.n === 4 && cleared.box === '', `「検索をクリア」で4校に戻り入力欄も空になる (${JSON.stringify(cleared)})`);

  /* --- 今までどおりの絞り込み --- */
  await p.evaluate(TYPE('早稲田'));
  ok(await p.evaluate(NAMES).then(a => a.join('') === '早稲田大学'), '大学名で絞り込める');
  await p.evaluate(TYPE('政治経済'));
  ok(await p.evaluate(NAMES).then(a => a.join('') === '早稲田大学'), '学部で絞り込める');
  await p.evaluate(TYPE('経済学科'));
  ok(await p.evaluate(NAMES).then(a => a.join('') === '早稲田大学'), '学科で絞り込める');

  /* --- 新しく探せるようになったもの --- */
  await p.evaluate(TYPE('AO入試'));
  ok(await p.evaluate(NAMES).then(a => a.join('') === 'メモ大学'), '入試方式で探せる');
  await p.evaluate(TYPE('オープンキャンパス'));
  ok(await p.evaluate(NAMES).then(a => a.join('') === 'メモ大学'), '調査メモで探せる');

  /* --- ひらがな・カタカナ・大文字小文字・全角スペース --- */
  await p.evaluate(TYPE('わせだ'));
  ok(await p.evaluate(NAMES).then(a => a.join('') === '早稲田大学'), 'ひらがなの読みで探せる');
  await p.evaluate(TYPE('かたかな'));
  ok(await p.evaluate(NAMES).then(a => a.join('') === 'カタカナ学院大学'), 'ひらがなで打ってもカタカナの名前に当たる');
  await p.evaluate(TYPE('ao入試'));
  ok(await p.evaluate(NAMES).then(a => a.join('') === 'メモ大学'), '小文字で打っても大文字に当たる');
  await p.evaluate(TYPE('　早稲田　'));
  ok(await p.evaluate(NAMES).then(a => a.join('') === '早稲田大学'), '前後の全角スペースがあっても効く');

  /* --- undefined が混ざらない --- */
  await p.evaluate(TYPE('undefined'));
  ok(await p.evaluate(NAMES).then(a => a.length === 0), '学部・学科が無い学校が「undefined」で引っかからない');
  await p.evaluate(TYPE('海の星'));
  ok(await p.evaluate(NAMES).then(a => a.join('') === '海の星大学'), '学部・学科が無い学校もちゃんと名前で探せる');

  /* --- 検索と並び替えを一緒に使っても壊れない --- */
  const mix = await p.evaluate(`(() => {
    const seg = document.querySelector('#root .seg');
    [...seg.querySelectorAll('button')].filter(x => x.textContent === '日程が近い順')[0].click();
    const q = document.querySelector('#root .searchbar .input');
    q.value = 'そんな大学ない'; q.oninput();
    const a = document.querySelector('#root').innerText.indexOf('見つかりませんでした') >= 0;
    const b = [...document.querySelectorAll('#root button')].filter(x => x.textContent === '検索をクリア')[0];
    b.click();
    return { a, n: [...document.querySelectorAll('#root .card')]
      .filter(el => el.innerText.indexOf('詳細・チェックリスト') >= 0).length,
      on: (document.querySelector('#root .seg button.on')||{}).textContent }; })()`);
  ok(mix.a === true && mix.n === 4 && mix.on === '日程が近い順',
    `日程順のままでも0件案内とクリアが動く (${JSON.stringify(mix)})`);

  /* 検索は保存データに触らない */
  const stored = await p.evaluate(`JSON.parse(localStorage.getItem(lsKey())).schools.map(s=>s.id).join('')`);
  ok(stored === 'wukm', `検索しても保存データは変わらない (${stored})`);

  /* 詳細シートは今までどおり開く */
  const sheet = await p.evaluate(`(() => { openSchool('u');
    const t = document.querySelector('#sheet').innerText.replace(/\\s+/g,' '); closeSheet(); return t; })()`);
  ok(/海の星大学/.test(sheet) && /出願チェックリスト/.test(sheet), '検索したあとでも詳細シートが開く');

  await p.context().close();
}

/* 0校のときは今までどおりの案内（検索用の案内にすり替わらない） */
{
  const p = await open();
  const r = await p.evaluate(`(() => { S.schools = []; vSchools._q = ''; save(); go('schools');
    const t = document.querySelector('#root').innerText;
    return { empty: t.indexOf('志望校がまだありません') >= 0,
             notfound: t.indexOf('見つかりませんでした') >= 0 }; })()`);
  ok(r.empty === true && r.notfound === false, '0校ならこれまでどおり「志望校がまだありません」');
  await p.context().close();
}

/* 古いデータ（学部も方式もメモも無い）で検索しても落ちない */
{
  const p = await open();
  const okOld = await p.evaluate(`(() => {
    S = migrate({ schools: [{ id:'o1', name:'旧データ大学' }, { id:'o2', name:'旧データ大学2' }] }); save();
    try {
      go('schools');
      const q = document.querySelector('#root .searchbar .input');
      q.value = '旧データ'; q.oninput();
      const a = [...document.querySelectorAll('#root .card')]
        .filter(el => el.innerText.indexOf('詳細・チェックリスト') >= 0).length;
      q.value = 'ぜんぜん違う'; q.oninput();
      const b = document.querySelector('#root').innerText.indexOf('見つかりませんでした') >= 0;
      return { a, b };
    } catch (e) { return String(e); } })()`);
  ok(okOld.a === 2 && okOld.b === true, `古いデータでも検索できる (${JSON.stringify(okOld)})`);
  await p.context().close();
}

/* 横スクロールが出ない（390px） */
{
  const p = await open();
  const w = await p.evaluate(`(() => {
    S.schools = [{ id:'a', name:'とてもとても長い名前の大学', faculty:'総合政策学部', dept:'', method:'', checklist:{} },
                 { id:'b', name:'ふたつめ大学', faculty:'', dept:'', method:'', checklist:{} }];
    save(); go('schools');
    const r = document.querySelector('#root');
    return { sw: r.scrollWidth, cw: r.clientWidth }; })()`);
  ok(w.sw <= w.cw, `390px で横スクロールしない (${w.sw}/${w.cw})`);
  await p.context().close();
}

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
if (errors.length) { console.log('JSエラー:', errors.slice(0, 5)); }
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
