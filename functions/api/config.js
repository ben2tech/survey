// GET /api/config (สาธารณะ)
export async function onRequestGet({ env }) {
  const DB = env.DB;
  const [p, q, c, s] = await Promise.all([
    DB.prepare("SELECT id,name FROM plans WHERE active=1 ORDER BY id").all(),
    DB.prepare("SELECT id,plan_id,category_id,role,text FROM questions WHERE active=1 ORDER BY sort,id").all(),
    DB.prepare("SELECT id,name FROM categories ORDER BY sort,id").all(),
    DB.prepare("SELECT key,value FROM settings").all(),
  ]);
  const st = Object.fromEntries(s.results.map(r => [r.key, r.value]));
  const round = st.current_round ? await DB.prepare("SELECT id,name,status FROM rounds WHERE id=?").bind(Number(st.current_round)).first() : null;
  return new Response(JSON.stringify({
    plans: p.results, questions: q.results, categories: c.results,
    open: st.survey_open !== "0" && !!round && round.status === "open",
    round: round ? round.name : "",
    school: st.school_name || "",
    title: st.title || "แบบสอบถามความพึงพอใจในการเรียน",
    consent_required: st.consent_required !== "0", consent_text: st.consent_text || "",
    turnstile: env.TURNSTILE_SITE_KEY || "",
  }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
