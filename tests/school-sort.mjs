/* 志望校の並び替えテスト   使い方: node tests/school-sort.mjs
   確かめること：
   ・志望校が2校以上のときだけ「志望順／日程が近い順」の切り替えが出ること
   ・最初は今までどおり志望順で並ぶこと
   ・「日程が近い順」にすると、次に来る日程（締切だけでなく試験日・合格発表も）が近い順に並ぶこと
   ・日程が無い／全部終わった学校は後ろに回ること
   ・並び替えても保存データの中身と順番が変わらないこと                     */
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

/* 画面に出ている志望校カードの名前を、上から順に取り出す */
const NAMES = `(() => [...document.querySelectorAll('#root .card')]
  .filter(el => el.innerText.indexOf('詳細・チェックリスト') >= 0)
  .map(el => (el.innerText.split('\\n')[0] || '').replace(/第\\d志望/, '').trim()))()`;

/* 並び替えのボタンを名前で押す */
const CLICK = label => `(() => {
  const seg = document.querySelector('#root .seg'); if (!seg) return false;
  const b = [...seg.querySelectorAll('button')].filter(x => x.textContent.indexOf('${label}') >= 0)[0];
  if (!b) return false; b.click(); return true; })()`;

/* 5校。志望順と日程の順番がわざと食い違うように作る。
   ・A 第1志望 …… 締切60日後（いちばん先）
   ・B 第2志望 …… 締切なし・試験日も発表も無い（日程なし）
   ・C 第3志望 …… 締切5日後（いちばん近い）
   ・D 第4志望 …… 締切は過ぎたが試験が12日後（＝締切だけ見ると沈む学校）
   ・E 志望順なし … 全部終わった（後ろへ回る）                        */
const SETUP = `(() => {
  const t = todayISO();
  S.schools = [
    { id:'A', name:'ゆったり大学', priority:1, faculty:'', dept:'', method:'', checklist:{},
      deadline: isoAdd(t, 60), examDate: isoAdd(t, 90), resultDate: isoAdd(t, 110) },
    { id:'B', name:'日程みてい大学', priority:2, faculty:'', dept:'', method:'', checklist:{},
      deadline:'', examDate:'', resultDate:'' },
    { id:'C', name:'せまってる大学', priority:3, faculty:'', dept:'', method:'', checklist:{},
      deadline: isoAdd(t, 5), examDate: isoAdd(t, 40), resultDate: isoAdd(t, 55) },
    { id:'D', name:'出願ずみ大学', priority:4, faculty:'', dept:'', method:'', checklist:{},
      deadline: isoAdd(t, -10), examDate: isoAdd(t, 12), resultDate: isoAdd(t, 35) },
    { id:'E', name:'おわった大学', priority:null, faculty:'', dept:'', method:'', checklist:{},
      deadline: isoAdd(t, -80), examDate: isoAdd(t, -40), resultDate: isoAdd(t, -10) }
  ];
  S.documents = []; S.tasks = [];
  save(); go('schools');
})()`;

{
  const p = await open();
  await p.evaluate(SETUP);

  /* 最初は今までどおり志望順 */
  const first = await p.evaluate(NAMES);
  ok(first.join('／') === 'ゆったり大学／日程みてい大学／せまってる大学／出願ずみ大学／おわった大学',
    `最初は志望順のまま (${first.join('／')})`);

  ok(await p.evaluate(`!!document.querySelector('#root .seg')`), '2校以上なら並び替えの切り替えが出る');
  ok(await p.evaluate(`(document.querySelector('#root .seg button.on')||{}).textContent === '志望順'`),
    '選ばれているのは「志望順」');

  /* 日程が近い順へ */
  ok(await p.evaluate(CLICK('日程が近い順')), '「日程が近い順」のボタンがある');
  const byDate = await p.evaluate(NAMES);
  ok(byDate.join('／') === 'せまってる大学／出願ずみ大学／ゆったり大学／日程みてい大学／おわった大学',
    `次に来る日程が近い順に並ぶ (${byDate.join('／')})`);
  ok(byDate.indexOf('出願ずみ大学') < byDate.indexOf('ゆったり大学'),
    '締切が過ぎていても、試験日が近ければ上に来る');
  ok(byDate.indexOf('日程みてい大学') >= 3 && byDate.indexOf('おわった大学') >= 3,
    '日程が無い学校・全部終わった学校は後ろへ回る');
  ok(await p.evaluate(`(document.querySelector('#root .seg button.on')||{}).textContent === '日程が近い順'`),
    '押したボタンだけが選ばれた見た目になる');

  /* 保存データは並び替えの影響を受けない */
  const stored = await p.evaluate(`JSON.parse(localStorage.getItem(lsKey())).schools.map(s=>s.id).join('')`);
  ok(stored === 'ABCDE', `保存されているデータの順番は変わらない (${stored})`);

  /* 検索と併用 */
  await p.evaluate(`(() => { const q = document.querySelector('#root .searchbar .input');
    q.value = '大学'; q.oninput(); })()`);
  const both = await p.evaluate(NAMES);
  ok(both.length === 5 && both[0] === 'せまってる大学', `検索中も日程順のまま (${both[0]})`);
  await p.evaluate(`(() => { const q = document.querySelector('#root .searchbar .input');
    q.value = 'せまって'; q.oninput(); })()`);
  const one = await p.evaluate(NAMES);
  ok(one.length === 1 && one[0] === 'せまってる大学', `絞り込みも従来どおり効く (${one.join('／')})`);

  /* 別の画面へ行って戻っても選択が残る */
  await p.evaluate(`(() => { vSchools._q = ''; go('home'); go('schools'); })()`);
  const back = await p.evaluate(NAMES);
  ok(back[0] === 'せまってる大学', `画面を移動して戻っても日程順のまま (${back[0]})`);

  /* 志望順へ戻せる */
  ok(await p.evaluate(CLICK('志望順')), '「志望順」に戻すボタンがある');
  const back2 = await p.evaluate(NAMES);
  ok(back2[0] === 'ゆったり大学', `志望順に戻せる (${back2[0]})`);

  await p.context().close();
}

/* 1校だけのときは切り替えを出さない（意味が無いうえ画面がうるさくなる） */
{
  const p = await open();
  const seg1 = await p.evaluate(`(() => {
    S.schools = [{ id:'x', name:'ひとつ大学', checklist:{} }]; save(); go('schools');
    return !!document.querySelector('#root .seg'); })()`);
  ok(seg1 === false, '1校だけなら並び替えは出さない');

  const seg0 = await p.evaluate(`(() => {
    S.schools = []; save(); go('schools');
    return { seg: !!document.querySelector('#root .seg'),
             empty: document.querySelector('#root').innerText.indexOf('志望校がまだありません') >= 0 }; })()`);
  ok(seg0.seg === false && seg0.empty === true, '0校なら並び替えも出ないし、いつもの案内が出る');
  await p.context().close();
}

/* 古いデータ（日付の項目がそもそも無い）でも並び替えで落ちない */
{
  const p = await open();
  const okOld = await p.evaluate(`(() => {
    S = migrate({ schools: [{ id:'o1', name:'旧データ大学' }, { id:'o2', name:'旧データ大学2' }] }); save();
    try {
      go('schools');
      const seg = document.querySelector('#root .seg');
      [...seg.querySelectorAll('button')].filter(x => x.textContent.indexOf('日程') >= 0)[0].click();
      return [...document.querySelectorAll('#root .card')]
        .filter(el => el.innerText.indexOf('詳細・チェックリスト') >= 0).length;
    } catch (e) { return String(e); } })()`);
  ok(okOld === 2, `日付の項目が無い古いデータでも並び替えできる (${okOld})`);
  await p.context().close();
}

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
if (errors.length) { console.log('JSエラー:', errors.slice(0, 5)); }
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
