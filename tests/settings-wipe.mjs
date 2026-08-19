/* STORIA 「すべてのデータを削除」の確認と、データ画面の案内   使い方: node tests/settings-wipe.mjs
   2026.08.19 で入れた confirmWipe（消えるものを件数で見せる／その場で書き出せる）を確かめます。
   バックアップの書き出し・読み込みそのものは backup.mjs / backup-guard.mjs 側で見ています。 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import path from 'path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + path.resolve(HERE, '..', 'index.html');
const EXE = process.env.PW_CHROMIUM || '';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };

const browser = await chromium.launch(EXE ? { executablePath: EXE } : {});
const errors = [];

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(String(e)));
  p.on('console', m => { if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await p.addInitScript('window.__AO_NO_ONBOARD=1;');
  await p.goto(FILE);
  await p.waitForTimeout(400);
  return p;
}

const SEED = () => {
  S.schools = [{ id: 's1', name: '見本大学', faculty: '法学部', deadline: '2026-11-01', docs: '', checklist: {}, tasks: [] },
               { id: 's2', name: '手本大学', faculty: '文学部', deadline: '2026-12-01', docs: '', checklist: {}, tasks: [] }];
  S.documents = [{ id: 'd1', title: '志望理由書', type: '志望理由書', body: 'あ'.repeat(60), status: '下書き', updatedAt: 1 }];
  S.activities = [{ id: 'a1', title: '生徒会' }];
  S.tasks = [{ id: 't1', title: '書類を出す', due: '2026-10-01', done: false }];
  S.essays = []; S.certs = []; S.feedback = []; S.interview = [];
  S.profile = Object.assign({}, S.profile, { name: '見本太郎', onboarded: true });
  save();
};
/* 「すべてのデータを削除」の行を、実際に押して開く */
const openWipeViaButton = async (p) => {
  await p.evaluate(() => sheetData());
  await p.waitForTimeout(200);
  await p.evaluate(() => [...document.querySelectorAll('#sheet .btn')].find(b => b.textContent === 'すべてのデータを削除').click());
  await p.waitForTimeout(250);
};
const btn = (p, label) => p.evaluate(l => {
  const b = [...document.querySelectorAll('#sheet .btn')].find(x => x.textContent === l);
  if (!b) throw new Error('ボタンが無い: ' + l);
  b.click();
}, label);

/* 1. データ画面から削除の確認が開き、消えるものが件数で出る */
{
  const p = await open();
  await p.evaluate(SEED);
  await openWipeViaButton(p);
  const r = await p.evaluate(() => ({
    open: document.querySelector('#overlay').classList.contains('open'),
    head: document.querySelector('#sheet .sheet-head h3').textContent,
    tx: document.querySelector('#sheet').innerText,
    labels: [...document.querySelectorAll('#sheet .btn')].map(b => b.textContent)
  }));
  ok(r.open && r.head === 'すべてのデータを削除', `削除の確認シートが開く (${r.head})`);
  ok(/取り消せません/.test(r.tx), '取り消せないことが書いてある');
  ok(/いま消えるもの/.test(r.tx), '「いま消えるもの」の見出しが出る');
  ok(/志望校 2件/.test(r.tx) && /書類 1件/.test(r.tx) && /活動実績 1件/.test(r.tx) && /タスク 1件/.test(r.tx),
     '消えるものが件数で出る');
  ok(/プロフィール（見本太郎）/.test(r.tx), 'プロフィールの名前も出る');
  ok(r.labels.indexOf('先に今のデータを書き出す') >= 0 && r.labels.indexOf('キャンセル') >= 0 && r.labels.indexOf('削除する') >= 0,
     `3つのボタンが並ぶ (${r.labels.join('/')})`);
  await p.context().close();
}

/* 2. 「先に今のデータを書き出す」は、書き出すだけでシートは開いたまま・データも残る */
{
  const p = await open();
  await p.evaluate(SEED);
  await openWipeViaButton(p);
  const [dl] = await Promise.all([ p.waitForEvent('download'), btn(p, '先に今のデータを書き出す') ]);
  ok(/^ao-compass-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(dl.suggestedFilename()),
     `削除の直前に書き出せる (${dl.suggestedFilename()})`);
  const stream = await dl.createReadStream();
  let raw = ''; for await (const c of stream) raw += c;
  const parsed = JSON.parse(raw);
  ok(parsed.schools.length === 2 && parsed.profile.name === '見本太郎', '書き出した中身は削除前のデータ');
  await p.waitForTimeout(200);
  const still = await p.evaluate(() => ({
    open: document.querySelector('#overlay').classList.contains('open'),
    n: S.schools.length + '/' + S.documents.length
  }));
  ok(still.open, '書き出しても確認シートは開いたまま');
  ok(still.n === '2/1', `書き出しただけではデータは消えない (${still.n})`);
  await p.context().close();
}

/* 3. キャンセル・✕・背景タップでは消えない */
{
  const p = await open();
  await p.evaluate(SEED);
  await openWipeViaButton(p);
  await btn(p, 'キャンセル');
  await p.waitForTimeout(250);
  const a = await p.evaluate(() => S.schools.length + '/' + S.documents.length + '/' + S.profile.name);
  ok(a === '2/1/見本太郎', `キャンセルで残る (${a})`);

  await openWipeViaButton(p);
  await p.evaluate(() => document.querySelector('#sheet .x').click());
  await p.waitForTimeout(250);
  const b2 = await p.evaluate(() => S.schools.length + '/' + S.documents.length);
  ok(b2 === '2/1', `✕で閉じても残る (${b2})`);

  await openWipeViaButton(p);
  await p.mouse.click(195, 40);   /* 背景（シートの外）をタップ */
  await p.waitForTimeout(250);
  const c = await p.evaluate(() => ({ open: document.querySelector('#overlay').classList.contains('open'), n: S.schools.length }));
  ok(!c.open && c.n === 2, `背景タップで閉じても残る (${c.n}件)`);
  await p.context().close();
}

/* 4. 「削除する」を押したときだけ消える。端末の保存にも反映され、全画面が開く */
{
  const p = await open();
  await p.evaluate(SEED);
  await openWipeViaButton(p);
  await btn(p, '削除する');
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem(lsKey()));
    let bad = null;
    ['home', 'schools', 'documents', 'tasks', 'self', 'settings'].forEach(v => {
      try { go(v); if (!document.querySelector('#root').innerHTML) bad = v; } catch (e) { bad = v + ':' + e.message; }
    });
    return { n: S.schools.length + S.documents.length + S.activities.length + S.tasks.length,
             nm: S.profile.name, onb: S.profile.onboarded, savedN: saved.schools.length, bad,
             sheet: document.querySelector('#overlay').classList.contains('open') };
  });
  ok(r.n === 0 && r.nm === '', `押したら本当に消える (残り${r.n}件 / 名前「${r.nm}」)`);
  ok(r.onb === true, '削除しても、はじめの案内が出直さない（onboarded は保つ）');
  ok(r.savedN === 0, '端末の保存にも反映される');
  ok(!r.sheet, '削除したらシートは閉じる');
  ok(r.bad === null, `削除したあと全画面が開く (${r.bad})`);
  await p.context().close();
}

/* 5. 何も入っていないときは、書き出しボタンを出さない */
{
  const p = await open();
  await p.evaluate(() => { S = blankState(); S.profile.onboarded = true; save(); });
  await openWipeViaButton(p);
  const r = await p.evaluate(() => ({
    tx: document.querySelector('#sheet').innerText,
    labels: [...document.querySelectorAll('#sheet .btn')].map(b => b.textContent)
  }));
  ok(/まだ何も入っていません/.test(r.tx), '空なら「まだ何も入っていません」と出る');
  ok(r.labels.indexOf('先に今のデータを書き出す') < 0, `空なら書き出しボタンは出さない (${r.labels.join('/')})`);
  ok(r.labels.indexOf('削除する') >= 0 && r.labels.indexOf('キャンセル') >= 0, '空でも削除・キャンセルは出る');
  await p.context().close();
}

/* 6. データ画面の案内（日付入りのファイル名・確認画面が出ること） */
{
  const p = await open();
  await p.evaluate(SEED);
  await p.evaluate(() => sheetData());
  await p.waitForTimeout(250);
  const tx = await p.evaluate(() => document.querySelector('#sheet').innerText);
  ok(/日付と時刻が入ります/.test(tx), 'ファイル名に日付が入ることが書いてある');
  ok(/確認画面が出ます/.test(tx) && /押すまで、いまのデータは変わりません/.test(tx), '読み込みは確認画面つきだと書いてある');
  ok(/APIキーは含まれません/.test(tx), 'APIキーを含まない旨が書いてある');
  await p.context().close();
}

/* 7. 390px で横にはみ出さない（削除の確認・読み込みの確認とも） */
{
  const p = await open();
  await p.evaluate(SEED);
  await openWipeViaButton(p);
  const w1 = await p.evaluate(() => { const s = document.querySelector('#sheet'); return s.scrollWidth + '/' + s.clientWidth; });
  ok(w1.split('/')[0] === w1.split('/')[1], `削除の確認が横スクロールしない (${w1})`);
  await p.evaluate(() => closeSheet());
  await p.evaluate(() => confirmImport({ schools: [{ id: 'z1', name: 'とても長い名前の大学'.repeat(3) }],
                                         profile: { name: '別人' }, _backupAt: '2026-08-01T09:30:00.000Z', _backupVer: '2026.08.01' },
                                       'ao-compass-backup-2026-08-01-1830.json'));
  await p.waitForTimeout(250);
  const w2 = await p.evaluate(() => { const s = document.querySelector('#sheet'); return s.scrollWidth + '/' + s.clientWidth; });
  ok(w2.split('/')[0] === w2.split('/')[1], `読み込みの確認が横スクロールしない (${w2})`);
  await p.context().close();
}

/* 8. 古い形のデータでも、データ画面と削除の確認が開く */
{
  const p = await open();
  await p.evaluate(() => {
    S = migrate({ schools: [{ id: 'o1', name: '旧データ大学' }], documents: [{ id: 'o2', title: '旧書類', body: 'あ' }] });
    save();
  });
  await openWipeViaButton(p);
  const tx = await p.evaluate(() => document.querySelector('#sheet').innerText);
  ok(/志望校 1件/.test(tx) && /書類 1件/.test(tx), `古いデータでも件数が出る`);
  ok(!/プロフィール（/.test(tx), '名前が無ければプロフィールは数えない');
  await p.context().close();
}

/* 9. 古いiOS Safari で動かない書き方を持ち込んでいない */
{
  const p = await open();
  const r = await p.evaluate(() => ({
    fns: ['looksLikeBackup', 'backupCounts', 'confirmImport', 'confirmWipe', 'exportData', 'importData',
          'stripBackupMarks', 'fmtBackupAt'].filter(n => typeof window[n] !== 'function')
  }));
  ok(r.fns.length === 0, `必要な関数がそろっている (欠け: ${r.fns.join(',') || 'なし'})`);
  await p.context().close();

  /* 1文字でもあるとスクリプト全体が読めず、古い端末でアプリが真っ白になる書き方 */
  const src = await readFile(path.resolve(HERE, '..', 'index.html'), 'utf8');
  const spread = (src.match(/\{\s*\.\.\./g) || []).length;
  const lookbehind = (src.match(/\(\?<[=!]/g) || []).length;
  ok(spread === 0, `オブジェクトスプレッド {...a} が無い (${spread}件)`);
  ok(lookbehind === 0, `後読み正規表現 (?<=) が無い (${lookbehind}件)`);
}

/* 10. 書類の「この下書きを複製」が、書き換えたあとも同じように動く */
{
  const p = await open();
  const r = await p.evaluate(() => {
    S.documents = [{ id: 'dc', title: '志望理由書', type: '志望理由書', body: 'あ'.repeat(40), status: '下書き',
                     schoolId: 's9', charLimit: 800, updatedAt: 1,
                     feedbacks: [{ id: 'f1', who: '先生', text: 'よい' }], versions: [{ id: 'v1', body: '前' }] }];
    S.tasks = []; save();
    openDocEditor('dc');
    const dup = [...document.querySelectorAll('#sheet .btn')].find(b => b.textContent === 'この下書きを複製');
    if (!dup) return { err: '複製ボタンが無い' };
    dup.click();
    const c = S.documents[S.documents.length - 1];
    return { n: S.documents.length, title: c.title, body: c.body, type: c.type, school: c.schoolId,
             lim: c.charLimit, ver: c.versions.length, fb: c.feedbacks.length,
             sameId: c.id === 'dc', sharedFb: c.feedbacks[0] === S.documents[0].feedbacks[0] };
  });
  ok(!r.err, `複製ボタンが押せる (${r.err || 'ok'})`);
  ok(r.n === 2 && r.title === '志望理由書（複製）', `複製が1件増える (${r.n}件 / ${r.title})`);
  ok(r.body === 'あ'.repeat(40) && r.type === '志望理由書' && r.school === 's9' && r.lim === 800,
     '本文・種別・志望校・文字数制限が引き継がれる');
  ok(r.ver === 0 && r.fb === 1, `履歴は空・フィードバックは引き継ぐ (履歴${r.ver}/FB${r.fb})`);
  ok(!r.sameId && !r.sharedFb, 'IDは新しく、フィードバックは別オブジェクトになる');
  await p.context().close();
}

console.log(`\n== ${pass} PASS / ${fail} FAIL ==`);
if (errors.length) { console.log('JSエラー:', errors.slice(0, 5)); }
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
