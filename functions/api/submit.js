// POST /api/submit
const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

async function verifyTurnstile(token, secret, ip) {
  const f = new FormData();
  f.append("secret", secret); f.append("response", token || ""); if (ip) f.append("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: f });
    return !!(await r.json()).success;
  } catch { return false; }
}

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400); }
  const DB = env.DB;

  const st = Object.fromEntries((await DB.prepare("SELECT key,value FROM settings").all()).results.map(r => [r.key, r.value]));
  const round = st.current_round ? await DB.prepare("SELECT id,status FROM rounds WHERE id=?").bind(Number(st.current_round)).first() : null;
  if (st.survey_open === "0" || !round || round.status !== "open") return json({ error: "ขณะนี้ปิดรับแบบสอบถาม" }, 403);
  if (st.consent_required !== "0" && b.consent !== true) return json({ error: "กรุณายินยอมประกาศความเป็นส่วนตัวก่อน" }, 400);
  if (env.TURNSTILE_SECRET && !(await verifyTurnstile(b.cf_token, env.TURNSTILE_SECRET, request.headers.get("CF-Connecting-IP"))))
    return json({ error: "ยืนยันตัวตนไม่ผ่าน กรุณาลองใหม่" }, 400);

  const sid = String(b.student_id || "").trim();
  const role = b.role; let planId = Number(b.plan_id);
  if (!/^[A-Za-z0-9\-]{3,20}$/.test(sid)) return json({ error: "รหัสนักเรียนไม่ถูกต้อง" }, 400);
  if (!["student", "parent"].includes(role)) return json({ error: "ประเภทผู้ตอบไม่ถูกต้อง" }, 400);

  let s = null;
  try { s = await DB.prepare("SELECT plan_id,class FROM students WHERE student_id=?").bind(sid).first(); } catch {}
  if (s && s.plan_id) planId = s.plan_id;                       // ล็อกแผนตามรายชื่อ
  else if (!s && st.require_roster === "1") return json({ error: "ไม่พบรหัสนักเรียนนี้ในรายชื่อ" }, 403);

  const plan = await DB.prepare("SELECT id FROM plans WHERE id=? AND active=1").bind(planId).first();
  if (!plan) return json({ error: "แผนการเรียนไม่ถูกต้อง" }, 400);

  const { results: qs } = await DB.prepare(
    "SELECT id FROM questions WHERE active=1 AND (plan_id IS NULL OR plan_id=?) AND role IN (?, 'both')"
  ).bind(planId, role).all();
  if (!qs.length) return json({ error: "ยังไม่มีคำถามสำหรับแผนนี้" }, 400);

  const a = b.answers || {}, clean = {};
  for (const q of qs) {
    const v = a[q.id];
    if (!Number.isInteger(v) || v < 1 || v > 5) return json({ error: "คำตอบไม่ครบถ้วน" }, 400);
    clean[q.id] = v;
  }
  try {
    await DB.prepare("INSERT INTO responses (round_id, student_id, plan_id, role, class, answers, comment) VALUES (?,?,?,?,?,?,?)")
      .bind(round.id, sid, planId, role, s ? s.class || null : null, JSON.stringify(clean), String(b.comment || "").slice(0, 500)).run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) return json({ error: "รหัสนี้ได้ตอบแบบสอบถามในฐานะนี้แล้ว (ในรอบนี้)" }, 409);
    return json({ error: "บันทึกข้อมูลไม่สำเร็จ" }, 500);
  }
  return json({ ok: true });
}
