// /api/admin  (ต้องส่งหัวข้อ X-Admin-Key = ตัวแปรลับ ADMIN_PASSWORD)
const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const authed = (req, env) => {
  const k = req.headers.get("X-Admin-Key") || "", p = env.ADMIN_PASSWORD || "";
  if (!p || k.length !== p.length) return false;
  let x = 0; for (let i = 0; i < k.length; i++) x |= k.charCodeAt(i) ^ p.charCodeAt(i);
  return x === 0;
};
const curRound = async DB => { const r = await DB.prepare("SELECT value FROM settings WHERE key='current_round'").first(); return r ? Number(r.value) : 0; };
const av = x => (x && x.n ? x.sum / x.n : null);

export async function onRequestGet({ request, env }) {
  if (!authed(request, env)) return json({ error: "unauthorized" }, 401);
  const u = new URL(request.url), act = u.searchParams.get("action"), DB = env.DB;
  const rid = Number(u.searchParams.get("round")) || await curRound(DB);

  if (act === "ping") return json({ ok: true });
  if (act === "rounds") {
    const r = await DB.prepare("SELECT r.id,r.name,r.status,r.created_at,(SELECT COUNT(*) FROM responses x WHERE x.round_id=r.id) n FROM rounds r ORDER BY r.id DESC").all();
    return json({ rounds: r.results, current: await curRound(DB) });
  }
  if (act === "plans") return json({ plans: (await DB.prepare("SELECT * FROM plans ORDER BY id").all()).results });
  if (act === "categories") return json({ categories: (await DB.prepare("SELECT * FROM categories ORDER BY sort,id").all()).results });
  if (act === "questions") return json({ questions: (await DB.prepare("SELECT * FROM questions ORDER BY plan_id IS NOT NULL, plan_id, role, sort, id").all()).results });
  if (act === "students") {
    const r = await DB.prepare("SELECT s.student_id,s.name,s.class,s.plan_id,p.name plan_name," +
      "EXISTS(SELECT 1 FROM responses r WHERE r.student_id=s.student_id AND r.role='student' AND r.round_id=?) sd," +
      "EXISTS(SELECT 1 FROM responses r WHERE r.student_id=s.student_id AND r.role='parent' AND r.round_id=?) pd " +
      "FROM students s LEFT JOIN plans p ON p.id=s.plan_id ORDER BY s.class, s.student_id").bind(rid, rid).all();
    return json({ students: r.results });
  }
  if (act === "settings") {
    const r = (await DB.prepare("SELECT * FROM settings").all()).results;
    return json(Object.fromEntries(r.map(x => [x.key, x.value])));
  }
  if (act === "responses") {
    const r = await DB.prepare("SELECT r.id,r.student_id,r.role,r.class,r.answers,r.comment,r.created_at,p.name plan_name FROM responses r LEFT JOIN plans p ON p.id=r.plan_id WHERE r.round_id=? ORDER BY r.id DESC").bind(rid).all();
    return json({ rows: r.results });
  }
  if (act === "summary") {
    const plan = u.searchParams.get("plan"), role = u.searchParams.get("role"), cls = u.searchParams.get("class");
    let sql = "SELECT r.*,p.name plan_name FROM responses r LEFT JOIN plans p ON p.id=r.plan_id WHERE 1=1";
    const bind = [];
    if (plan) { sql += " AND r.plan_id=?"; bind.push(Number(plan)); }
    if (role) { sql += " AND r.role=?"; bind.push(role); }
    if (cls) { sql += " AND r.class=?"; bind.push(cls); }
    const rows = (await DB.prepare(sql).bind(...bind).all()).results;
    const qs = (await DB.prepare("SELECT q.id,q.plan_id,q.role,q.text,q.category_id,p.name plan_name FROM questions q LEFT JOIN plans p ON p.id=q.plan_id").all()).results;
    const catRows = (await DB.prepare("SELECT id,name FROM categories ORDER BY sort,id").all()).results;
    const cats = Object.fromEntries(catRows.map(c => [c.id, c.name]));
    const rn = (await DB.prepare("SELECT id,name FROM rounds ORDER BY id").all()).results;
    const qm = {}; qs.forEach(q => qm[q.id] = { ...q, sum: 0, n: 0, dist: [0, 0, 0, 0, 0] });
    const byRole = { student: 0, parent: 0 }, byPlan = {}, byCat = {}, byClass = {}, trend = {}, daily = {}, comments = [];
    let tot = 0, cnt = 0, total = 0;
    for (const r of rows) {
      let a = {}; try { a = JSON.parse(r.answers); } catch {}
      const t = trend[r.round_id] || (trend[r.round_id] = { count: 0, sum: 0, n: 0 });
      t.count++; Object.values(a).forEach(v => { t.sum += v; t.n++; });
      if (r.round_id !== rid) continue;
      total++; byRole[r.role] = (byRole[r.role] || 0) + 1;
      const bp = byPlan[r.plan_id] || (byPlan[r.plan_id] = { name: r.plan_name || "-", count: 0, sum: 0, n: 0 }); bp.count++;
      const kc = r.class || "ไม่ระบุห้อง", bk = byClass[kc] || (byClass[kc] = { count: 0, sum: 0, n: 0 }); bk.count++;
      for (const [id, v] of Object.entries(a)) {
        const q = qm[id]; if (!q) continue;
        q.sum += v; q.n++; q.dist[v - 1]++; bp.sum += v; bp.n++; bk.sum += v; bk.n++; tot += v; cnt++;
        const ck = q.category_id || 0, bc = byCat[ck] || (byCat[ck] = { name: cats[ck] || "ไม่ระบุด้าน", sum: 0, n: 0 }); bc.sum += v; bc.n++;
      }
      const d = (r.created_at || "").slice(0, 10); daily[d] = (daily[d] || 0) + 1;
      if (r.comment) comments.push({ student_id: r.student_id, role: r.role, plan: r.plan_name, text: r.comment, at: r.created_at });
    }
    let rate = [];
    try {
      const cw = cls ? " AND s.class=?" : "", cb = cls ? [cls] : [];
      const ro = (await DB.prepare("SELECT s.plan_id,COUNT(*) n FROM students s WHERE 1=1" + cw + " GROUP BY s.plan_id").bind(...cb).all()).results;
      const dn = (await DB.prepare("SELECT s.plan_id,r.role,COUNT(DISTINCT r.student_id) n FROM responses r JOIN students s ON s.student_id=r.student_id WHERE r.round_id=?" + cw + " GROUP BY s.plan_id,r.role").bind(rid, ...cb).all()).results;
      const nm = Object.fromEntries((await DB.prepare("SELECT id,name FROM plans").all()).results.map(p => [p.id, p.name]));
      const m = {};
      ro.forEach(x => { if (plan && String(x.plan_id) !== plan) return; m[x.plan_id] = { name: x.plan_id ? nm[x.plan_id] : "ไม่ระบุแผน", roster: x.n, student: 0, parent: 0 }; });
      dn.forEach(x => { const e = m[x.plan_id]; if (e) e[x.role] = x.n; });
      rate = Object.values(m);
    } catch {}
    const classes = (await DB.prepare("SELECT DISTINCT class c FROM students WHERE class<>'' UNION SELECT DISTINCT class FROM responses WHERE class IS NOT NULL AND class<>'' ORDER BY 1").all()).results.map(x => x.c);
    return json({
      round: (rn.find(x => x.id === rid) || {}).name || "", rate, total, byRole, overall: cnt_(tot, cnt), classes,
      byPlan: Object.values(byPlan).map(p => ({ name: p.name, count: p.count, avg: av(p) })),
      byCat: [...catRows.map(c => c.id), 0].filter(k => byCat[k]).map(k => ({ name: byCat[k].name, n: byCat[k].n, avg: av(byCat[k]) })),
      byClass: Object.entries(byClass).sort((a, b) => a[0].localeCompare(b[0], "th")).map(([k, v]) => ({ name: k, count: v.count, avg: av(v) })),
      trend: rn.filter(x => trend[x.id]).map(x => ({ round: x.name, count: trend[x.id].count, avg: av(trend[x.id]) })),
      questions: Object.values(qm).filter(q => q.n).map(q => ({ id: q.id, text: q.text, role: q.role, plan: q.plan_name, category: cats[q.category_id] || "", n: q.n, avg: q.sum / q.n, dist: q.dist })),
      daily: Object.entries(daily).sort().slice(-14).map(([date, n]) => ({ date, n })),
      comments: comments.slice(0, 100),
    });
  }
  return json({ error: "unknown action" }, 400);
}
function cnt_(t, c) { return c ? t / c : null; }

export async function onRequestPost({ request, env }) {
  if (!authed(request, env)) return json({ error: "unauthorized" }, 401);
  let b; try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const DB = env.DB;
  switch (b.action) {
    case "round_save": {
      const name = String(b.name || "").trim().slice(0, 60);
      if (!name) return json({ error: "กรุณากรอกชื่อรอบ" }, 400);
      const status = b.status === "closed" ? "closed" : "open";
      if (b.id) await DB.prepare("UPDATE rounds SET name=?,status=? WHERE id=?").bind(name, status, Number(b.id)).run();
      else {
        const r = await DB.prepare("INSERT INTO rounds (name,status) VALUES (?,?)").bind(name, "open").run();
        await DB.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('current_round',?)").bind(String(r.meta.last_row_id)).run();
      }
      return json({ ok: true });
    }
    case "round_delete": {
      const id = Number(b.id);
      if (id === await curRound(DB)) return json({ error: "ลบรอบปัจจุบันไม่ได้" }, 400);
      const n = await DB.prepare("SELECT COUNT(*) n FROM responses WHERE round_id=?").bind(id).first();
      if (n.n) return json({ error: "รอบนี้มีข้อมูลผู้ตอบ ลบไม่ได้" }, 400);
      await DB.prepare("DELETE FROM rounds WHERE id=?").bind(id).run();
      return json({ ok: true });
    }
    case "category_save": {
      const name = String(b.name || "").trim().slice(0, 60);
      if (!name) return json({ error: "กรุณากรอกชื่อด้าน" }, 400);
      const sort = Number(b.sort) || 0;
      if (b.id) await DB.prepare("UPDATE categories SET name=?,sort=? WHERE id=?").bind(name, sort, Number(b.id)).run();
      else await DB.prepare("INSERT INTO categories (name,sort) VALUES (?,?)").bind(name, sort).run();
      return json({ ok: true });
    }
    case "category_delete":
      await DB.batch([DB.prepare("UPDATE questions SET category_id=NULL WHERE category_id=?").bind(Number(b.id)), DB.prepare("DELETE FROM categories WHERE id=?").bind(Number(b.id))]);
      return json({ ok: true });
    case "plan_save": {
      const name = String(b.name || "").trim().slice(0, 60);
      if (!name) return json({ error: "กรุณากรอกชื่อแผน" }, 400);
      const act = b.active ? 1 : 0;
      if (b.id) await DB.prepare("UPDATE plans SET name=?,active=? WHERE id=?").bind(name, act, Number(b.id)).run();
      else await DB.prepare("INSERT INTO plans (name,active) VALUES (?,?)").bind(name, act).run();
      return json({ ok: true });
    }
    case "question_save": {
      const text = String(b.text || "").trim().slice(0, 300);
      if (!text) return json({ error: "กรุณากรอกคำถาม" }, 400);
      if (!["student", "parent", "both"].includes(b.role)) return json({ error: "ผู้ตอบไม่ถูกต้อง" }, 400);
      const pid = b.plan_id ? Number(b.plan_id) : null, cid = b.category_id ? Number(b.category_id) : null;
      const sort = Number(b.sort) || 0, act = b.active ? 1 : 0;
      if (b.id) await DB.prepare("UPDATE questions SET plan_id=?,category_id=?,role=?,text=?,sort=?,active=? WHERE id=?").bind(pid, cid, b.role, text, sort, act, Number(b.id)).run();
      else await DB.prepare("INSERT INTO questions (plan_id,category_id,role,text,sort,active) VALUES (?,?,?,?,?,?)").bind(pid, cid, b.role, text, sort, act).run();
      return json({ ok: true });
    }
    case "setting_save": {
      if (!["survey_open", "require_roster", "title", "current_round", "consent_required", "consent_text"].includes(b.key)) return json({ error: "bad key" }, 400);
      if (b.key === "current_round" && !(await DB.prepare("SELECT id FROM rounds WHERE id=?").bind(Number(b.value)).first())) return json({ error: "ไม่พบรอบนี้" }, 400);
      await DB.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").bind(b.key, String(b.value).slice(0, b.key === "consent_text" ? 2000 : 120)).run();
      return json({ ok: true });
    }
    case "students_import": {
      const rows = Array.isArray(b.rows) ? b.rows.slice(0, 300) : [];
      const pm = {};
      (await DB.prepare("SELECT id,name FROM plans").all()).results.forEach(p => pm[p.name.trim().toLowerCase()] = p.id);
      const stmts = [], errors = [];
      for (const r of rows) {
        const id = String(r.student_id || "").trim(), name = String(r.name || "").trim().slice(0, 80);
        const cls = String(r.class || "").trim().slice(0, 20), pn = String(r.plan || "").trim();
        if (!/^[A-Za-z0-9\-]{3,20}$/.test(id)) { errors.push("แถว " + r.line + ": รหัส \"" + id.slice(0, 20) + "\" ไม่ถูกต้อง"); continue; }
        let pid = null;
        if (pn) { pid = pm[pn.toLowerCase()]; if (!pid) { errors.push("แถว " + r.line + ": ไม่พบแผนการเรียน \"" + pn.slice(0, 40) + "\""); continue; } }
        stmts.push(DB.prepare("INSERT INTO students (student_id,name,class,plan_id) VALUES (?,?,?,?) ON CONFLICT(student_id) DO UPDATE SET name=excluded.name,class=excluded.class,plan_id=excluded.plan_id").bind(id, name, cls, pid));
      }
      if (stmts.length) await DB.batch(stmts);
      return json({ ok: true, saved: stmts.length, errors: errors.slice(0, 50) });
    }
    case "student_delete":
      await DB.prepare("DELETE FROM students WHERE student_id=?").bind(String(b.student_id || "")).run();
      return json({ ok: true });
    case "students_clear":
      await DB.prepare("DELETE FROM students").run();
      return json({ ok: true });
    case "response_delete":
      await DB.prepare("DELETE FROM responses WHERE id=?").bind(Number(b.id)).run();
      return json({ ok: true });
    case "reset_responses":
      await DB.prepare("DELETE FROM responses WHERE round_id=?").bind(Number(b.round_id)).run();
      return json({ ok: true });
  }
  return json({ error: "unknown action" }, 400);
}
