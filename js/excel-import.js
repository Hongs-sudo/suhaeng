// 엑셀(구글시트 내보내기) → 학생·회차 점수 변환
// 시트 이름이 "수행평가_" 로 시작하는 시트만 읽는다 (얼리어답터 등은 제외).
import { UNITS } from "./rubric.js?v=3";

const STATUS_WORDS = ["퇴원", "휴원", "신규", "내신"];
const norm = s => String(s ?? "").replace(/\s+/g, "").replace(/[()（）]/g, m => (m === "（" ? "(" : m === "）" ? ")" : m));

function ymd(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// 단원 칸 → 회차 번호
export function roundFromUnit(v, grade) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v >= 1 && v <= 10 && Number.isInteger(v) ? v : null;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\s*(?:[.회]|(?=[^\d]))/);
  if (m) { const n = +m[1]; if (n >= 1 && n <= 10) return n; }
  const t = norm(s);
  const list = UNITS[grade] || [];
  // 정확히 같은 이름 우선, 그다음 포함 관계 (괄호 번호가 다르면 다른 단원)
  for (let i = 0; i < list.length; i++) if (norm(list[i]) === t) return i + 1;
  const hits = [];
  list.forEach((u, i) => {
    const nu = norm(u);
    const core = nu.replace(/^삼각형의(?=무게중심)/, "");
    if (t.includes(core) || core.includes(t)) hits.push(i + 1);
  });
  if (hits.length === 1 && t.length >= 2) return hits[0];
  return null;
}

// 날짜 칸 → yyyy-mm-dd (예약 시간이 함께 적힌 문자열도 처리)
export function parseDate(v, year, SSF) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && SSF) {
    const p = SSF.parse_date_code(v);
    if (p && p.y > 2000) return ymd(p.y, p.m, p.d);
    return null;
  }
  if (v instanceof Date) return ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
  const s = String(v);
  let m = s.match(/(\d{1,2})\s*[/.]\s*(\d{1,2})/);
  if (m) return ymd(year, +m[1], +m[2]);
  m = s.match(/^(\d{2})(\d{2})\s*\(/);
  if (m) return ymd(year, +m[1], +m[2]);
  return null;
}

function weekStart(rangeText, year) {
  const m = String(rangeText || "").match(/(\d{1,2})\/(\d{1,2})/);
  return m ? ymd(year, +m[1], +m[2]) : null;
}

/**
 * @param wb   XLSX workbook (XLSX.read(data, {type:"array"}))
 * @param XLSX SheetJS 전역
 * @param year 기본 연도
 * @returns {students:[{name,school,grade,teacher,status,rounds:{[n]:{date,score,note,guess}}}], warnings:[string], sheets:[string]}
 */
export function parseWorkbook(wb, XLSX, year = new Date().getFullYear()) {
  const byKey = new Map();
  const warnings = [];
  const sheets = [];
  for (const name of wb.SheetNames) {
    if (!/^수행평가_/.test(name)) continue;
    sheets.push(name);
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const head = rows[2] || [];
    const range = rows[3] || [];
    const groups = [];
    head.forEach((h, c) => {
      if (typeof h === "string" && /\d+월\s*\d주/.test(h)) groups.push({ c, label: h.replace(/\s+/g, " ").trim(), start: weekStart(range[c], year) });
    });
    const sheetGrade = +(name.match(/중(\d)/) || [])[1] || null;
    for (let r = 4; r < rows.length; r++) {
      const row = rows[r] || [];
      const sname = String(row[1] ?? "").trim();
      if (!sname) continue;
      const school = String(row[2] ?? "").trim();
      const grade = Number(row[3]) || sheetGrade;
      const teacher = String(row[4] ?? "").trim().replace(/T$/, "").replace(/\s+/g, "");
      const key = `${sname}|${school}|${grade}`;
      let st = byKey.get(key);
      if (!st) { st = { name: sname, school, grade, teacher, status: "재원", rounds: {} }; byKey.set(key, st); }
      if (!st.teacher && teacher) st.teacher = teacher;
      const pending = [];
      for (const g of groups) {
        const dv = row[g.c], uv = row[g.c + 1], sv = row[g.c + 2];
        const texts = [dv, uv, sv].filter(x => typeof x === "string").join(" ");
        for (const w of STATUS_WORDS) if (texts.includes(w)) {
          if (w === "퇴원") st.status = "퇴원";
          else if (w === "휴원" && st.status !== "퇴원") st.status = "휴원";
        }
        let score = null, note = "";
        if (typeof sv === "number") score = sv;
        else if (typeof sv === "string" && /채점\s*불가/.test(sv)) note = "채점불가";
        else if (typeof sv === "string" && /^\d+(\.\d+)?$/.test(sv.trim())) score = parseFloat(sv);
        if (score == null && !note) continue;
        if (score != null && (score < 0 || score > 50)) { warnings.push(`${sname}: ${g.label} 점수 ${score}는 0~50 밖이라 제외`); continue; }
        let date = parseDate(dv, year, XLSX.SSF), dateFromWeek = false;
        if (!date) { date = g.start; dateFromWeek = true; }
        const round = roundFromUnit(uv, grade);
        pending.push({ round, date, dateFromWeek, score, note, label: g.label, unitText: uv });
      }
      // 회차가 적히지 않은 기록은 비어 있는 회차를 앞에서부터 채우고 '확인 필요' 표시
      for (const p of pending.filter(p => p.round)) put(st, p, warnings);
      for (const p of pending.filter(p => !p.round)) {
        // 다른 시트에 같은 주 기록이 이미 있으면 같은 시험으로 본다 (중복 입력)
        const same = Object.entries(st.rounds).find(([, x]) => x.week === p.label || (p.score != null && x.score === p.score && x.dateFromWeek));
        if (same) {
          const [n, x] = same;
          if (x.dateFromWeek && p.date && !p.dateFromWeek) { x.date = p.date; x.dateFromWeek = false; }
          if (p.score != null && x.score != null && x.score !== p.score)
            warnings.push(`${sname}: ${n}회 점수가 시트마다 다름 (${x.score}, ${p.score}) — 단원이 적힌 ${x.score} 사용`);
          continue;
        }
        let n = 1; while (st.rounds[n] && n <= 10) n++;
        if (n > 10) { warnings.push(`${sname}: ${p.label} 기록을 넣을 빈 회차가 없어 제외`); continue; }
        p.round = n; p.guess = true;
        warnings.push(`${sname}: ${p.label} 기록에 단원이 없어 ${n}회로 넣음 (확인 필요)`);
        put(st, p, warnings);
      }
    }
  }
  return { students: [...byKey.values()], warnings, sheets };
}

function put(st, p, warnings) {
  const cur = st.rounds[p.round];
  const rec = { date: p.date, score: p.score, note: p.note || "", guess: !!p.guess, status: "응시", week: p.label, dateFromWeek: !!p.dateFromWeek };
  if (!cur) { st.rounds[p.round] = rec; return; }
  if (cur.score == null && p.score != null) { st.rounds[p.round] = rec; return; }
  if (cur.score != null && p.score != null && cur.score !== p.score)
    warnings.push(`${st.name}: ${p.round}회 점수가 두 번 적혀 있음 (${cur.score}, ${p.score}) — 앞의 값 사용`);
}
