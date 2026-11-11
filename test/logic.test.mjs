// 실행: node test/logic.test.mjs   (의존성 없음 — vendor 의 SheetJS 만 씀)
// 실제 회사 실적·측정 자료는 아직 받지 않았습니다. 여기서는 손으로 만든 작은 표와 가상 샘플로 계산을 검사합니다.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');
const XLSX = require('../vendor/xlsx.full.min.js');
const E = require('../js/ai-endpoint.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, (msg || '') + ` ${a} ≈ ${b}`);

// 앱과 같은 길: aoa → 통합문서 → xlsx 바이트 → 다시 읽기(raw 숫자)
function roundTrip(aoa, name = '시트1') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  const back = XLSX.read(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }), { type: 'array' });
  return XLSX.utils.sheet_to_json(back.Sheets[back.SheetNames[0]], { header: 1, raw: true, defval: null });
}
function sampleDb() {
  const b = Sample.build();
  const db = L.emptyDb();
  db.processes = b.processes;
  db.settings = L.cleanSettings(b.settings);
  db.compare = b.compare;
  db.daily = L.mergeDaily([], L.parseDaily(roundTrip(b.dailyFile.aoa)).records).records;
  let ms = [];
  b.measureFiles.forEach((f) => { ms = ms.concat(L.parseMeasure(roundTrip(f.aoa)).records); });
  db.measures = L.mergeMeasures([], ms).records;
  return db;
}
const BEFORE = { from: '2026-08-31', to: '2026-09-18' }, AFTER = { from: '2026-09-28', to: '2026-10-16' };

console.log('숫자·날짜·시각');
test('toNum — 단위 붙은 값·쉼표·빈칸·수식', () => {
  assert.equal(L.toNum('10대'), 10); assert.equal(L.toNum('7.5h'), 7.5); assert.equal(L.toNum('1,200'), 1200);
  assert.equal(L.toNum(''), null); assert.equal(L.toNum('=A1'), null); assert.ok(Number.isNaN(L.toNum('열대')));
});
test('toISO — 엑셀 일련번호·여러 글자 꼴·연도 없는 날짜', () => {
  assert.equal(L.toISO(46273), '2026-09-08');
  assert.equal(L.toISO('2026.9.8'), '2026-09-08'); assert.equal(L.toISO('2026년 9월 8일'), '2026-09-08');
  assert.equal(L.toISO('9/8', 2026), '2026-09-08'); assert.equal(L.toISO('2026-09-08(화)'), '2026-09-08');
  assert.equal(L.toISO('2026-02-30'), ''); assert.equal(L.toISO('합계'), '');
});
test('toSec — 글자·엑셀 시각·날짜+시각·오후 표기', () => {
  assert.equal(L.toSec('08:30'), 30600); assert.equal(L.toSec('8:30:15'), 30615);
  assert.equal(L.toSec(0.5), 43200); assert.equal(L.toSec(46273.5), 43200);
  assert.equal(L.toSec('오후 1:20'), 13 * 3600 + 20 * 60); assert.equal(L.toSec('25:00'), null);
});
test('durSec — 자정 넘김·형식 섞임', () => {
  assert.equal(L.durSec('08:00', '08:45:30'), 2730);
  assert.equal(L.durSec('23:50', '00:10'), 1200);
  assert.equal(L.durSec(0.25, '06:30'), 1800);
});
test('주·월 묶기 — 월요일 시작', () => {
  assert.equal(L.weekStart('2026-09-13'), '2026-09-07'); // 일요일 → 그 주 월요일
  assert.equal(L.weekStart('2026-09-07'), '2026-09-07');
  assert.equal(L.monthKey('2026-09-30'), '2026-09');
});

console.log('엑셀 열 찾기');
test('일일 실적 — 제목 행 아래 머리행·단위 붙은 머리 이름', () => {
  const aoa = [['■ 실적'], ['일자', '목표(대)', '실적(대)', '작업인원(명)', '가용시간(HR)', '비고'], [46273, 10, 8, 9, 7.5, '대기']];
  const d = L.detectColumns(aoa, L.DAILY_FIELDS);
  assert.equal(d.headerRow, 1);
  assert.deepEqual(d.map, { date: 0, target: 1, actual: 2, workers: 3, availHr: 4, note: 5 });
  assert.deepEqual(d.missing, []);
});
test('일일 실적 — 다른 이름(생산일자·목표 실적 대수·실제 생산 대수)', () => {
  const d = L.detectColumns([['생산일자', '목표 실적 대수', '실제 생산 대수', '투입인원', '일일 가용시간']], L.DAILY_FIELDS);
  assert.deepEqual(d.map, { date: 0, target: 1, actual: 2, workers: 3, availHr: 4 });
});
test('열 연결 직접 고치기 — 한 열은 한 칸에만', () => {
  const aoa = [['날짜', '계획', '생산', '메모']];
  const d = L.detectColumns(aoa, L.DAILY_FIELDS, { note: 2, actual: -1 });
  assert.equal(d.map.note, 2); assert.equal(d.map.actual, undefined);
  assert.deepEqual(d.missing, ['actual']);
});
test('측정 기록 — 「No」 열이 대 번호로 잘못 잡히지 않음', () => {
  const d = L.detectColumns([['No', '측정일', '작업자', '공정', '대 번호', '구분', '시작', '종료', '메모']], L.MEASURE_FIELDS);
  assert.equal(d.map.unit, 4); assert.equal(d.map.date, 1); assert.deepEqual(d.missing, []);
});

console.log('일일 실적 읽기·합치기');
test('parseDaily — 합계 행 빼기·분 단위 가용시간·알림', () => {
  const aoa = [['일자', '목표', '실적', '인원', '가용시간', '비고'],
    ['2026-09-07', 10, 8, 9, 450, ''], ['9/8', 10, '9대', 9, 7.5, '자재 늦음'], ['날짜 없음', 10, 8, 9, 7.5, ''], ['합계', 20, 17, null, null, null], [null, null, null]];
  const p = L.parseDaily(aoa);
  assert.equal(p.records.length, 2);
  assert.equal(p.records[0].availHr, 7.5);              // 450분 → 7.5시간
  assert.equal(p.records[1].date, '2026-09-08');        // 위 행의 연도
  assert.equal(p.records[1].actual, 9);
  assert.ok(p.warnings.some((w) => /분으로 보고/.test(w.msg)));
  assert.ok(p.warnings.some((w) => /일자를 읽지 못해/.test(w.msg)));
});
test('mergeDaily — 같은 날짜는 새 값, 날짜 순 정렬', () => {
  const a = L.mergeDaily([], [{ date: '2026-09-08', target: 10, actual: 7 }, { date: '2026-09-07', target: 10, actual: 8 }]);
  const b = L.mergeDaily(a.records, [{ date: '2026-09-08', target: 10, actual: 9 }]);
  assert.deepEqual(b.stat, { added: 0, updated: 1 });
  assert.deepEqual(b.records.map((r) => r.date + ':' + r.actual), ['2026-09-07:8', '2026-09-08:9']);
});

console.log('달성률 관리표');
const D = [
  { date: '2026-09-07', target: 10, actual: 9, workers: 9, availHr: 7.5 },
  { date: '2026-09-08', target: 10, actual: 8, workers: 9, availHr: 7.5 },
  { date: '2026-09-14', target: 10, actual: 10, workers: null, availHr: null, note: '정상' },
  { date: '2026-10-01', target: 0, actual: 0, workers: 9, availHr: 7.5 }
];
test('일별 — 달성률·90% 판정·택트타임', () => {
  const r = L.achieveRows(D, { unit: 'day', settings: { workers: 8, availHr: 8 } });
  assert.equal(r.length, 4);
  near(r[0].rate, 0.9); assert.equal(r[0].okDays, 1);       // 정확히 90% 는 달성
  near(r[1].rate, 0.8); assert.equal(r[1].okDays, 0);
  near(r[0].taktMin, 45);
  assert.equal(r[3].rate, null); assert.equal(r[3].ratedDays, 0); // 목표 0 은 달성률 없음
});
test('주별 — 합으로 계산(평균의 평균 아님), 빈 인원은 기본값', () => {
  const r = L.achieveRows(D, { unit: 'week', settings: { workers: 8, availHr: 8 } });
  assert.deepEqual(r.map((x) => x.key), ['2026-09-07', '2026-09-14', '2026-09-28']);
  near(r[0].rate, 17 / 20);
  near(r[0].perUnitManHr, (9 * 7.5 * 2) / 17);
  assert.equal(r[1].filled, true); near(r[1].perUnitManHr, 8 * 8 / 10);
});
test('월별·기간 거르기·합계', () => {
  const r = L.achieveRows(D, { unit: 'month' });
  assert.deepEqual(r.map((x) => x.key), ['2026-09', '2026-10']);
  const t = L.achieveTotal(D, { from: '2026-09-08', to: '2026-09-30' });
  assert.equal(t.days, 2); assert.equal(t.target, 20); assert.equal(t.actual, 18);
  const aoa = L.achieveToAoa(r, 'month');
  assert.equal(aoa[0][0], '월'); assert.equal(aoa.length, 3);
});

console.log('측정 기록');
const PROCS = [{ name: '절단', seq: 1, stdMin: 30, workers: 1 }, { name: '용접', seq: 2, stdMin: 100, workers: 2 }, { name: '검사', seq: 3, stdMin: 40, workers: 2 }];
const M = [
  // 1번 대
  { date: '2026-09-08', worker: '갑', process: '절단', unit: '1', kind: '작업', start: '08:00', end: '08:30' },
  { date: '2026-09-08', worker: '갑', process: '절단', unit: '1', kind: '자재 준비', start: '08:30', end: '08:35' },
  { date: '2026-09-08', worker: '을', process: '용접', unit: '1', kind: '작업', start: '08:35', end: '09:25' },
  { date: '2026-09-08', worker: '병', process: '용접', unit: '1', kind: '작업', start: '08:35', end: '09:35' },
  { date: '2026-09-08', worker: '정', process: '검사', unit: '1', kind: '대기', start: '08:00', end: '09:30', memo: '용접 완료품 대기' },
  { date: '2026-09-08', worker: '정', process: '검사', unit: '1', kind: '작업', start: '09:35', end: '10:15' },
  // 2번 대
  { date: '2026-09-08', worker: '갑', process: '절단', unit: '2', kind: '작업', start: '08:35', end: '09:05' },
  { date: '2026-09-08', worker: '을', process: '용접', unit: '2', kind: '작업', start: '09:35', end: '10:25' },
  { date: '2026-09-08', worker: '병', process: '용접', unit: '2', kind: '작업', start: '09:35', end: '10:25' },
  { date: '2026-09-08', worker: '병', process: '용접', unit: '2', kind: '재작업', start: '10:25', end: '10:35', memo: '비드 불량' },
  { date: '2026-09-08', worker: '정', process: '검사', unit: '2', kind: '작업', start: '10:35', end: '11:15' }
];
test('normKind — 구분 표기 흔들림', () => {
  assert.equal(L.normKind('자재'), '자재 준비'); assert.equal(L.normKind('대기시간'), '대기'); assert.equal(L.normKind('리워크'), '재작업');
  assert.equal(L.normKind('운반'), '이동'); assert.equal(L.normKind(' 작업 '), '작업'); assert.equal(L.normKind('점심'), null);
});
test('parseMeasure — 일자 이어 쓰기·모르는 구분 빼기·시각 못 읽음', () => {
  const aoa = [['측정일', '작업자', '공정', '대 번호', '구분', '시작', '종료', '메모'],
    ['2026-09-08', '갑', '절단', 1, '작업', '08:00', '08:30', null],
    [null, '갑', '절단', 1, '자재', 0.354166667, 0.357638889, '랙'],
    [null, '갑', '절단', 1, '점심', '12:00', '13:00', null],
    [null, '갑', '절단', 1, '작업', '아침', '08:30', null]];
  const p = L.parseMeasure(aoa);
  assert.equal(p.records.length, 2);
  assert.equal(p.records[1].date, '2026-09-08');
  assert.equal(p.records[1].kind, '자재 준비'); assert.equal(p.records[1].sec, 300);
  assert.equal(p.warnings.length, 2);
});
test('mergeMeasures — 같은 구간(일자·작업자·공정·대·시작)은 한 번만', () => {
  const a = L.mergeMeasures([], M);
  const b = L.mergeMeasures(a.records, M.slice(0, 3));
  assert.equal(b.records.length, M.length); assert.equal(b.stat.updated, 3);
});
test('processStats — 대당 공수·측정 인원·사이클타임·손실', () => {
  const st = L.processStats(L.mergeMeasures([], M).records, PROCS);
  const by = Object.fromEntries(st.rows.map((r) => [r.name, r]));
  assert.equal(by['절단'].units, 2); near(by['절단'].workMin, 30); near(by['절단'].ct, 30); near(by['절단'].lossMin, 2.5);
  assert.equal(by['용접'].units, 2); near(by['용접'].workMin, (50 + 60 + 50 + 50) / 2); near(by['용접'].measuredWorkers, 2); near(by['용접'].ct, 52.5);
  near(by['용접'].loss['재작업'], 600);
  near(by['검사'].workers, 1); near(by['검사'].ct, 40);   // 측정 인원 1명(설정 2명보다 측정 우선)
  near(by['검사'].stdCt, 20);
  near(by['검사'].ctAll, (80 + 90) / 2);
});
test('taktInfo — 일일 실적 기준, 없으면 설정 기본값', () => {
  near(L.taktInfo(D, { from: '2026-09-07', to: '2026-09-08' }).taktMin, 45);
  const t = L.taktInfo([], { settings: { availHr: 8, target: 12 } });
  near(t.taktMin, 40); assert.equal(t.source, '설정 기본값');
  assert.equal(L.taktInfo([], {}).taktMin, null);
});
test('lineAnalysis — 병목·택트 초과·하루 최대 대수·라인 밸런스', () => {
  const st = L.processStats(L.mergeMeasures([], M).records, PROCS);
  const la = L.lineAnalysis(st, { taktMin: 45, availMin: 450, target: 10 });
  assert.equal(la.bottleneck.name, '용접'); assert.equal(la.overCount, 1);
  near(la.capacity, 450 / 52.5); near(la.expectedRate, 450 / 52.5 / 10);
  near(la.balance, (30 + 52.5 + 40) / (3 * 52.5));
  const std = L.lineAnalysis(st, { taktMin: 45, availMin: 450, target: 10 }, { source: 'standard' });
  assert.equal(std.bottleneck.name, '용접'); near(std.maxCt, 50);
});
test('lossPareto — 큰 순·누적 100%·공정 거르기', () => {
  const ms = L.mergeMeasures([], M).records;
  const p = L.lossPareto(ms);
  assert.deepEqual(p.rows.map((r) => r.type).slice(0, 3), ['대기', '재작업', '자재 준비']);
  near(p.rows[p.rows.length - 1].cum, 1); near(p.totalMin, 90 + 10 + 5);
  assert.equal(L.lossPareto(ms, { process: '절단' }).totalMin, 5);
});
test('lossMatrix — 공정 순서대로, 작업자별 손실 비율', () => {
  const ms = L.mergeMeasures([], M).records;
  const byP = L.lossMatrix(ms, 'process', { processes: PROCS });
  assert.deepEqual(byP.map((r) => r.key), ['절단', '용접', '검사']);
  const byW = L.lossMatrix(ms, 'worker');
  const jung = byW.find((r) => r.key === '정');
  near(jung.lossShare, 90 / (90 + 80));
});

console.log('인원 배분');
test('simulate — 사이클타임·병목·예상 달성률, 인원 0 이면 그 공정이 멈춤', () => {
  const s = L.simulate([{ name: 'A', workMin: 30, workers: 1 }, { name: 'B', workMin: 110, workers: 2 }, { name: 'C', workMin: 75, workers: 3 }], 450, 10);
  assert.equal(s.bottleneck.name, 'B'); near(s.capacity, 450 / 55); assert.equal(s.capacityWhole, 8); assert.equal(s.totalWorkers, 6);
  near(s.taktMin, 45); assert.equal(s.rows[1].over, true);
  const z = L.simulate([{ name: 'A', workMin: 30, workers: 0 }], 450, 10);
  assert.equal(z.capacity, 0);
  const cut = L.simulate([{ name: 'B', workMin: 110, workers: 2, cutPct: 20 }], 450, 10);
  near(cut.rows[0].ct, 44);
});
test('suggestAllocation — 총인원 유지, 가장 긴 사이클타임 최소', () => {
  const rows = [{ workMin: 34 }, { workMin: 39 }, { workMin: 37 }, { workMin: 108 }, { workMin: 29 }, { workMin: 75 }];
  const w = L.suggestAllocation(rows, 9);
  assert.deepEqual(w, [1, 1, 1, 3, 1, 2]);
  assert.equal(w.reduce((a, b) => a + b, 0), 9);
  // 모든 다른 배분과 비교해 최댓값이 더 작은 배분이 없음(작은 문제로 전수 확인)
  const best = Math.max(...rows.map((r, i) => r.workMin / w[i]));
  let brute = Infinity;
  (function rec(i, left, cur) {
    if (i === rows.length) { if (left === 0) brute = Math.min(brute, Math.max(...rows.map((r, k) => r.workMin / cur[k]))); return; }
    for (let n = 1; n <= left - (rows.length - i - 1); n++) rec(i + 1, left - n, cur.concat([n]));
  })(0, 9, []);
  near(best, brute);
  assert.equal(L.suggestAllocation(rows, 5), null);
});

console.log('개선 전·후 · 단가');
test('comparePeriods — 대당 투입공수·원가·절감액·절감률·KPI', () => {
  const db = L.emptyDb();
  db.daily = L.mergeDaily([], [
    { date: '2026-09-01', target: 10, actual: 8, workers: 10, availHr: 8 },
    { date: '2026-10-01', target: 10, actual: 10, workers: 10, availHr: 8 }]).records;
  const c = L.comparePeriods(db, { from: '2026-09-01', to: '2026-09-30' }, { from: '2026-10-01', to: '2026-10-31' }, { wage: 20000, otherBefore: 50000, annualUnits: 100 });
  near(c.before.total.perUnitManHr, 10); near(c.after.total.perUnitManHr, 8);
  near(c.costBefore.total, 10 * 20000 + 50000); near(c.costAfter.total, 8 * 20000 + 50000); // 개선 후 기타 원가가 비면 개선 전과 같게
  near(c.saving, 40000); near(c.savingRate, 40000 / 250000); near(c.annual, 4000000);
  assert.deepEqual(c.kpi, { keepWorkers: true, rate90: true, costDown: true });
  const aoa = L.compareToAoa(c);
  assert.ok(aoa.some((r) => r[0] === '대당 절감액(원)' && r[2] === 40000));
});
test('comparePeriods — 임률이 없으면 원가 계산 안 함', () => {
  const db = L.emptyDb(); db.daily = [{ date: '2026-09-01', target: 10, actual: 8, workers: 10, availHr: 8 }];
  const c = L.comparePeriods(db, { from: '2026-09-01', to: '2026-09-01' }, { from: '2026-09-01', to: '2026-09-01' }, {});
  assert.equal(c.saving, null); assert.equal(c.kpi.costDown, null);
  assert.ok(!L.compareToAoa(c).some((r) => /절감/.test(r[0])));
});

console.log('스톱워치');
test('구간 바꾸기·다음 대·멈춤 — 앞 구간을 닫음', () => {
  const t0 = new Date(2026, 8, 8, 8, 0, 0).getTime();
  let r = L.swSwitch(null, '작업', t0, { worker: '갑', process: '용접', unit: '1' });
  assert.equal(r.closed, null); assert.equal(r.state.kind, '작업');
  r = L.swSwitch(r.state, '자재 준비', t0 + 600000);
  assert.deepEqual([r.closed.kind, r.closed.start, r.closed.end, r.closed.sec, r.closed.unit, r.closed.date], ['작업', '08:00:00', '08:10:00', 600, '1', '2026-09-08']);
  r = L.swNextUnit(r.state, t0 + 660000);
  assert.equal(r.closed.kind, '자재 준비'); assert.equal(r.state.unit, '2'); assert.equal(r.state.kind, '작업');
  const again = L.swSwitch(r.state, '대기', r.state.startMs + 300); // 0.3초 만에 다시 누름 → 기록 안 함
  assert.equal(again.closed, null);
  r = L.swStop(r.state, t0 + 720000);
  assert.equal(r.state, null); assert.equal(r.closed.sec, 60);
  assert.ok(L.cleanMeasure(r.closed));
});
test('nextUnit — 숫자 자릿수 유지', () => {
  assert.equal(L.nextUnit('09'), '10'); assert.equal(L.nextUnit('F-007'), 'F-008'); assert.equal(L.nextUnit(''), '1'); assert.equal(L.nextUnit('가'), '가-2');
});

console.log('표준작업서 · AI 프롬프트');
test('sopRows — 순서·사이클타임·측정 공수', () => {
  const st = L.processStats(L.mergeMeasures([], M).records, PROCS);
  const rows = L.sopRows([PROCS[2], PROCS[0], PROCS[1]], st);
  assert.deepEqual(rows.map((r) => r.name), ['절단', '용접', '검사']);
  near(rows[1].ct, 50); near(rows[1].measuredWorkMin, 105);
});
test('buildSopPrompt — 숫자·메모만, 지어내지 말라는 규칙', () => {
  const p = L.buildSopPrompt({ rows: L.sopRows([{ name: '용접', stdMin: 100, workers: 2, points: '대칭으로 용접', quality: '', safety: '마스크' }]), product: '프레임', taktMin: 45, target: 10 });
  assert.ok(p.includes('대칭으로 용접')); assert.ok(p.includes('(없음)')); assert.ok(p.includes('지어내지 말아줘')); assert.ok(p.includes('택트타임 45분'));
});
test('작업자 별칭 — 유지·되돌리기·세는 말은 그대로', () => {
  const al = L.assignAliases({}, ['홍길동', '김철수']);
  assert.deepEqual(al, { '김철수': '작업자1', '홍길동': '작업자2' });
  const al2 = L.assignAliases(al, ['박영희', '홍길동']);
  assert.equal(al2['홍길동'], '작업자2'); assert.equal(al2['박영희'], '작업자3');
  assert.equal(L.maskText('홍길동이 자재를 찾음', al2), '작업자2이 자재를 찾음');
  assert.equal(L.unmaskText('작업자2 는 대기, 작업자 3명, 작업자3명 투입', al2), '홍길동 는 대기, 작업자 3명, 작업자3명 투입');
});
test('buildAnalysisPrompt — 사실만, 이름 가림, 원가는 켤 때만', () => {
  const db = sampleDb();
  db.measures.forEach((m) => { if (m.worker === '작업자D') m.worker = '홍길동'; });
  db.measures[0].memo = '홍길동에게 자재 받음';
  const names = [...new Set(db.measures.map((m) => m.worker))];
  const al = L.assignAliases({}, names);
  const st = L.processStats(db.measures, db.processes, BEFORE);
  const la = L.lineAnalysis(st, L.taktInfo(db.daily, { ...BEFORE, settings: db.settings }));
  const cmp = L.comparePeriods(db, BEFORE, AFTER, db.settings);
  const memos = db.measures.filter((m) => m.memo).map((m) => m.memo);
  const ctx = { period: BEFORE, total: L.achieveTotal(db.daily, { ...BEFORE, settings: db.settings }), line: la, pareto: L.lossPareto(db.measures, BEFORE),
    byWorker: L.lossMatrix(db.measures, 'worker', BEFORE), memos, compare: cmp, aliases: al };
  const info = L.buildAnalysisPrompt(ctx);
  assert.equal(info.leaks.length, 0, '이름이 남음: ' + info.leaks.join(','));
  assert.ok(!info.prompt.includes('홍길동'));
  assert.ok(info.prompt.includes('본용접') && info.prompt.includes('— 병목'));
  assert.ok(info.prompt.includes('「추정」'));
  assert.ok(!/제작원가|절감액/.test(info.prompt));
  const withCost = L.buildAnalysisPrompt({ ...ctx, includeCost: true });
  assert.ok(withCost.prompt.includes('대당 절감액'));
  const noMask = L.buildAnalysisPrompt({ ...ctx, aliases: null });
  assert.ok(noMask.prompt.includes('홍길동'));
});

console.log('가상 샘플 — 줄거리가 화면에 보이는지');
test('샘플 파일 다시 읽기 — 알림 0, 합계 행 빠짐', () => {
  const b = Sample.build();
  const d = L.parseDaily(roundTrip(b.dailyFile.aoa));
  assert.equal(d.warnings.length, 0); assert.equal(d.records.length, Sample.DAILY.length); assert.equal(d.skipped, 1);
  b.measureFiles.forEach((f) => { const p = L.parseMeasure(roundTrip(f.aoa)); assert.equal(p.warnings.length, 0); assert.deepEqual(p.det.missing, []); });
});
test('개선 전 — 본용접이 병목(택트 초과), 대기가 가장 큰 손실, 달성률 90% 미만', () => {
  const db = sampleDb();
  const st = L.processStats(db.measures, db.processes, BEFORE);
  const la = L.lineAnalysis(st, L.taktInfo(db.daily, { ...BEFORE, settings: db.settings }));
  assert.equal(la.bottleneck.name, '본용접'); assert.equal(la.bottleneck.over, true); assert.equal(la.overCount, 1);
  assert.equal(L.lossPareto(db.measures, BEFORE).rows[0].type, '대기');
  assert.ok(L.lossPareto(db.measures, BEFORE).rows[0].share > 0.5);
  assert.ok(L.achieveTotal(db.daily, { ...BEFORE, settings: db.settings }).rate < 0.9);
});
test('개선 후 — 같은 인원, 택트 초과 공정 없음, 달성률 90% 이상, 단가 절감', () => {
  const db = sampleDb();
  const st = L.processStats(db.measures, db.processes, AFTER);
  const la = L.lineAnalysis(st, L.taktInfo(db.daily, { ...AFTER, settings: db.settings }));
  assert.equal(la.overCount, 0); assert.equal(la.bottleneck.name, '홀 가공');
  near(st.rows.find((r) => r.name === '본용접').measuredWorkers, 3);
  const c = L.comparePeriods(db, BEFORE, AFTER, db.settings);
  assert.deepEqual(c.kpi, { keepWorkers: true, rate90: true, costDown: true });
  assert.ok(c.after.lossMin < c.before.lossMin);
  assert.ok(c.savingRate > 0 && c.savingRate < 0.5);
});
test('개선 전 측정으로 자동 배분 → 샘플의 실제 개선안(본용접 3명·사상 2명)과 같음', () => {
  const db = sampleDb();
  const rows = L.processStats(db.measures, db.processes, BEFORE).rows.map((r) => ({ name: r.name, workMin: r.workMin }));
  const w = L.suggestAllocation(rows, 9);
  assert.deepEqual(Object.fromEntries(rows.map((r, i) => [r.name, w[i]])), { '자재 절단': 1, '홀 가공': 1, '가접(지그 조립)': 1, '본용접': 3, '변형 교정': 1, '사상·검사': 2 });
  assert.ok(L.simulate(rows.map((r, i) => ({ ...r, workers: w[i] })), 450, 10).expectedRate >= 0.9);
});
test('샘플에 회사명·실명 없음 — 작업자는 작업자A~I', () => {
  const db = sampleDb();
  const ws = [...new Set(db.measures.map((m) => m.worker))].sort();
  assert.deepEqual(ws, ['작업자A', '작업자B', '작업자C', '작업자D', '작업자E', '작업자F', '작업자G', '작업자H', '작업자I']);
  assert.ok(/가상/.test(db.settings.product));
});

console.log('저장 형식 · AI 연결');
test('restoreDb — 깨진 값 걸러내기·기본값', () => {
  const db = L.restoreDb({ daily: [{ date: '2026-09-08', target: '10', actual: 8 }, { date: 'x' }], processes: [{ name: '용접', workers: '2' }], measures: [{ date: '2026-09-08', process: '용접', kind: '대기', start: '08:00', end: '08:10' }, { kind: '?' }],
    settings: { goal: 5, availHr: 'abc' }, maskWorkers: false, running: { startMs: 5, process: '용접', kind: '작업' }, compare: { beforeFrom: '2026/9/1' } });
  assert.equal(db.daily.length, 1); assert.equal(db.daily[0].target, 10);
  assert.equal(db.processes[0].workers, 2); assert.equal(db.measures.length, 1); assert.equal(db.measures[0].sec, 600);
  assert.equal(db.settings.goal, 0.9); assert.equal(db.settings.availHr, null);
  assert.equal(db.maskWorkers, false); assert.equal(db.running.process, '용접'); assert.equal(db.compare.beforeFrom, '2026-09-01');
  const e = L.restoreDb(null); assert.equal(e.daily.length, 0); assert.equal(e.maskWorkers, true); assert.equal(e.includeCost, false);
});
console.log('현장 측정 → 일일 실적 반영 · 공정 진행 (2026-11-10 요청)');
const PR3 = [{ name: '절단', seq: 1, workers: 1, capa: 4 }, { name: '용접', seq: 2, workers: 2 }, { name: '검사', seq: 3, workers: 1, capa: 3 }];
const hh = (n) => String(n).padStart(2, '0');
const seg = (date, process, unit, kind, start, end, done, worker = '갑') => ({ date, worker, process, unit, kind, start, end, ...(done === undefined ? {} : { done }) });
test('completions — 「다음 대」로 끝난 대만 셈(진행 중 제외) · 표시 없는 옛 기록은 작업 대를 셈', () => {
  const ms = L.mergeMeasures([], [
    seg('2026-11-10', '검사', '1', '작업', '08:00', '08:30', false), seg('2026-11-10', '검사', '1', '대기', '08:30', '08:35', true),   // 1번 대: 대기 구간에서 다음 대 → 완료
    seg('2026-11-10', '검사', '2', '작업', '08:35', '09:00', false),                                                                 // 2번 대: 아직 하는 중
    seg('2026-11-10', '절단', '1', '작업', '08:00', '08:20'), seg('2026-11-10', '절단', '2', '작업', '08:20', '08:40'),             // 표시 없음 → 2대
    seg('2026-11-10', '절단', '', '대기', '08:40', '08:45')                                                                          // 대 번호 없는 손실은 대가 아님
  ]).records;
  const c = L.completions(ms);
  const by = Object.fromEntries(c.map((x) => [x.process, x]));
  assert.equal(by['검사'].done, 1); assert.equal(by['검사'].open, 1); assert.equal(by['절단'].done, 2);
});
test('syncMeasuredActual — 일일 실적이 없으면 새로 · 비었으면 채움 · 측정 반영 값은 따라 바뀜', () => {
  const settings = L.cleanSettings({ target: 5 });
  let ms = L.mergeMeasures([], [seg('2026-11-10', '검사', '1', '작업', '08:00', '08:30', true), seg('2026-11-11', '검사', '1', '작업', '08:00', '08:30', true)]).records;
  const daily = L.mergeDaily([], [{ date: '2026-11-11', target: 4, actual: null, workers: 3 }]).records;
  let r = L.syncMeasuredActual(daily, ms, PR3, settings);
  assert.deepEqual(r.stat, { added: 1, updated: 1 }); assert.equal(r.conflicts.length, 0);
  assert.deepEqual(r.records.map((x) => [x.date, x.target, x.actual, x.actualSrc]), [['2026-11-10', 5, 1, 'measure'], ['2026-11-11', 4, 1, 'measure']]);
  assert.equal(r.records[1].workers, 3, '손으로 넣은 인원은 그대로');
  ms = L.mergeMeasures(ms, [seg('2026-11-10', '검사', '2', '작업', '08:30', '09:00', true)]).records;   // 같은 날 한 대 더 끝남
  r = L.syncMeasuredActual(r.records, ms, PR3, settings);
  assert.equal(r.records[0].actual, 2); assert.deepEqual(r.stat, { added: 0, updated: 1 });
  r = L.syncMeasuredActual(r.records, ms, PR3, settings);
  assert.deepEqual(r.stat, { added: 0, updated: 0 }, '다시 돌려도 바뀌지 않음');
  const back = L.restoreDb(JSON.parse(JSON.stringify({ daily: r.records })));
  assert.equal(back.daily[0].actualSrc, 'measure', '저장 · 복원 후에도 출처 유지');
});
test('syncMeasuredActual — 측정이 없거나 라인 끝 공정 측정이 없으면 일일 실적을 건드리지 않음', () => {
  const daily = L.mergeDaily([], [{ date: '2026-11-10', target: 4, actual: 3 }]).records;
  let r = L.syncMeasuredActual(daily, [], PR3, {});
  assert.deepEqual(r.stat, { added: 0, updated: 0 }); assert.equal(r.conflicts.length, 0); assert.equal(r.records[0].actual, 3);
  const onlyCut = L.mergeMeasures([], [seg('2026-11-12', '절단', '1', '작업', '08:00', '08:20', true)]).records;   // 라인 끝(검사) 측정 없음
  r = L.syncMeasuredActual(daily, onlyCut, PR3, {});
  assert.equal(r.records.length, 1); assert.equal(L.measuredActuals(onlyCut, PR3)[0].lineDone, null);
});
test('syncMeasuredActual — 손 입력과 다르면 덮어쓰지 않고 차이를 알림 → 고르기', () => {
  const ms = L.mergeMeasures([], [1, 2, 3].map((u) => seg('2026-11-10', '검사', String(u), '작업', hh(7 + u) + ':00', hh(7 + u) + ':30', true))).records;
  const daily = L.mergeDaily([], [{ date: '2026-11-10', target: 4, actual: 4 }]).records;
  let r = L.syncMeasuredActual(daily, ms, PR3, {});
  assert.equal(r.records[0].actual, 4, '손 입력 유지'); assert.equal(r.records[0].actualSrc, undefined);
  assert.deepEqual(r.conflicts, [{ date: '2026-11-10', manual: 4, measured: 3, line: '검사' }]);
  const kept = L.resolveMeasured(r.records, '2026-11-10', 'manual', 3);
  assert.equal(kept[0].actual, 4); assert.equal(L.syncMeasuredActual(kept, ms, PR3, {}).conflicts.length, 0, '「입력값 유지」를 고른 측정값은 다시 묻지 않음');
  const ms4 = L.mergeMeasures(ms, [seg('2026-11-10', '검사', '9', '작업', '12:00', '12:30', true)]).records;
  assert.equal(L.syncMeasuredActual(kept, ms4, PR3, {}).conflicts.length, 0, '측정이 4대가 되어 손 입력과 같아지면 충돌 없음');
  const used = L.resolveMeasured(r.records, '2026-11-10', 'measure', 3);
  assert.equal(used[0].actual, 3); assert.equal(used[0].actualSrc, 'measure');
});
test('processProgress — CAPA(기본 4) 대비 완료 · 사이클타임 > 택트 → 지연 공정', () => {
  const db = L.emptyDb();
  db.processes = L.sortProcesses(PR3);
  db.daily = L.mergeDaily([], [{ date: '2026-11-10', target: 4, actual: null, availHr: 4 }]).records;      // 택트 = 240 ÷ 4 = 60분
  db.measures = L.mergeMeasures([], [
    ...[1, 2, 3, 4].map((u) => seg('2026-11-10', '절단', String(u), '작업', hh(7 + u) + ':00', hh(7 + u) + ':20', true)),
    ...[1, 2].map((u) => seg('2026-11-10', '용접', String(u), '작업', hh(7 + u) + ':00', hh(7 + u) + ':50', true)),   // 2명 중 1명만 기록 → 사이클 50분, 완료 2 < 4
    ...[1, 2, 3].map((u) => seg('2026-11-10', '검사', String(u), '작업', '1' + u + ':00', '1' + u + ':59', true))       // 사이클 59분, 완료 3 = CAPA 3
  ]).records;
  const pg = L.processProgress(db, '2026-11-10');
  near(pg.takt, 60);
  const by = Object.fromEntries(pg.rows.map((r) => [r.name, r]));
  assert.equal(by['용접'].capa, 4, 'capa 가 없는 공정은 기본 4');
  assert.equal(by['절단'].delayed, false); assert.equal(by['용접'].short, true); assert.equal(by['검사'].delayed, false);
  assert.equal(pg.lineDone, 3); assert.deepEqual(pg.delayed.map((r) => r.name), ['용접']);
  db.daily[0].availHr = 3.5;                                                                                  // 택트 52.5분 → 검사 59분은 시간 지연
  const pg2 = L.processProgress(db, '2026-11-10');
  assert.deepEqual(pg2.delayed.map((r) => r.name + (r.slow ? ':시간' : '') + (r.short ? ':수량' : '')), ['용접:수량', '검사:시간']);
  const mx = L.progressMatrix(db, 14); assert.equal(mx.days.length, 1); assert.deepEqual(mx.names, ['절단', '용접', '검사']);
});
test('옛 자료 — capa · actualSrc · done 이 없어도 읽힘(기본값)', () => {
  const db = L.restoreDb({ daily: [{ date: '2026-09-08', target: 10, actual: 8 }], processes: [{ name: '용접', workers: 2 }], measures: [{ date: '2026-09-08', process: '용접', unit: '1', kind: '작업', start: '08:00', end: '08:50' }] });
  assert.equal(db.processes[0].capa, 4); assert.equal(db.daily[0].actualSrc, undefined); assert.equal(db.measures[0].done, undefined);
  assert.equal(L.completions(db.measures)[0].done, 1, '표시 없는 옛 기록은 작업한 대를 셈');
  assert.equal(L.cleanProcess({ name: 'x', capa: '0' }).capa, 4); assert.equal(L.cleanProcess({ name: 'x', capa: '6' }).capa, 6);
});
test('측정 엑셀 「대 완료」 칸 · 스톱워치 다음 대 / 이 대 완료', () => {
  const p = L.parseMeasure([['측정일', '공정', '대 번호', '구분', '시작', '종료', '대 완료'], ['2026-11-10', '검사', '1', '작업', '08:00', '08:30', '○'], ['', '검사', '2', '작업', '08:30', '09:00', '']]);
  assert.equal(p.det.map.done, 6); assert.equal(p.records[0].done, true); assert.equal(p.records[1].done, undefined);
  const t0 = new Date(2026, 10, 10, 8, 0, 0).getTime();
  let r = L.swSwitch(null, '작업', t0, { process: '검사', unit: '1' });
  r = L.swSwitch(r.state, '대기', t0 + 60000); assert.equal(r.closed.done, false, '구간만 바꾸면 미완료');
  r = L.swNextUnit(r.state, t0 + 120000); assert.equal(r.closed.done, true); assert.equal(r.closed.unit, '1');
  const s = L.swStop(r.state, t0 + 180000, { done: true }); assert.equal(s.closed.done, true); assert.equal(s.closed.unit, '2');
  assert.equal(L.swStop(r.state, t0 + 180000).closed.done, false);
});
test('가상 샘플 — 측정일마다 라인 완성 4대 · 손 입력(7~10대)과 달라 덮어쓰지 않음 · 개선 전 본용접 지연', () => {
  const db = sampleDb();
  const r = L.syncMeasuredActual(db.daily, db.measures, db.processes, db.settings);
  assert.deepEqual(r.stat, { added: 0, updated: 0 }); assert.equal(r.conflicts.length, 5);
  assert.ok(r.conflicts.every((c) => c.measured === 4 && c.manual >= 7));
  assert.deepEqual(L.processProgress(db, '2026-09-08').delayed.map((x) => x.name), ['본용접']);
  assert.deepEqual(L.processProgress(db, '2026-10-13').delayed.map((x) => x.name), []);
});
console.log('측정 항목 편집 · 일시정지 (2026-11-10 v2.1 요청)');
const KM = (fn) => { const k = L.defaultKinds(); fn(k); return L.cleanKinds(k); };
const TM = (kind, start, end, unit = '1', worker = '갑', process = '용접', date = '2026-11-10') => ({ date, worker, process, unit, kind, start, end });
test('cleanKinds — 기본 8개 · 이름 겹침 · 모르는 분류 · 보이는 작업 항목이 하나는 남음 · 일시정지 이름은 못 씀', () => {
  const d = L.cleanKinds(null);
  assert.deepEqual(d.map((k) => k.id), ['작업', '세팅', '자재 준비', '이동', '대기', '재작업', '기타', '휴식']);
  assert.deepEqual(d.map((k) => k.cat), ['work', 'setup', 'loss', 'loss', 'loss', 'loss', 'loss', 'rest']);
  const c = L.cleanKinds([{ id: 'a', name: '작업', cat: 'work', hidden: true }, { id: 'b', name: '작업', cat: '??' }, { id: 'b', name: '중복 id' }, { id: 'c', name: '일시정지', cat: 'rest' }]);
  assert.deepEqual(c.map((k) => [k.id, k.name, k.cat, k.hidden]), [['a', '작업', 'work', false], ['b', '작업 2', 'loss', false], ['c', '일시정지 2', 'rest', false]]);
  const none = L.cleanKinds([{ id: 'x', name: '대기', cat: 'loss' }]);
  assert.equal(none[0].cat, 'work'); assert.equal(L.mainWorkKind(none), none[0].id);
});
test('이름 바꾸기 — 기록은 id 로 남아 계산 그대로 · 엑셀 글자는 새 이름 · 옛 이름(별칭) 모두 읽음', () => {
  const kinds = KM((k) => { k.find((x) => x.id === '대기').name = '설비 대기'; });
  const ms = L.mergeMeasures([], M, kinds).records;
  assert.ok(ms.every((m) => L.kindIndex(kinds).get(m.kind)), '모든 기록이 항목에 짝지어짐');
  assert.equal(L.lossPareto(ms, { kinds }).rows[0].type, '설비 대기');
  near(L.lossPareto(ms, { kinds }).totalMin, 105, 1e-6, '이름을 바꿔도 손실 합 같음');
  near(L.processStats(ms, PROCS, { kinds }).rows.find((r) => r.name === '용접').ct, 52.5);
  assert.equal(L.normKind('설비 대기', kinds), '대기'); assert.equal(L.normKind('대기', kinds), '대기'); assert.equal(L.normKind('기다림', kinds), '대기');
  const p = L.parseMeasure([['측정일', '공정', '대 번호', '구분', '시작', '종료'], ['2026-11-10', '용접', 1, '설비 대기', '08:00', '08:05'], ['', '용접', 1, '세팅', '08:05', '08:08'], ['', '용접', 1, '일시정지', '08:08', '08:10']], { kinds });
  assert.deepEqual(p.records.map((r) => r.kind), ['대기', '세팅', '일시정지']); assert.equal(p.warnings.length, 0);
  // 내려받은 엑셀(이름) → 다시 가져오기 → 같은 id
  const back = L.parseMeasure([['측정일', '공정', '대 번호', '구분', '시작', '종료']].concat(ms.map((m) => [m.date, m.process, m.unit, L.kindName(kinds, m.kind), m.start, m.end])), { kinds });
  assert.deepEqual(back.records.map((r) => r.kind), ms.map((m) => m.kind));
});
test('이름을 서로 바꿔도(대기 ↔ 이동) 저장된 기록은 id 로 그대로 · 글자는 지금 이름으로', () => {
  const kinds = KM((k) => { k.find((x) => x.id === '대기').name = '이동'; k.find((x) => x.id === '이동').name = '대기'; });
  assert.equal(L.cleanMeasure(TM('대기', '08:00', '08:10'), kinds).kind, '대기', '저장된 id');
  assert.equal(L.normKind('대기', kinds), '이동', '엑셀 글자 「대기」는 지금 「대기」라는 이름의 항목');
});
test('항목 더하기 · 분류로 계산 — 손실 항목은 파레토에, 비작업은 사이클타임 · 손실에서 빠짐, 분류를 바꾸면 계산이 따라감', () => {
  const kinds = L.cleanKinds(L.defaultKinds().concat([{ id: 'k1', name: '설비 고장', cat: 'loss' }, { id: 'k2', name: '안전 교육', cat: 'rest' }]));
  const ms = L.mergeMeasures([], [TM('작업', '08:00', '08:40'), TM('k1', '08:40', '08:50'), TM('k2', '08:50', '09:20'), TM('대기', '09:20', '09:25')], kinds).records;
  const st = L.processStats(ms, [{ name: '용접', workers: 1 }], { kinds }).rows[0];
  near(st.ct, 40); near(st.lossSec, 15 * 60); near(st.restSec, 30 * 60);
  assert.deepEqual(L.lossPareto(ms, { kinds }).rows.filter((r) => r.sec).map((r) => r.type), ['설비 고장', '대기']);
  const tb = L.timeBreakdown(ms, { kinds });
  assert.deepEqual(tb.rows.map((r) => [r.name, r.min]), [['안전 교육', 30]]); near(tb.nonworkShare, 30 / 85);
  const asRest = kinds.map((k) => (k.id === '대기' ? { ...k, cat: 'rest' } : k));
  near(L.lossPareto(ms, { kinds: asRest }).totalMin, 10, 1e-6, '대기를 비작업으로 바꾸면 손실에서 빠짐');
  near(L.lossMatrix(ms, 'process', { kinds: asRest })[0].total, 10);
  const hid = kinds.map((k) => (k.id === '이동' ? { ...k, hidden: true } : k));
  assert.ok(!L.lossPareto(ms, { kinds: hid }).rows.some((r) => r.type === '이동'), '숨긴 항목은 기록이 없으면 파레토에서 빠짐');
});
test('사이클타임 — 준비(세팅)는 기본 빼고, 설정을 켜면 넣음 · 완료 대수는 작업 시간 항목으로만 셈', () => {
  const ms = L.mergeMeasures([], [TM('세팅', '07:50', '08:00'), TM('작업', '08:00', '08:40'), TM('세팅', '08:40', '08:46', '2')]).records;
  const P = [{ name: '용접', workers: 2 }];
  near(L.processStats(ms, P).rows[0].ct, 40); assert.equal(L.processStats(ms, P).rows[0].units, 1);   // 측정 인원 1명(갑)
  near(L.processStats(ms, P, { ctSetup: true }).rows[0].ct, 40 + 16);
  near(L.processStats(ms, P).rows[0].setupMin, 16);
  const c = L.completions(ms)[0]; assert.equal(c.done, 1, '세팅만 한 2번 대는 완료 아님');
  assert.equal(L.cleanSettings({}).ctSetup, false); assert.equal(L.cleanSettings({ ctSetup: true }).ctSetup, true);
});
test('일시정지 — 지금 구간을 닫고 일시정지 구간 · 다시 시작하면 멈춘 항목으로 · 시간이 흐르지 않음 · 사이클타임 · 손실에서 빠짐', () => {
  const t0 = new Date(2026, 10, 10, 8, 0, 0).getTime(), min = 60000;
  let r = L.swSwitch(null, '작업', t0, { worker: '갑', process: '용접', unit: '1' });
  const segs = [];
  r = L.swPause(r.state, t0 + 10 * min); segs.push(r.closed);
  assert.equal(r.state.kind, L.PAUSE); assert.equal(r.state.resumeKind, '작업'); assert.equal(r.state.carrySec, 600);
  assert.deepEqual(L.swElapsed(r.state, t0 + 15 * min), { sec: 600, pauseSec: 300 }, '일시정지 동안 작업 시간은 멈춰 있음');
  assert.equal(L.swPause(r.state, t0 + 16 * min).closed, null, '두 번 눌러도 그대로');
  r = L.swResume(r.state, t0 + 20 * min); segs.push(r.closed);
  assert.equal(r.closed.kind, L.PAUSE); assert.equal(r.closed.sec, 600); assert.equal(r.state.kind, '작업');
  assert.equal(L.swElapsed(r.state, t0 + 25 * min).sec, 900, '다시 시작하면 멈춘 곳(10분)부터 이어짐');
  r = L.swNextUnit(r.state, t0 + 30 * min); segs.push(r.closed);
  assert.equal(L.swElapsed(r.state, t0 + 31 * min).sec, 60, '다음 대는 0 부터');
  const ms = L.mergeMeasures([], segs).records;
  const st = L.processStats(ms, [{ name: '용접', workers: 1 }]).rows[0];
  near(st.ct, 20); near(st.lossSec, 0); near(st.pauseSec, 600);
  assert.equal(L.lossPareto(ms).totalMin, 0);
  const tb = L.timeBreakdown(ms); assert.deepEqual(tb.rows.map((x) => [x.name, x.min]), [['일시정지', 10]]);
  assert.equal(L.completions(ms)[0].done, 1);
  assert.equal(L.swResume(null, t0).state, null); assert.equal(L.swPause(null, t0).state, null);
});
test('일시정지 — 새로 고쳐도(저장 · 복원) 일시정지 상태 · 멈춘 항목 · 흐른 시간이 이어짐', () => {
  const t0 = new Date(2026, 10, 10, 8, 0, 0).getTime();
  const kinds = L.cleanKinds(L.defaultKinds().concat([{ id: 'k9', name: '도장', cat: 'work' }]));
  let r = L.swSwitch(null, 'k9', t0, { worker: '갑', process: '용접', unit: '1' });
  r = L.swPause(r.state, t0 + 120000);
  const db = L.restoreDb(JSON.parse(JSON.stringify({ kinds, running: r.state })));
  assert.deepEqual([db.running.kind, db.running.resumeKind, db.running.carrySec], [L.PAUSE, 'k9', 120]);
  assert.equal(L.swResume(db.running, t0 + 180000).state.kind, 'k9');
  const bad = L.restoreDb({ running: { startMs: 5, process: '용접', kind: '일시정지', resumeKind: '없는 항목' } });
  assert.equal(bad.running.resumeKind, '작업', '멈춘 항목을 모르면 작업으로');
  assert.equal(L.restoreDb({ running: { startMs: 5, process: '용접', kind: '모름' } }).running, null);
});
test('옛 자료 — 항목 목록이 없으면 기본 항목, 옛 구분 이름은 그대로 짝지어짐, 목록에 없는 구분은 손실 항목으로 되살림', () => {
  const db = L.restoreDb({ measures: [TM('작업', '08:00', '08:30'), TM('대기', '08:30', '08:40'), TM('설비 점검', '08:40', '08:50')] });
  assert.equal(db.kinds.length, 9); assert.equal(db.measures.length, 3);
  assert.deepEqual(db.kinds[8], { id: '설비 점검', name: '설비 점검', cat: 'loss', hidden: false });
  near(L.lossPareto(db.measures, { kinds: db.kinds }).totalMin, 20);
  const renamed = L.restoreDb({ kinds: KM((k) => { k.find((x) => x.id === '대기').name = '설비 대기'; }), measures: [TM('대기', '08:30', '08:40')] });
  assert.equal(renamed.measures[0].kind, '대기'); assert.equal(L.kindName(renamed.kinds, renamed.measures[0].kind), '설비 대기');
});
test('가상 샘플 — 세팅 · 휴식 · 일시정지가 비작업으로 보이고 병목 · 손실 줄거리는 그대로', () => {
  const db = sampleDb();
  const tb = L.timeBreakdown(db.measures, { ...BEFORE, kinds: db.kinds });
  assert.deepEqual(tb.rows.map((r) => r.name), ['세팅', '휴식', '일시정지']);
  assert.ok(tb.nonworkShare > 0 && tb.nonworkShare < 0.3);
  const st = L.processStats(db.measures, db.processes, BEFORE), st2 = L.processStats(db.measures, db.processes, { ...BEFORE, ctSetup: true });
  const bw = (x) => x.rows.find((r) => r.name === '본용접');
  near(bw(st).setupMin, 3 * bw(st).measuredWorkers, 0.01, '세팅 3분/사람/대');
  near(bw(st2).ct - bw(st).ct, bw(st).setupMin / bw(st).workers, 1e-6, '세팅을 넣으면 사이클타임이 그만큼 늚');
  assert.equal(L.lineAnalysis(st, L.taktInfo(db.daily, { ...BEFORE, settings: db.settings })).bottleneck.name, '본용접');
  const prompt = L.buildAnalysisPrompt({ period: BEFORE, total: L.achieveTotal(db.daily, { ...BEFORE, settings: db.settings }), pareto: L.lossPareto(db.measures, BEFORE), nonwork: tb }).prompt;
  assert.ok(prompt.includes('비작업 시간') && prompt.includes('세팅'));
  const c = L.comparePeriods(db, BEFORE, AFTER, db.settings);
  assert.ok(L.compareToAoa(c).some((r) => /비작업/.test(r[0])));
});
test('AI 연결 — 키가 없으면 인증 머리글 없음, 저장 칸 이름', () => {
  assert.equal(E.STORE_KEY, 'data10-08.ai');
  const req = E.buildChatRequest({ baseUrl: 'https://llm.example.com/v1/', model: 'm' }, E.promptMessages('안녕'));
  assert.equal(req.url, 'https://llm.example.com/v1/chat/completions');
  assert.equal(req.init.headers.Authorization, undefined);
  assert.equal(E.toStored({ baseUrl: 'https://a/v1', model: 'm', apiKey: 'k', remember: false }).apiKey, '');
});

console.log('일일 실적 — 날짜 더하기 (v2.3, 입력란 대신)');
test('addDailyDay — 새 날짜는 목표 기본값 · 나머지는 비운 줄, 이미 있는 날짜 · 빈 날짜는 그대로', () => {
  const daily = L.mergeDaily([], [{ date: '2026-11-09', target: 8, actual: 7, workers: 6, availHr: 7.5 }]).records;
  let r = L.addDailyDay(daily, '2026-11-11', L.cleanSettings({ target: 9 }));
  assert.equal(r.created, true); assert.equal(r.date, '2026-11-11');
  assert.deepEqual(r.records.map((x) => [x.date, x.target, x.actual, x.workers, x.availHr]), [['2026-11-09', 8, 7, 6, 7.5], ['2026-11-11', 9, null, null, null]]);
  assert.equal(daily.length, 1, '원래 배열은 바꾸지 않음');
  r = L.addDailyDay(r.records, '2026-11-09', { target: 9 });
  assert.equal(r.created, false); assert.equal(r.date, '2026-11-09'); assert.equal(r.records.find((x) => x.date === '2026-11-09').actual, 7, '있는 날은 덮지 않음');
  r = L.addDailyDay(daily, '', {});
  assert.equal(r.created, false); assert.equal(r.date, null); assert.equal(r.records.length, 1);
  r = L.addDailyDay([], '2026-11-12', {});
  assert.equal(r.records[0].target, null, '설정 목표가 없으면 목표도 비움');
  r = L.addDailyDay(undefined, '2026-11-12', undefined);
  assert.equal(r.records.length, 1, '옛 자료(일일 실적 없음)도 됨');
});
test('addDailyDay → 그날 측정이 있으면 빈 실제 대수를 측정값으로 채움(syncMeasuredActual), 고치기로 값 저장', () => {
  const ms = L.mergeMeasures([], [seg('2026-11-10', '검사', '1', '작업', '08:00', '08:30', true), seg('2026-11-10', '검사', '2', '작업', '08:30', '09:00', true)]).records;
  let d = L.addDailyDay([], '2026-11-10', { target: 4 }).records;
  const r = L.syncMeasuredActual(d, ms, PR3, { target: 4 });
  assert.deepEqual([r.records[0].actual, r.records[0].actualSrc], [2, 'measure']); assert.equal(r.conflicts.length, 0);
  d = L.addDailyDay([], '2026-11-13', { target: 4 }).records;
  d = L.mergeDaily(d, [{ date: '2026-11-13', target: 4, actual: 3, workers: 5, availHr: 8, note: '측정 없음' }]).records;   // 고치기 화면 저장과 같은 길
  assert.deepEqual([d[0].actual, d[0].workers, d[0].note], [3, 5, '측정 없음']);
  assert.equal(L.achieveTotal(d, { settings: L.cleanSettings({}) }).rate, 0.75);
});
test('dropBlankDay — 더하고 저장하지 않은 빈 줄만 지움(실제 대수 · 비고가 있으면 남김)', () => {
  const d = L.mergeDaily([], [{ date: '2026-11-10', target: 4 }, { date: '2026-11-11', target: 4, actual: 0 }, { date: '2026-11-12', target: 4, note: '휴무' }, { date: '2026-11-13', target: 4, actual: 3 }]).records;
  assert.deepEqual(L.dropBlankDay(d, '2026-11-10').map((x) => x.date), ['2026-11-11', '2026-11-12', '2026-11-13']);
  assert.equal(L.dropBlankDay(d, '2026-11-11').length, 4, '실제 0대도 값');
  assert.equal(L.dropBlankDay(d, '2026-11-12').length, 4, '비고가 있으면 남김');
  assert.equal(L.dropBlankDay(d, '2026-11-13').length, 4);
  assert.equal(L.dropBlankDay(d, '2026-12-01').length, 4, '없는 날짜');
  assert.deepEqual(L.dropBlankDay(undefined, '2026-11-10'), []);
});

const { versions } = await import('../scripts/bump-version.mjs');
test('판 맞추기 — index.html ?v= · logic.js · app.js 가 같은 판 (scripts/bump-version.mjs)', () => {
  const v = versions();
  assert.equal(v.logic, L.VERSION, 'logic.js VERSION'); assert.equal(v.app, L.VERSION, 'app.js APP_VERSION');
  assert.ok(v.html.length >= 9 && v.html.every(x => x === L.VERSION), 'index.html 의 모든 js·css 에 ?v=' + L.VERSION + ' — ' + JSON.stringify(v.html));
});

console.log(`\n${passed}개 통과` + (process.exitCode ? ' — 실패가 있습니다' : ''));

test('11-11 대(제품)별 총 사이클타임 — 작업 시간만 더하고 손실 · 휴식 · 일시정지는 그 밖, 공정 순서 · 완료 · 정렬', () => {
  const kinds = L.defaultKinds(), work = L.mainWorkKind(kinds);
  const loss = kinds.find(k => k.cat === 'loss').id, rest = kinds.find(k => k.cat === 'rest').id, setup = (kinds.find(k => k.cat === 'setup') || {}).id;
  const M = (date, unit, process, kind, sec, done, start, end) => ({ date, worker: 'A', process, unit, kind, sec, start, end, memo: '', done });
  const ms = [
    M('2026-11-10', '1', '용접', work, 600, undefined, '09:00:00', '09:10:00'), M('2026-11-10', '1', '용접', loss, 120, undefined, '09:10:00', '09:12:00'),
    M('2026-11-10', '1', '용접', L.PAUSE, 60, undefined, '09:12:00', '09:13:00'), M('2026-11-10', '1', '용접', work, 300, true, '09:13:00', '09:18:00'),
    M('2026-11-10', '1', '사상', work, 200, true, '09:20:00', '09:23:20'), M('2026-11-10', '1', '사상', rest, 90, undefined, '09:23:20', '09:24:50'),
    M('2026-11-10', '2', '용접', work, 500, false, '10:00:00', '10:08:20'),
    M('2026-11-11', '10', '용접', work, 100, true, '08:00:00', '08:01:40'), M('2026-11-11', '9', '용접', work, 50, true, '07:00:00', '07:00:50')
  ];
  if (setup) ms.push(M('2026-11-10', '2', '용접', setup, 40, undefined, '09:59:00', '09:59:40'));
  const procs = [{ name: '사상', seq: 2 }, { name: '용접', seq: 1 }];
  const r = L.unitTotals(ms, kinds, { processes: procs });
  assert.deepEqual(r.map(x => x.date + '#' + x.unit), ['2026-11-11#10', '2026-11-11#9', '2026-11-10#2', '2026-11-10#1']);   // 최근 날 · 큰 대 번호가 위(문자 정렬이면 9 가 10 위)
  const u1 = r[3];
  assert.equal(u1.ctSec, 1100); assert.equal(u1.otherSec, 270); assert.equal(u1.spanSec, 1370);
  assert.deepEqual(u1.byProcess.map(p => p.name + ':' + p.ctSec), ['용접:900', '사상:200']);   // 공정 순서(seq)
  assert.equal(u1.done, true); assert.equal(u1.start, '09:00:00'); assert.equal(u1.end, '09:24:50');
  const u2 = r[2]; assert.equal(u2.done, false); assert.equal(u2.ctSec, 500); if (setup) assert.equal(u2.otherSec, 40);
  if (setup) assert.equal(L.unitTotals(ms, kinds, { ctSetup: true })[2].ctSec, 540);   // 설정을 켜면 세팅도 사이클타임에
  assert.deepEqual(L.unitTotals([], kinds), []);
});
