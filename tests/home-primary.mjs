/* ホームの「第一志望」の選び方テスト   使い方: node tests/home-primary.mjs
   確かめること
   1) 「★ 第一志望に設定」を押していなくても、志望順位の第1志望がホームの第一志望になる
      （今までは登録した順の1校目が出るので、あとから登録した本命が出てこなかった）
   2) ★で設定してあるときは、そちらが優先される（今までの動きを変えない）
   3) 志望順位も設定も無ければ、今までどおり登録順の1校目
   4) 消した志望校のIDが残っていても壊れない
   5) ホームの中（カウントダウン・今日のひとこと・併願カード）が全部おなじ1校を指す */
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

/* 志望校をいくつか置いてホームを開き、「第一志望」カードが誰を指しているかを返す。
   schools は [{id,name,priority,dl}]、pid は S.meta.primarySchoolId に入れる値 */
async function heroOf(p, schools, pid) {
  return await p.evaluate(a => {
    const at = n => isoAdd(todayISO(), n);
    S.schools = a.list.map(x => {
      const s = { id: x.id, name: x.name, faculty: '総合学部', checklist: {} };
      if (x.priority !== undefined) s.priority = x.priority;
      if (x.dl != null) s.deadline = at(x.dl);
      return s;
    });
    S.documents = []; S.tasks = []; S.interview = [];
    S.meta.primarySchoolId = a.pid;
    save(); go('home');
    const card = [...document.querySelectorAll('#root .card')].find(c => /第一志望/.test(c.innerText));
    const other = document.querySelector('#root [data-home-deadlines]');
    const note = [...document.querySelectorAll('#root .ai-note')].find(x => /今日のひとこと/.test(x.innerText));
    return {
      hero: card ? card.innerText.replace(/\s+/g, ' ') : '(第一志望カードが無い)',
      other: other ? other.innerText.replace(/\s+/g, ' ') : '',
      advice: note ? note.innerText.replace(/\s+/g, ' ') : '',
      picked: typeof primarySchool === 'function' ? ((primarySchool() || {}).id || null) : '(primarySchool が無い)'
    };
  }, { list: schools, pid: pid });
}

/* --- 1. ★未設定でも、志望順位の第1が第一志望になる --- */
{
  const p = await open();
  const r = await heroOf(p, [
    { id: 'x', name: '滑り止め大学', priority: 3, dl: 40 },
    { id: 'y', name: '本命大学', priority: 1, dl: 60 },
    { id: 'z', name: '併願大学', priority: 2, dl: 50 }
  ], null);
  ok(r.picked === 'y', `★を押していなくても第1志望が選ばれる (${r.picked})`);
  ok(r.hero.includes('本命大学') && !r.hero.includes('滑り止め大学'), `第一志望カードが本命大学になる (${r.hero.slice(0, 40)})`);
  ok(/第1志望/.test(r.hero), `志望順位の帯も出る (${r.hero.slice(0, 40)})`);
  ok(/あと60日/.test(r.hero) || /60/.test(r.hero), `カウントダウンも本命大学の締切になる (${r.hero.slice(0, 50)})`);
  ok(!r.other.includes('本命大学'), '併願カードに第一志望を重ねて出さない');
  ok(r.other.includes('滑り止め大学') && r.other.includes('併願大学'), `ほかの2校は併願カードに出る (${r.other.slice(0, 50)})`);
  await p.context().close();
}

/* --- 2. 第1志望がいなければ、いちばん小さい志望順位 --- */
{
  const p = await open();
  const r = await heroOf(p, [
    { id: 'a', name: '第4志望大学', priority: 4, dl: 30 },
    { id: 'b', name: '第2志望大学', priority: 2, dl: 30 }
  ], null);
  ok(r.picked === 'b', `第1志望がいなければ順位のいちばん上 (${r.picked})`);
  await p.context().close();
}

/* --- 3. 志望順位が文字で入っていても数として比べる --- */
{
  const p = await open();
  const r = await heroOf(p, [
    { id: 'a', name: '十番目大学', priority: '10', dl: 30 },
    { id: 'b', name: '二番目大学', priority: '2', dl: 30 }
  ], null);
  ok(r.picked === 'b', `"10" と "2" を数として比べる (${r.picked})`);
  await p.context().close();
}

/* --- 4. ★で設定してあれば、そちらが勝つ（今までの動きを変えない） --- */
{
  const p = await open();
  const r = await heroOf(p, [
    { id: 'a', name: '順位は1位の大学', priority: 1, dl: 30 },
    { id: 'b', name: '★で選んだ大学', priority: 5, dl: 30 }
  ], 'b');
  ok(r.picked === 'b', `★の設定が志望順位より優先される (${r.picked})`);
  ok(r.hero.includes('★で選んだ大学'), `第一志望カードも★の大学 (${r.hero.slice(0, 40)})`);
  await p.context().close();
}

/* --- 5. 志望順位がどこにも無ければ、今までどおり登録順の1校目 --- */
{
  const p = await open();
  const r = await heroOf(p, [
    { id: 'a', name: '最初に登録した大学', dl: 30 },
    { id: 'b', name: 'あとで登録した大学', dl: 10 }
  ], null);
  ok(r.picked === 'a', `順位が無ければ登録順の1校目のまま (${r.picked})`);
  ok(r.hero.includes('最初に登録した大学'), '今までの表示を変えない');
  await p.context().close();
}

/* --- 6. 消した志望校のIDが残っていても壊れない --- */
{
  const p = await open();
  const r = await heroOf(p, [
    { id: 'a', name: '残っている大学', priority: 2, dl: 30 }
  ], 'もう無いID');
  ok(r.picked === 'a', `消えたIDが残っていても残りの1校を指す (${r.picked})`);
  ok(r.hero.includes('残っている大学'), 'ホームが空にならない');
  await p.context().close();
}

/* --- 7. 志望校が0校でもホームが開く --- */
{
  const p = await open();
  const r = await p.evaluate(() => {
    S.schools = []; S.tasks = []; S.interview = [];
    S.documents = [{ id: 'd1', title: '書類だけある', body: 'あ', status: '下書き' }];
    S.meta.primarySchoolId = null;
    save();
    try { go('home'); return { pick: primarySchool() === undefined || primarySchool() === null, len: document.querySelector('#root').innerText.length }; }
    catch (e) { return String(e); }
  });
  ok(r && r.pick === true, `志望校0校なら第一志望はいない (${JSON.stringify(r)})`);
  ok(r && r.len > 20, 'それでもホームは開く');
  await p.context().close();
}

/* --- 8. カウントダウン・ひとこと・併願カードが同じ1校を指している --- */
{
  const p = await open();
  const r = await heroOf(p, [
    { id: 'x', name: 'あとまわし大学', priority: 3, dl: 5 },
    { id: 'y', name: 'ほんめい大学', priority: 1, dl: 20 }
  ], null);
  ok(/出願締切まで\s*あと20日/.test(r.advice), `今日のひとことも第一志望の日程 (${r.advice.slice(0, 40)})`);
  ok(r.other.includes('あとまわし大学') && /あと5日/.test(r.other), `締切が近い併願校はちゃんと別枠で出る (${r.other.slice(0, 50)})`);
  await p.context().close();
}

/* --- 9. 古い形のデータでも壊れない --- */
{
  const p = await open();
  const okOld = await p.evaluate(() => {
    const old = { schools: [{ id: 'o1', name: '旧データ大学' }, { id: 'o2', name: '旧データ短大' }],
                  documents: [], tasks: [] };
    S = migrate(old); save();
    try { go('home'); return (primarySchool() || {}).id === 'o1'; } catch (e) { return String(e); }
  });
  ok(okOld === true, `志望順位の項目が無い古いデータでも1校目を指す (${okOld})`);
  await p.context().close();
}

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
if (errors.length) { console.log('JSエラー:', errors.slice(0, 5)); }
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
