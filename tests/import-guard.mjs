/* バックアップ読み込みの事故防止テスト
   使い方: node tests/import-guard.mjs
   ・AO Compass のバックアップでないファイルを選んでも、今までのデータが消えないこと
   ・置き換える前に、中身を見せる確認画面が必ず出ること
   ・書き出しファイル名に日付と時刻が入ること */
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ok, eq, summary, newPage } from './smoke.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-import-'));
const write = (name, text) => { const p = path.join(TMP, name); fs.writeFileSync(p, text); return p; };

/* 生徒が今まで書きためたデータ（これが消えたら大事故） */
const MINE = {
  meta: { primarySchoolId: 's1', demoLoaded: false },
  schools: [
    { id: 's1', name: '青海大学', faculty: '総合政策学部', docs: '志望理由書、活動報告書', deadline: '2026-10-01', checklist: {} },
    { id: 's2', name: '白嶺大学', faculty: '国際教養学部', docs: '志望理由書', deadline: '2026-11-01', checklist: {} },
  ],
  documents: [{ id: 'd1', schoolId: 's1', title: '青海大 志望理由書', type: '志望理由書', status: '下書き',
    body: '私が貴学を志望する理由は、高校三年間で地域の防災に取り組んできたからです。', notes: '',
    paragraphNotes: {}, feedbacks: [], versions: [], scoreHistory: [], updatedAt: 1 }],
  activities: [], interview: [], essays: [], tasks: [], feedback: [], certs: [],
  self: { answers: {}, tags: { strengths: [], values: [], activities: [], themes: [], future: [], episodes: [] } },
  story: { origin: '', problem: '', past: '', learned: '', wantLearn: '', whyUniv: '', afterEnroll: '', future: '' },
  profile: { name: 'さくら', grade: '高3', school: '', field: '', goal: '', onboarded: true, createdAt: 1 },
  prefs: { textSize: 'm', alertDays: 14, greet: true },
};

/* 別の端末から持ってきた、ちゃんとしたバックアップ */
const OTHER = JSON.parse(JSON.stringify(MINE));
OTHER.schools = [{ id: 'x1', name: '海風大学', faculty: '教育学部', docs: '志望理由書', deadline: '2026-12-01', checklist: {} }];
OTHER.documents = [];
OTHER.profile.name = 'ゆうき';

/* 「読み込んではいけない」ファイルたち */
const BAD_FILES = [
  ['ただの数字の並び', 'not-backup-array.json', '[1,2,3]'],
  ['別のアプリのJSON', 'other-app.json', '{"version":1,"items":[{"todo":"買い物"}]}'],
  ['空のオブジェクト', 'empty-object.json', '{}'],
  ['文字列だけ', 'string.json', '"aoCompass"'],
  ['null', 'null.json', 'null'],
  ['こわれたJSON', 'broken.json', '{"schools":[{"name":'],
];

const seedMine = mine => { localStorage.setItem('aoCompass_v1', JSON.stringify(mine)); };

/* 「バックアップ読み込み」を押してファイルを選ぶ */
async function pickFile(page, filePath) {
  await page.evaluate(() => go('settings'));
  await page.waitForTimeout(80);
  const btn = page.locator('#root button', { hasText: 'バックアップ読み込み' }).first();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), btn.click()]);
  await chooser.setFiles(filePath);
  await page.waitForTimeout(250);
}
const sheetText = page => page.evaluate(() =>
  document.querySelector('#overlay').classList.contains('open') ? (document.querySelector('#sheet').innerText || '') : '');
const stateOf = page => page.evaluate(() => ({
  schools: S.schools.map(s => s.name), docs: S.documents.length, name: (S.profile || {}).name,
}));

async function main() {
  const browser = await chromium.launch();

  /* --- 1. バックアップでないファイルではデータが消えない --- */
  console.log('\n[1] バックアップでないファイルを選んでも消えない');
  const p1 = await newPage(browser, { seed: seedMine, seedArg: MINE });
  const before = await stateOf(p1);
  eq(before.schools.length, 2, '前提：志望校が2件入っている');

  for (const [label, name, body] of BAD_FILES) {
    await pickFile(p1, write(name, body));
    const st = await stateOf(p1);
    const sheet = await sheetText(p1);
    ok(JSON.stringify(st) === JSON.stringify(before), label + '：今までのデータがそのまま残る');
    ok(sheet.includes('読み込めませんでした'), label + '：読み込めない理由の画面が出る');
    ok(sheet.includes('そのまま残しています'), label + '：データが無事だと伝えている');
    await p1.evaluate(() => closeSheet());
    await p1.waitForTimeout(60);
  }
  eq(p1.__errors.length, 0, 'JSエラーが出ない' + (p1.__errors.length ? ' → ' + p1.__errors.join(' | ') : ''));

  /* --- 2. まともなバックアップでも、いきなり上書きしない --- */
  console.log('\n[2] 正しいバックアップでも確認画面をはさむ');
  const goodPath = write('ao-compass-backup-2026-08-02-1200.json', JSON.stringify(OTHER));
  await pickFile(p1, goodPath);
  const confirmSheet = await sheetText(p1);
  ok(confirmSheet.includes('この内容で読み込みますか'), '確認画面が出る');
  ok(confirmSheet.includes('置き換わります'), '「置き換わる」とはっきり書いてある');
  ok(confirmSheet.includes('いまアプリに入っているデータ'), '今のデータの中身が出る');
  ok(confirmSheet.includes('志望校 2件'), '今のデータの件数が正しい（志望校2件）');
  ok(confirmSheet.includes('読み込むファイル'), '読み込むファイルの中身が出る');
  ok(confirmSheet.includes('ao-compass-backup-2026-08-02-1200.json'), 'ファイル名が出る');
  ok(confirmSheet.includes('志望校 1件'), '読み込むファイルの件数が正しい（志望校1件）');
  ok(confirmSheet.includes('ゆうき'), '読み込むファイルの名前が出るので取り違えに気づける');
  ok(confirmSheet.includes('先に今のデータを書き出す'), '先にバックアップを取る導線がある');
  const stillMine = await stateOf(p1);
  ok(JSON.stringify(stillMine) === JSON.stringify(before), '確認画面を出しただけでは、まだ置き換わらない');

  /* --- 3. キャンセルしたら、今までどおり --- */
  console.log('\n[3] キャンセルで元のまま');
  await p1.locator('#sheet button', { hasText: 'キャンセル' }).first().click();
  await p1.waitForTimeout(150);
  const afterCancel = await stateOf(p1);
  ok(JSON.stringify(afterCancel) === JSON.stringify(before), 'キャンセルすると今までのデータのまま');
  eq(await sheetText(p1), '', 'キャンセルで確認画面が閉じる');

  /* --- 4. 「置き換えて読み込む」を押したときだけ置き換わる --- */
  console.log('\n[4] 置き換えて読み込む');
  await pickFile(p1, goodPath);
  await p1.locator('#sheet button', { hasText: '置き換えて読み込む' }).first().click();
  await p1.waitForTimeout(250);
  const replaced = await stateOf(p1);
  eq(JSON.stringify(replaced.schools), JSON.stringify(['海風大学']), '押したときだけ中身が置き換わる');
  eq(replaced.name, 'ゆうき', 'プロフィールも読み込んだファイルのものになる');
  const saved = await p1.evaluate(() => JSON.parse(localStorage.getItem('aoCompass_v1')).schools.length);
  eq(saved, 1, '置き換えた内容がちゃんと保存される');
  const homeText = await p1.evaluate(() => document.querySelector('#root').innerText || '');
  ok(homeText.length > 40, '読み込んだあとホーム画面が開く');
  eq(p1.__errors.length, 0, 'JSエラーが出ない' + (p1.__errors.length ? ' → ' + p1.__errors.join(' | ') : ''));

  /* --- 5. 判定そのものの単体確認 --- */
  console.log('\n[5] looksLikeBackup / backupSummary');
  const judge = await p1.evaluate(() => ({
    bad: [null, undefined, 0, 'abc', [], [1, 2], {}, { foo: 1 }, { items: [] }].map(v => looksLikeBackup(v)),
    good: [{ schools: [] }, { documents: [] }, { profile: { name: 'a' } }, { self: {} }, { prefs: { textSize: 'm' } }].map(v => looksLikeBackup(v)),
    sum1: backupSummary({ schools: [1, 2], documents: [1], profile: { name: 'あい' } }),
    sum2: backupSummary({ schools: [] }),
    fname: backupFileName(),
  }));
  ok(judge.bad.every(v => v === false), 'バックアップでないものは全部はじく');
  ok(judge.good.every(v => v === true), 'バックアップらしいものは全部通す');
  ok(judge.sum1.includes('名前「あい」') && judge.sum1.includes('志望校 2件') && judge.sum1.includes('提出書類 1件'),
    '中身の要約が正しい → ' + judge.sum1);
  ok(judge.sum2.includes('記録はまだ入っていません'), '空のファイルはそう伝える');
  ok(/^ao-compass-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(judge.fname),
    '書き出しファイル名に日付と時刻が入る (' + judge.fname + ')');

  /* --- 6. 書き出しが実際にその名前で落ちる --- */
  console.log('\n[6] バックアップ書き出し');
  await p1.evaluate(() => go('settings'));
  await p1.waitForTimeout(80);
  const [dl] = await Promise.all([
    p1.waitForEvent('download', { timeout: 8000 }),
    p1.locator('#root button', { hasText: 'バックアップ書き出し' }).first().click(),
  ]);
  const dlName = dl.suggestedFilename();
  ok(/^ao-compass-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(dlName), '実際の書き出し名も日付入り (' + dlName + ')');
  const dlPath = path.join(TMP, 'out.json');
  await dl.saveAs(dlPath);
  const dumped = JSON.parse(fs.readFileSync(dlPath, 'utf8'));
  eq(dumped.schools.length, 1, '書き出したファイルに今のデータが入っている');
  ok(!/apiKey|api_key|sk-ant|sk-/i.test(fs.readFileSync(dlPath, 'utf8')), '書き出しにAPIキーが含まれない');
  /* 書き出したファイルは、そのまま読み込み直せる */
  ok(await p1.evaluate(o => looksLikeBackup(o), dumped), '書き出したファイルは読み込み直せる形になっている');
  eq(p1.__errors.length, 0, 'JSエラーが出ない' + (p1.__errors.length ? ' → ' + p1.__errors.join(' | ') : ''));

  await p1.context().close();
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  return summary('読み込み事故防止テスト');
}

main().then(n => process.exit(n ? 1 : 0)).catch(e => { console.error(e); process.exit(1); });
