/* 가상 샘플 — 프레임 제작 라인의 일일 실적 7주 + 현장 측정 5일 + 공정 마스터 (전부 지어낸 값)
   · 작업자는 작업자A~I, 제품은 「프레임(가상)」, 원가·임률도 시연용 가짜 값입니다. 실제 회사 자료가 아닙니다.
   · 줄거리 — 데모에서 화면마다 바로 보이게 일부러 심어 둔 것:
       ① 개선 전(08/31~09/18): 본용접 2명, 대당 공수 약 108인·분 → 사이클타임 약 54분 > 택트타임 45분 → 병목.
          하루 실적 7~9대, 달성률 약 80%. 교정·사상·검사는 용접 완료품을 기다리느라 「대기」 손실이 가장 큼.
       ② 개선 적용(09/21~09/23): 사상·검사 1명을 본용접으로 옮김(총 9명 그대로), 자재 키트로 자재 준비 줄임.
       ③ 개선 후(09/28~10/16): 본용접 3명 → 사이클타임 약 35분, 병목은 홀 가공(약 38분)으로 옮겨 감. 달성률 약 95%.
   · 일일 실적은 날짜 칸을 엑셀 날짜(일련번호)로, 측정 기록의 시각은 엑셀 시각(하루의 소수)으로 넣습니다.
   브라우저에서는 window.FrameSample, node 에서는 require('./sample-data.js'). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logic.js'));
  else root.FrameSample = factory(root.FrameLogic);
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';

  var PROCESSES = [
    { seq: 1, name: '자재 절단', stdMin: 35, workers: 1,
      points: '도면의 부재 목록과 길이를 확인한다. 절단 후 버를 제거한다. 부재마다 번호를 표시한다.',
      quality: '절단 길이를 줄자로 재어 도면과 맞춘다.', safety: '보안경·장갑 착용, 절단기 덮개 확인.' },
    { seq: 2, name: '홀 가공', stdMin: 40, workers: 1,
      points: '드릴 지그에 부재를 고정하고 홀을 뚫는다. 면취 후 칩을 털어 낸다.',
      quality: '홀 위치를 게이지로 확인.', safety: '장갑을 끼고 드릴을 잡지 않는다. 칩은 솔로 턴다.' },
    { seq: 3, name: '가접(지그 조립)', stdMin: 38, workers: 1,
      points: '조립 지그에 부재를 순서대로 놓고 클램프로 고정. 네 모서리부터 가접.',
      quality: '대각 길이를 재서 직각 확인.', safety: '용접 마스크, 지그 끼임 주의.' },
    { seq: 4, name: '본용접', stdMin: 105, workers: 2,
      points: '가접품을 포지셔너에 올리고 정해진 순서로 본용접. 변형 줄이려고 대칭으로 나눠 용접.',
      quality: '비드 외관(언더컷·기공) 육안 확인. 이상 시 표시.', safety: '용접 마스크·앞치마, 환기, 포지셔너 회전 중 손 넣지 않기.' },
    { seq: 5, name: '변형 교정', stdMin: 30, workers: 1,
      points: '정반 위에서 휨을 재고 프레스로 교정.', quality: '평면도 확인 후 기록.', safety: '프레스 양손 조작, 발끼임 주의.' },
    { seq: 6, name: '사상·검사', stdMin: 72, workers: 3,
      points: '스패터·버 제거, 치수 검사, 검사표 기록 후 출하대로.', quality: '검사표 항목 빠짐없이 기록.', safety: '그라인더 보안경·귀마개.' }
  ];

  /* 하루 실적 — [일자, 목표, 실적, 인원, 가용시간, 비고] */
  var DAILY = [
    ['2026-08-31', 10, 8, 9, 7.5, ''], ['2026-09-01', 10, 7, 9, 7.5, '본용접 대기 — 가접품 적체'], ['2026-09-02', 10, 8, 9, 7.5, ''],
    ['2026-09-03', 10, 9, 9, 7.5, ''], ['2026-09-04', 10, 8, 9, 7.5, '브래킷 자재 늦게 들어옴'],
    ['2026-09-07', 10, 8, 9, 7.5, ''], ['2026-09-08', 10, 7, 9, 7.5, '현장 측정 1일차 · 용접 비드 재작업 2대'], ['2026-09-09', 10, 8, 9, 7.5, '현장 측정 2일차'],
    ['2026-09-10', 10, 8, 9, 7.5, '현장 측정 3일차'], ['2026-09-11', 9, 9, 8, 7.5, '1명 연차'],
    ['2026-09-14', 10, 7, 9, 7.5, '교정 대기 길어짐'], ['2026-09-15', 10, 8, 9, 7.5, ''], ['2026-09-16', 10, 8, 9, 7.5, ''],
    ['2026-09-17', 10, 9, 9, 7.5, ''], ['2026-09-18', 10, 8, 9, 7.5, ''],
    ['2026-09-21', 10, 9, 9, 7.5, '인원 배분 변경 시작(사상·검사 1명 → 본용접)'], ['2026-09-22', 10, 8, 9, 7.5, '자재 키트 준비 시작'], ['2026-09-23', 10, 9, 9, 7.5, ''],
    ['2026-09-28', 10, 9, 9, 7.5, ''], ['2026-09-29', 10, 10, 9, 7.5, ''], ['2026-09-30', 10, 9, 9, 7.5, ''],
    ['2026-10-01', 10, 10, 9, 7.5, ''], ['2026-10-02', 10, 9, 9, 7.5, ''],
    ['2026-10-05', 10, 10, 9, 7.5, ''], ['2026-10-06', 10, 9, 8, 7.5, '1명 연차'], ['2026-10-07', 10, 10, 9, 7.5, ''], ['2026-10-08', 10, 9, 9, 7.5, ''],
    ['2026-10-12', 10, 10, 9, 7.5, ''], ['2026-10-13', 10, 10, 9, 7.5, '현장 측정(개선 후) 1일차'], ['2026-10-14', 10, 9, 9, 7.5, '현장 측정(개선 후) 2일차'],
    ['2026-10-15', 10, 10, 9, 7.5, ''], ['2026-10-16', 10, 9, 9, 7.5, '']
  ];

  /* 측정 — 작업자마다 한 대(대 번호)에 대해 [구분, 분, 메모] 구간을 차례로 */
  var BEFORE = {
    days: ['2026-09-08', '2026-09-09', '2026-09-10'],
    crew: { '자재 절단': ['작업자A'], '홀 가공': ['작업자B'], '가접(지그 조립)': ['작업자C'], '본용접': ['작업자D', '작업자E'], '변형 교정': ['작업자F'], '사상·검사': ['작업자G', '작업자H', '작업자I'] },
    work: { '자재 절단': 34, '홀 가공': 39, '가접(지그 조립)': 37, '본용접': 108, '변형 교정': 29, '사상·검사': 75 },
    pre: {
      '자재 절단': [['자재 준비', 4, '원자재 랙에서 찾기']], '홀 가공': [['대기', 5, '드릴 지그 사용 중']], '가접(지그 조립)': [['자재 준비', 5, '브래킷 찾기'], ['대기', 4, '지그 비기를 기다림']],
      '본용접': [['자재 준비', 6, '용접 와이어 교체·소모품 가지러 감']], '변형 교정': [['대기', 18, '용접 완료품 대기']], '사상·검사': [['대기', 20, '교정 완료품 대기']]
    },
    post: { '자재 절단': [['이동', 2, '절단품을 가공대로 운반'], ['대기', 3, '']], '홀 가공': [['이동', 2, '']], '가접(지그 조립)': [], '본용접': [['이동', 2, '']], '변형 교정': [['기타', 2, '프레스 주변 정리']], '사상·검사': [['이동', 2, '출하대로 운반']] },
    rework: { '작업자D': [2], '작업자E': [4] }, reworkMin: 8
  };
  var AFTER = {
    days: ['2026-10-13', '2026-10-14'],
    crew: { '자재 절단': ['작업자A'], '홀 가공': ['작업자B'], '가접(지그 조립)': ['작업자C'], '본용접': ['작업자D', '작업자E', '작업자I'], '변형 교정': ['작업자F'], '사상·검사': ['작업자G', '작업자H'] },
    work: { '자재 절단': 34, '홀 가공': 38, '가접(지그 조립)': 36, '본용접': 104, '변형 교정': 29, '사상·검사': 72 },
    pre: {
      '자재 절단': [['자재 준비', 1, '자재 키트로 준비']], '홀 가공': [['대기', 3, '']], '가접(지그 조립)': [['자재 준비', 1, '자재 키트'], ['대기', 3, '']],
      '본용접': [['자재 준비', 1, '소모품 카트 비치']], '변형 교정': [['대기', 6, '용접 완료품 대기']], '사상·검사': [['대기', 5, '']]
    },
    post: { '자재 절단': [['이동', 2, ''], ['대기', 2, '']], '홀 가공': [['이동', 2, '']], '가접(지그 조립)': [], '본용접': [['이동', 2, '']], '변형 교정': [], '사상·검사': [['이동', 2, '']] },
    rework: { '작업자D': [3] }, reworkMin: 6
  };
  var UNITS = 4;

  /* 씨앗 고정 난수 — 매번 같은 샘플 */
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  function measureRows(plan, seed) {
    var rnd = rng(seed), rows = [];
    plan.days.forEach(function (day) {
      PROCESSES.forEach(function (p) {
        var crew = plan.crew[p.name];
        crew.forEach(function (w) {
          var t = 8 * 3600 + 30 * 60 + Math.round(rnd() * 120);   // 08:30 무렵 시작
          function seg(kind, min, memo, unit) {
            var sec = Math.max(30, Math.round(min * 60 * (0.9 + rnd() * 0.2)));
            rows.push({ date: day, worker: w, process: p.name, unit: String(unit), kind: kind, start: t, end: t + sec, memo: memo || '' });
            t += sec;
          }
          /* 비작업 시간(v2.1) — 길이를 고정해 난수 순서를 바꾸지 않습니다(작업 · 손실 값은 v2.0 샘플과 같음) */
          function fixed(kind, min, memo, unit) {
            rows.push({ date: day, worker: w, process: p.name, unit: unit, kind: kind, start: t, end: t + min * 60, memo: memo || '' });
            t += min * 60;
          }
          for (var u = 1; u <= UNITS; u++) {
            fixed('세팅', 3, u === 1 ? '지그 · 공구 맞춤' : '', String(u));
            plan.pre[p.name].forEach(function (x) { seg(x[0], x[1], x[2], u); });
            seg('작업', plan.work[p.name] / crew.length, '', u);
            if (plan.rework[w] && plan.rework[w].indexOf(u) >= 0) seg('재작업', plan.reworkMin, '비드 불량 재용접', u);
            plan.post[p.name].forEach(function (x) { seg(x[0], x[1], x[2], u); });
            if (u === 2) fixed('휴식', 10, '오전 휴식', '');
            if (u === 3 && w === '작업자B') fixed('일시정지', 4, '전화 응대', String(u));
          }
        });
      });
    });
    return rows;
  }

  var DAILY_HEAD = ['일자', '목표(대)', '실적(대)', '작업인원(명)', '가용시간(HR)', '비고'];
  var MEASURE_HEAD = ['측정일', '작업자', '공정', '대 번호', '구분', '시작', '종료', '메모'];
  function serial(iso) { return Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000) + 25569; }
  function frac(sec) { return Math.round(sec) / 86400; }

  function dailyAoa() {
    var aoa = [['■ 프레임 제작 일일 실적 (가상 샘플 — 실제 값 아님)'], DAILY_HEAD];
    DAILY.forEach(function (d) { aoa.push([serial(d[0]), d[1], d[2], d[3], d[4], d[5] || null]); });
    aoa.push(['합계', DAILY.reduce(function (s, d) { return s + d[1]; }, 0), DAILY.reduce(function (s, d) { return s + d[2]; }, 0), null, null, null]);
    return aoa;
  }
  /* 측정표 모양 — 같은 측정일이 이어지면 일자를 첫 행에만 씁니다(종이 측정표를 옮겨 적은 모양) */
  function measureAoa(rows, title) {
    var aoa = [['■ 프레임 제작 현장 측정 기록 (' + title + ' · 가상 샘플)'], MEASURE_HEAD], last = '';
    rows.forEach(function (r) {
      aoa.push([r.date === last ? null : serial(r.date), r.worker, r.process, r.unit, r.kind, frac(r.start), frac(r.end), r.memo || null]);
      last = r.date;
    });
    return aoa;
  }

  function build() {
    return {
      processes: PROCESSES.map(function (p, i) { return L.cleanProcess(p, i); }),
      dailyFile: { fileName: '프레임_일일실적_샘플_0831-1016.xlsx', sheet: '일일 실적', aoa: dailyAoa() },
      measureFiles: [
        { fileName: '프레임_현장측정_샘플_개선전_0908-0910.xlsx', sheet: '측정 기록', aoa: measureAoa(measureRows(BEFORE, 20260908), '개선 전') },
        { fileName: '프레임_현장측정_샘플_개선후_1013-1014.xlsx', sheet: '측정 기록', aoa: measureAoa(measureRows(AFTER, 20261013), '개선 후') }
      ],
      settings: { availHr: 7.5, target: 10, workers: 9, product: '프레임(가상 샘플)', wage: 30000, otherBefore: 150000, otherAfter: 150000, annualUnits: 2400 },
      compare: { beforeFrom: '2026-08-31', beforeTo: '2026-09-18', afterFrom: '2026-09-28', afterTo: '2026-10-16' }
    };
  }

  return { build: build, PROCESSES: PROCESSES, DAILY: DAILY, DAILY_HEAD: DAILY_HEAD, MEASURE_HEAD: MEASURE_HEAD, serial: serial, frac: frac };
});
