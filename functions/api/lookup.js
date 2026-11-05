// GET /api/lookup?id=12345 : ตรวจรหัสนักเรียนกับรายชื่อ (คืนชื่อแบบปิดบังบางส่วน)
const json = d => new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestGet({ request, env }) {
  const id = (new URL(request.url).searchParams.get("id") || "").trim();
  let required = false, s = null;
  try {
    const r = await env.DB.prepare("SELECT value FROM settings WHERE key='require_roster'").first();
    required = !!r && r.value === "1";
    s = await env.DB.prepare("SELECT name,class,plan_id FROM students WHERE student_id=?").bind(id).first();
  } catch {}
  return json({
    found: !!s, required,
    name: s ? (s.name ? s.name.slice(0, 3) + "***" : "") : "",
    class: s ? s.class || "" : "", plan_id: s ? s.plan_id : null,
  });
}
