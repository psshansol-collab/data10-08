// 가상 샘플 파일 만들기: node scripts/make-samples.js
// js/sample-data.js 의 일일 실적 7주와 현장 측정 5일(개선 전 3일 · 개선 후 2일)을 .xlsx 3개로 씁니다(전부 지어낸 값).
// 날짜 칸은 엑셀 날짜, 시각 칸은 엑셀 시각 서식으로 넣고, 방금 쓴 파일을 앱과 같은 방식(raw 숫자)으로 다시 읽어 확인합니다.
const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');

const out = path.join(__dirname, '..', 'samples');
fs.mkdirSync(out, { recursive: true });
const b = Sample.build();

function write(f, fmt) {
  const ws = XLSX.utils.aoa_to_sheet(f.aoa);
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: f.aoa[1].length - 1 } }];
  // 서식: 날짜·시각 칸이 엑셀에서 숫자가 아니라 날짜·시각으로 보이게
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let r = 2; r <= range.e.r; r++) {
    for (const [c, z] of Object.entries(fmt)) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: Number(c) })];
      if (cell && typeof cell.v === 'number') cell.z = z;
    }
  }
  ws['!cols'] = f.aoa[1].map((h) => ({ wch: Math.max(10, String(h).length * 2 + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, f.sheet);
  const file = path.join(out, f.fileName);
  fs.writeFileSync(file, XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
  const back = XLSX.read(fs.readFileSync(file), { type: 'buffer' });
  return XLSX.utils.sheet_to_json(back.Sheets[back.SheetNames[0]], { header: 1, raw: true, defval: null });
}

const d = L.parseDaily(write(b.dailyFile, { 0: 'yyyy-mm-dd' }));
if (d.det.missing.length || d.warnings.length) throw new Error('일일 실적 다시 읽기 실패: ' + JSON.stringify(d.det.missing.concat(d.warnings).slice(0, 3)));
console.log(b.dailyFile.fileName, '일', d.records.length);
let ms = [];
for (const f of b.measureFiles) {
  const p = L.parseMeasure(write(f, { 0: 'yyyy-mm-dd', 5: 'hh:mm:ss', 6: 'hh:mm:ss' }));
  if (p.det.missing.length || p.warnings.length) throw new Error(f.fileName + ' 다시 읽기 실패: ' + JSON.stringify(p.det.missing.concat(p.warnings).slice(0, 3)));
  ms = ms.concat(p.records);
  console.log(f.fileName, '구간', p.records.length, '측정일', L.measureDays(p.records).join(', '));
}
console.log('측정 구간 합', L.mergeMeasures([], ms).records.length);
