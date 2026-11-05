// Cloudflare Worker: ส่งคำขอ /api/* ไปยังฟังก์ชันเดิมใน functions/api/
// ส่วนหน้าเว็บ (โฟลเดอร์ public/) Cloudflare เสิร์ฟให้เองอัตโนมัติ
import * as config from "./functions/api/config.js";
import * as lookup from "./functions/api/lookup.js";
import * as submit from "./functions/api/submit.js";
import * as admin from "./functions/api/admin.js";

const routes = { "/api/config": config, "/api/lookup": lookup, "/api/submit": submit, "/api/admin": admin };
const json = (d, s) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/$/, "");
    const mod = routes[path];
    if (!mod) return env.ASSETS ? env.ASSETS.fetch(request) : json({ error: "not found" }, 404);
    const m = request.method;
    const handler = mod["onRequest" + m.charAt(0) + m.slice(1).toLowerCase()];
    if (!handler) return json({ error: "method not allowed" }, 405);
    if (!env.DB) return json({ error: "ยังไม่ได้ผูกฐานข้อมูล D1 (binding ชื่อ DB)" }, 500);
    try { return await handler({ request, env }); }
    catch (e) { return json({ error: "server error" }, 500); }
  },
};
