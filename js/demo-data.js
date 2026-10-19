// 데모 모드 예시 데이터 (실제 학생 아님)
import { demoAnalysis } from "./analyze.js?v=6";

export function seed() {
  const teachers = {
    "owner@demo": { email: "owner@demo", name: "원장", role: "admin", active: true },
    "kim@demo": { email: "kim@demo", name: "김소연", role: "teacher", active: true },
    "ye@demo": { email: "ye@demo", name: "예윤지", role: "teacher", active: true },
    "cho@demo": { email: "cho@demo", name: "조성진", role: "teacher", active: true }
  };
  const S = [
    ["s01", "예시학생A", "월촌중", 1, "김소연", "재원", { 1: ["09-10", 44], 2: ["09-17", 41], 3: ["09-22", 43], 4: ["10-03", 32.5], 5: ["10-10", 38] }],
    ["s02", "예시학생B", "신목중", 1, "김소연", "재원", { 1: ["09-10", 40], 2: ["09-17", 35], 3: ["09-22", 41], 4: ["10-03", 26] }],
    ["s03", "예시학생C", "월촌중", 1, "김소연", "재원", { 1: ["09-10", 39], 2: ["09-17", 27], 3: ["09-24", 35], 4: ["10-03", 34] }],
    ["s04", "예시학생D", "영도중", 1, "김소연", "재원", { 1: ["09-08", 28], 2: ["09-15", 27], 3: ["09-22", 26], 4: ["09-29", 28] }],
    ["s05", "예시학생E", "월촌중", 1, "예윤지", "퇴원", { 1: ["09-04", 33], 2: ["09-07", 34], 3: ["09-16", 34], 4: ["09-21", 24] }],
    ["s06", "예시학생F", "신목중", 1, "예윤지", "재원", { 1: ["09-05", 32], 2: ["09-12", 43.5], 3: ["09-19", 45], 5: ["09-23", 41] }],
    ["s07", "예시학생G", "월촌중", 1, "예윤지", "휴원", { 1: ["09-04", 17] }],
    ["s08", "예시학생H", "당산중", 1, "조성진", "재원", { 1: ["09-05", 41], 2: ["09-12", 43] }],
    ["s09", "예시학생I", "월촌중", 2, "김소연", "재원", { 1: ["09-07", 41], 2: ["09-14", 38], 9: ["09-23", 26.5], 10: ["09-28", 35] }],
    ["s10", "예시학생J", "월촌중", 2, "김소연", "재원", { 1: ["09-04", 45], 2: ["09-07", 40], 9: ["09-14", 35], 10: ["09-21", 47], 3: ["09-28", 28], 4: ["10-08", 36] }],
    ["s11", "예시학생K", "신목중", 2, "조성진", "재원", { 2: ["09-12", 38.5], 3: ["09-19", 31], 4: ["10-03", 40] }],
    ["s12", "예시학생L", "양정중", 2, "조성진", "재원", { 1: ["09-05", 27], 2: ["09-12", 31.5] }],
    ["s13", "예시학생M", "월촌중", 3, "예윤지", "재원", { 1: ["09-08", 36], 2: ["09-15", 30] }]
  ];
  const students = {}, records = {}, analyses = {};
  S.forEach(([id, name, school, grade, teacher, status, rs], si) => {
    students[id] = { name, school, grade, teacher, status };
    records[id] = {};
    Object.entries(rs).forEach(([r, [d, sc]]) => {
      records[id][r] = { date: "2026-" + d, score: sc, status: "응시", by: "kim@demo", at: Date.now() };
    });
    // 일부 회차는 시험지 분석까지 끝난 상태로
    const ana = id === "s01" ? [1, 2, 3, 4, 5] : id === "s10" ? [1, 2, 9, 10, 3] : id === "s02" ? [4] : [];
    ana.forEach(r => {
      const sc = rs[r][1];
      const a = demoAnalysis(grade, r, sc, si + 3);
      analyses[`${id}_${r}`] = { ...a, sid: id, round: r, entered: sc, confirmed: true, by: "kim@demo", at: Date.now() };
      records[id][r].analyzed = true;
    });
  });
  return { teachers, students, records, analyses, scans: {}, drafts: {}, reports: {} };
}
