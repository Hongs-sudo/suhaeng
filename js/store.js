// 데이터 저장소: Firebase(실사용) / 데모(브라우저 저장, 설정 전 미리보기)
// 구조 (나중에 다른 프로그램과 합칠 수 있도록 공통/프로그램 영역 분리)
//   teachers/{email}                    공통: 선생님 계정 {name, email, role:'admin'|'teacher', active}
//   students/{id}                       공통: 학생 {name, school, grade, teacher, status:'재원'|'휴원'|'퇴원'}
//   programs/{pid}/records/{studentId}  수행평가 회차 기록 {rounds:{ "1":{date,score,status,note,guess,analyzed,by,at} }}
//   programs/{pid}/analyses/{sid_r}     시험지 분석 결과
//   programs/{pid}/scans/{auto}         스캔 이미지 (학기 끝 일괄 삭제)
//   programs/{pid}/drafts/{sid_part}    리포트 의견 초안
//   programs/{pid}/reports/{token}      부모님 공유 리포트 (링크로 누구나 열람)

const CFG = window.APP_CONFIG;
const PID = CFG.programId || "suhaeng";
export const DEMO = !CFG.firebase || !CFG.firebase.apiKey;
const FB = "https://www.gstatic.com/firebasejs/10.12.2/";

export function newToken(n = 20) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  const abc = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...a].map(x => abc[x % abc.length]).join("");
}
const lowerEmail = e => String(e || "").trim().toLowerCase();

/* ------------------------------------------------------------------ Firebase */
class FirebaseStore {
  async init() {
    const [{ initializeApp }, auth, fs] = await Promise.all([
      import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js")]);
    this.A = auth; this.F = fs;
    this.app = initializeApp(CFG.firebase);
    this.auth = auth.getAuth(this.app);
    this.db = fs.initializeFirestore(this.app, { ignoreUndefinedProperties: true });
  }
  onAuth(cb) {
    return this.A.onAuthStateChanged(this.auth, async u => {
      if (!u) return cb(null);
      const email = lowerEmail(u.email);
      let t = null;
      try { const s = await this.F.getDoc(this.F.doc(this.db, "teachers", email)); t = s.exists() ? s.data() : null; } catch (e) { t = null; }
      const owner = (CFG.ownerEmails || []).map(lowerEmail).includes(email);
      if (owner) t = { name: t?.name || u.displayName || "원장", email, role: "admin", active: true };
      cb({ email, displayName: u.displayName, name: t?.name || u.displayName, role: t?.role, active: !!t?.active, registered: !!(t && t.active) });
    });
  }
  async signIn() {
    const p = new this.A.GoogleAuthProvider(); p.setCustomParameters({ prompt: "select_account" });
    try { await this.A.signInWithPopup(this.auth, p); }
    catch (e) { if (/popup/.test(e.code || "")) await this.A.signInWithRedirect(this.auth, p); else throw e; }
  }
  signOut() { return this.A.signOut(this.auth); }
  async idToken() { return this.auth.currentUser ? this.auth.currentUser.getIdToken() : ""; }
  col(...p) { return this.F.collection(this.db, ...p); }
  d(...p) { return this.F.doc(this.db, ...p); }
  async all(colRef) { const s = await this.F.getDocs(colRef); return s.docs.map(x => ({ id: x.id, ...x.data() })); }

  async listStudents() { return this.all(this.col("students")); }
  async listRecords() {
    const out = {}; (await this.all(this.col("programs", PID, "records"))).forEach(r => out[r.id] = r.rounds || {}); return out;
  }
  async saveStudent(st) {
    const { id, ...data } = st;
    if (id) { await this.F.setDoc(this.d("students", id), data, { merge: true }); return id; }
    const ref = await this.F.addDoc(this.col("students"), { ...data, createdAt: Date.now() }); return ref.id;
  }
  async deleteStudent(id) { await this.F.deleteDoc(this.d("students", id)); }
  async saveRound(sid, r, rec, who) {
    const v = rec ? { ...rec, by: who, at: Date.now() } : this.F.deleteField();
    await this.F.setDoc(this.d("programs", PID, "records", sid), { rounds: { [r]: v } }, { merge: true });
  }
  async setRounds(sid, rounds) { await this.F.setDoc(this.d("programs", PID, "records", sid), { rounds }, { merge: true }); }
  async saveJob(id, data) { await this.F.setDoc(this.d("programs", PID, "bulk", id), data, { merge: true }); }
  async listJobs() { return this.all(this.col("programs", PID, "bulk")); }
  async deleteJob(id) { await this.F.deleteDoc(this.d("programs", PID, "bulk", id)); }
  // 다른 선생님·다른 기기에서 바꾼 내용이 바로 반영되도록 실시간 구독
  watch(onStudents, onRecords) {
    const u1 = this.F.onSnapshot(this.col("students"), q => onStudents(q.docs.map(x => ({ id: x.id, ...x.data() }))), () => {});
    const u2 = this.F.onSnapshot(this.col("programs", PID, "records"), q => { const o = {}; q.docs.forEach(x => o[x.id] = x.data().rounds || {}); onRecords(o); }, () => {});
    return () => { u1(); u2(); };
  }
  async getRecord(sid) { const s = await this.F.getDoc(this.d("programs", PID, "records", sid)); return s.exists() ? (s.data().rounds || {}) : {}; }

  async listTeachers() { return this.all(this.col("teachers")); }
  async saveTeacher(t) { const e = lowerEmail(t.email); await this.F.setDoc(this.d("teachers", e), { ...t, email: e }, { merge: true }); }
  async deleteTeacher(email) { await this.F.deleteDoc(this.d("teachers", lowerEmail(email))); }

  async getAnalysis(sid, r) { const s = await this.F.getDoc(this.d("programs", PID, "analyses", `${sid}_${r}`)); return s.exists() ? s.data() : null; }
  async listAnalyses(sid) {
    const q = this.F.query(this.col("programs", PID, "analyses"), this.F.where("sid", "==", sid));
    const s = await this.F.getDocs(q); const out = {}; s.docs.forEach(x => out[x.data().round] = x.data()); return out;
  }
  async saveAnalysis(sid, r, a) { await this.F.setDoc(this.d("programs", PID, "analyses", `${sid}_${r}`), { ...a, sid, round: +r }); }
  async saveScans(sid, r, dataUrls) {
    const old = await this.F.getDocs(this.F.query(this.col("programs", PID, "scans"), this.F.where("sid", "==", sid), this.F.where("round", "==", +r)));
    await Promise.all(old.docs.map(x => this.F.deleteDoc(x.ref)));
    await Promise.all(dataUrls.map((data, i) => this.F.addDoc(this.col("programs", PID, "scans"), { sid, round: +r, page: i + 1, data, at: Date.now() })));
  }
  async getScans(sid, r) {
    const s = await this.F.getDocs(this.F.query(this.col("programs", PID, "scans"), this.F.where("sid", "==", sid), this.F.where("round", "==", +r)));
    return s.docs.map(x => x.data()).sort((a, b) => a.page - b.page).map(x => x.data);
  }
  async countScans() { const s = await this.F.getCountFromServer(this.col("programs", PID, "scans")); return s.data().count; }
  async deleteAllScans() {
    let n = 0;
    for (;;) {
      const s = await this.F.getDocs(this.F.query(this.col("programs", PID, "scans"), this.F.limit(100)));
      if (s.empty) return n;
      await Promise.all(s.docs.map(x => this.F.deleteDoc(x.ref))); n += s.size;
    }
  }
  async getDraft(key) { const s = await this.F.getDoc(this.d("programs", PID, "drafts", key)); return s.exists() ? s.data() : null; }
  async saveDraft(key, v) { await this.F.setDoc(this.d("programs", PID, "drafts", key), v, { merge: true }); }
  async saveReport(token, data) { await this.F.setDoc(this.d("programs", PID, "reports", token), data); }
  async getReport(token) { const s = await this.F.getDoc(this.d("programs", PID, "reports", token)); return s.exists() ? s.data() : null; }
}

/* ------------------------------------------------------------------ Demo */
const LS = "suhaeng-demo-v1";
class DemoStore {
  async init() {
    try { this.s = JSON.parse(localStorage.getItem(LS)); } catch (e) { this.s = null; }
    if (!this.s) this.s = (await import("./demo-data.js?v=7")).seed();
  }
  // 스캔 이미지는 용량이 커서 브라우저 저장에서 빼고 메모리에만 둔다 (데모 전용)
  save() { try { const { scans, ...rest } = this.s; localStorage.setItem(LS, JSON.stringify(rest)); } catch (e) { /* 저장 공간 부족 등은 무시 */ } }
  onAuth(cb) {
    this._cb = cb;
    let who = null; try { who = sessionStorage.getItem(LS + "-who"); } catch (e) {}
    setTimeout(() => cb(who ? this.user(who) : null), 0);
  }
  user(email) {
    const t = this.s.teachers[email] || { name: "원장", role: "admin", active: true };
    return { email, displayName: t.name, name: t.name, role: t.role, active: true, registered: true };
  }
  async signIn() { const e = "owner@demo"; try { sessionStorage.setItem(LS + "-who", e); } catch (x) {} this._cb(this.user(e)); }
  async signOut() { try { sessionStorage.removeItem(LS + "-who"); } catch (x) {} this._cb(null); }
  async idToken() { return "demo"; }
  async listStudents() { return Object.entries(this.s.students).map(([id, v]) => ({ id, ...v })); }
  async listRecords() { return JSON.parse(JSON.stringify(this.s.records)); }
  async saveStudent(st) { const { id, ...d } = st; const k = id || newToken(10); this.s.students[k] = { ...(this.s.students[k] || {}), ...d }; this.save(); return k; }
  async deleteStudent(id) { delete this.s.students[id]; delete this.s.records[id]; this.save(); }
  async saveRound(sid, r, rec, who) {
    const rr = this.s.records[sid] = this.s.records[sid] || {};
    if (rec) rr[r] = { ...rec, by: who, at: Date.now() }; else delete rr[r];
    this.save();
  }
  async setRounds(sid, rounds) { this.s.records[sid] = { ...(this.s.records[sid] || {}), ...rounds }; this.save(); }
  watch() { return () => {}; }
  async saveJob(id, d) { this.s.bulk = this.s.bulk || {}; this.s.bulk[id] = { ...(this.s.bulk[id] || {}), ...d, id }; this.save(); }
  async listJobs() { return Object.values(this.s.bulk || {}); }
  async deleteJob(id) { if (this.s.bulk) delete this.s.bulk[id]; this.save(); }
  async getRecord(sid) { return JSON.parse(JSON.stringify(this.s.records[sid] || {})); }
  async listTeachers() { return Object.values(this.s.teachers); }
  async saveTeacher(t) { const e = lowerEmail(t.email); this.s.teachers[e] = { ...(this.s.teachers[e] || {}), ...t, email: e }; this.save(); }
  async deleteTeacher(email) { delete this.s.teachers[lowerEmail(email)]; this.save(); }
  async getAnalysis(sid, r) { return this.s.analyses[`${sid}_${r}`] || null; }
  async listAnalyses(sid) { const o = {}; Object.values(this.s.analyses).filter(a => a.sid === sid).forEach(a => o[a.round] = a); return o; }
  async saveAnalysis(sid, r, a) { this.s.analyses[`${sid}_${r}`] = { ...a, sid, round: +r }; this.save(); }
  async saveScans(sid, r, urls) { this.s.scans = this.s.scans || {}; this.s.scans[`${sid}_${r}`] = urls.slice(0, 6); this.save(); }
  async getScans(sid, r) { return (this.s.scans || {})[`${sid}_${r}`] || []; }
  async countScans() { return Object.values(this.s.scans || {}).reduce((a, x) => a + x.length, 0); }
  async deleteAllScans() { const n = await this.countScans(); this.s.scans = {}; this.save(); return n; }
  async getDraft(k) { return (this.s.drafts || {})[k] || null; }
  async saveDraft(k, v) { this.s.drafts = this.s.drafts || {}; this.s.drafts[k] = { ...(this.s.drafts[k] || {}), ...v }; this.save(); }
  async saveReport(t, d) { this.s.reports = this.s.reports || {}; this.s.reports[t] = d; this.save(); }
  async getReport(t) { return (this.s.reports || {})[t] || null; }
  reset() { try { localStorage.removeItem(LS); } catch (e) {} }
}

export async function createStore() {
  const s = DEMO ? new DemoStore() : new FirebaseStore();
  await s.init();
  return s;
}
