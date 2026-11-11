// GET /api/lookup?id=12345 : ค้นหานักเรียนจากรายชื่อ (ชื่อ ห้อง สาย) และสถานะการตอบในรอบปัจจุบัน
const json = d => new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestGet({ request, env }) {
  const id = (new URL(request.url).searchParams.get("id") || "").trim();
  let required = false, s = null; const done = { student: false, parent: false };
  try {
    const st = Object.fromEntries((await env.DB.prepare("SELECT key,value FROM settings").all()).results.map(r => [r.key, r.value]));
    required = st.require_roster === "1";
    s = await env.DB.prepare("SELECT name,class,plan_id,seq FROM students WHERE student_id=?").bind(id).first();
    if (s && st.current_round) {
      const r = await env.DB.prepare("SELECT role FROM responses WHERE round_id=? AND student_id=?").bind(Number(st.current_round), id).all();
      r.results.forEach(x => { done[x.role] = true; });
    }
  } catch {}
  return json({ found: !!s, required, name: s ? s.name || "" : "", class: s ? s.class || "" : "", plan_id: s ? s.plan_id : null, no: s ? s.seq : null, done });
}
