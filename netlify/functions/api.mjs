// Pal Books online API (Netlify Function + Netlify Blobs).
// Environment variables (set them in Netlify -> Site configuration -> Environment variables):
//   SESSION_SECRET  a long random text, used to sign login sessions
//   LIC_SECRET      the same secret phrase you use in the license tool (to check activation codes)
import crypto from "node:crypto";

const SESSION_SECRET = process.env.SESSION_SECRET || "";
const LIC_SECRET = process.env.LIC_SECRET || "";

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const err = (m, s = 400) => json({ error: m }, s);
const b64 = (b) => Buffer.from(b).toString("base64url");
const sign = (p) => crypto.createHmac("sha256", SESSION_SECRET).update(p).digest("base64url");
const makeToken = (id, email, days = 30) => { const p = b64(JSON.stringify({ id, email, exp: Date.now() + days * 864e5 })); return p + "." + sign(p); };
function readToken(t) {
  if (!t || !SESSION_SECRET) return null;
  const [p, s] = t.split(".");
  if (!p || !s) return null;
  const a = Buffer.from(s), b = Buffer.from(sign(p));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const o = JSON.parse(Buffer.from(p, "base64url").toString()); return o.exp > Date.now() ? o : null; } catch { return null; }
}
const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, (e, k) => (e ? rej(e) : res(k))));
const normEmail = (e) => String(e || "").trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 200;
const ukey = (email) => encodeURIComponent(email);
const todayISO = () => new Date().toISOString().slice(0, 10);
function addDays(d, n) { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function addPlan(p, st) {
  const d = new Date(st + "T00:00:00Z"), dy = d.getUTCDate();
  d.setUTCDate(1);
  if (p === "M") d.setUTCMonth(d.getUTCMonth() + 1); else d.setUTCFullYear(d.getUTCFullYear() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dy, last));
  return d.toISOString().slice(0, 10);
}
function subStatus(sub) {
  const T = todayISO();
  let e = "";
  for (const c of (sub && sub.c) || []) if (c.e > e) e = c.e;
  if (e && e >= T) return "pro";
  return T < addDays((sub && sub.t) || T, 7) ? "trial" : "expired";
}
const cleanData = (d) => { const o = {}; for (const k of Object.keys(d)) if (k === "pb_cos" || k.startsWith("pb_d_")) o[k] = d[k]; return o; };

export async function handle(req, getStore) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";
  const method = req.method;
  const st = (n) => getStore({ name: n, consistency: "strong" });
  if (path === "/ping") return json({ palbooks: true, configured: !!SESSION_SECRET });
  if (!SESSION_SECRET) return err("The server is not configured yet (SESSION_SECRET is missing).", 500);
  let body = {};
  if (method === "POST" || method === "PUT") { try { body = await req.json(); } catch { body = {}; } }
  const users = st("users");

  async function authUser() {
    const h = req.headers.get("authorization") || "";
    const tok = readToken(h.startsWith("Bearer ") ? h.slice(7) : "");
    if (!tok) return null;
    const rec = await users.get(ukey(tok.email), { type: "json" });
    return rec && rec.id === tok.id ? rec : null;
  }

  if (path === "/signup" && method === "POST") {
    const em = normEmail(body.email), pw = body.password;
    if (!validEmail(em)) return err("Enter a valid email address.");
    if (typeof pw !== "string" || pw.length < 8) return err("Password must be at least 8 characters.");
    const salt = crypto.randomBytes(16), hash = await scrypt(pw, salt), id = crypto.randomBytes(8).toString("hex");
    const rec = { id, email: em, salt: salt.toString("hex"), hash: hash.toString("hex"), created: new Date().toISOString(), sub: { t: todayISO(), c: [] } };
    const r = await users.setJSON(ukey(em), rec, { onlyIfNew: true });
    if (r && r.modified === false) return err("An account with this email already exists.", 409);
    return json({ token: makeToken(id, em), email: em });
  }

  if (path === "/login" && method === "POST") {
    const em = normEmail(body.email), pw = String(body.password || "");
    const fails = st("fails"), fk = ukey(em);
    const f = await fails.get(fk, { type: "json" });
    if (f && f.until > Date.now()) return err("Too many attempts. Try again in 15 minutes.", 429);
    const rec = await users.get(ukey(em), { type: "json" });
    let ok = false;
    if (rec) { const h = await scrypt(pw, Buffer.from(rec.salt, "hex")); ok = crypto.timingSafeEqual(h, Buffer.from(rec.hash, "hex")); }
    else await scrypt(pw, crypto.randomBytes(16));
    if (!ok) { const n = ((f && f.n) || 0) + 1; await fails.setJSON(fk, { n, until: n >= 8 ? Date.now() + 15 * 60000 : 0 }); return err("Invalid email or password.", 401); }
    if (f) await fails.delete(fk);
    return json({ token: makeToken(rec.id, em), email: em });
  }

  const rec = await authUser();
  if (!rec) return err("Please sign in.", 401);
  const data = st("data"), dkey = "u_" + rec.id;

  if (path === "/me" && method === "GET") return json({ email: rec.email, sub: rec.sub });

  if (path === "/data" && method === "GET") {
    const cur = (await data.get(dkey, { type: "json" })) || { rev: 0, data: {} };
    return json({ rev: cur.rev || 0, data: cur.data || {} });
  }

  if (path === "/data" && method === "PUT") {
    if (subStatus(rec.sub) === "expired") return err("Your subscription has ended. Choose a plan to continue.", 402);
    if (!body.data || typeof body.data !== "object") return err("Invalid data.");
    const clean = cleanData(body.data);
    if (JSON.stringify(clean).length > 5000000) return err("The data is too large.", 413);
    const cur = (await data.get(dkey, { type: "json" })) || { rev: 0, data: {} };
    if ((body.rev | 0) !== (cur.rev | 0)) return err("The data was changed on another device.", 409);
    const T = todayISO();
    let bk = cur.bk;
    if (cur.rev > 0 && cur.bk !== T) {
      await data.setJSON(`bk_${rec.id}_${T}`, cur);
      bk = T;
      const l = await data.list({ prefix: `bk_${rec.id}_` });
      const keys = (l.blobs || []).map((b) => b.key).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - 14))) await data.delete(k);
    }
    const next = { rev: (cur.rev | 0) + 1, bk, data: clean };
    await data.setJSON(dkey, next);
    return json({ rev: next.rev });
  }

  if (path === "/activate" && method === "POST") {
    const m = String(body.code || "").trim().toUpperCase().match(/^PB-([MY])-(\d{6})-([0-9A-F]{4})-([0-9A-F]{4})-([0-9A-F]{4})$/);
    const bad = () => err("This activation code is not valid for " + rec.email + ".");
    if (!m || !LIC_SECRET) return bad();
    const h = crypto.createHash("sha256").update(`${LIC_SECRET}|${rec.email}|${m[1]}|${m[2]}`).digest("hex").slice(0, 12).toUpperCase();
    const given = m[3] + m[4] + m[5];
    if (!crypto.timingSafeEqual(Buffer.from(h), Buffer.from(given))) return bad();
    const code = m[0], T = todayISO();
    const start = "20" + m[2].slice(0, 2) + "-" + m[2].slice(2, 4) + "-" + m[2].slice(4, 6);
    if (isNaN(new Date(start + "T00:00:00Z"))) return bad();
    const sub = rec.sub || { t: T, c: [] };
    if (sub.c.some((c) => c.k === code)) return err("This code was already used.");
    if (start > addDays(T, 1)) return err("This code is not valid yet (starts " + start + ").");
    let cur = "";
    for (const c of sub.c) if (c.e > cur) cur = c.e;
    const base = cur && cur >= T && cur >= start ? addDays(cur, 1) : start, e = addPlan(m[1], base);
    if (e < T) return err("This code has expired.");
    sub.c.push({ k: code, p: m[1], s: base, e });
    rec.sub = sub;
    await users.setJSON(ukey(rec.email), rec);
    return json({ sub, until: e });
  }

  if (path === "/account" && method === "POST") {
    const h = await scrypt(String(body.current || ""), Buffer.from(rec.salt, "hex"));
    if (!crypto.timingSafeEqual(h, Buffer.from(rec.hash, "hex"))) return err("Your current password is wrong.", 401);
    const oldKey = ukey(rec.email);
    let newEmail = rec.email;
    if (body.email) {
      newEmail = normEmail(body.email);
      if (!validEmail(newEmail)) return err("Enter a valid email address.");
    }
    if (body.password) {
      if (String(body.password).length < 8) return err("The new password must be at least 8 characters.");
      const salt = crypto.randomBytes(16);
      rec.salt = salt.toString("hex");
      rec.hash = (await scrypt(String(body.password), salt)).toString("hex");
    }
    if (newEmail !== rec.email) {
      const r = await users.setJSON(ukey(newEmail), { ...rec, email: newEmail }, { onlyIfNew: true });
      if (r && r.modified === false) return err("An account with this email already exists.", 409);
      await users.delete(oldKey);
      rec.email = newEmail;
    } else {
      await users.setJSON(oldKey, rec);
    }
    return json({ token: makeToken(rec.id, rec.email), email: rec.email });
  }

  return err("Not found.", 404);
}

export default async (req) => {
  const { getStore } = await import("@netlify/blobs");
  try { return await handle(req, getStore); } catch (e) { return err("Server error: " + (e && e.message ? e.message : e), 500); }
};

export const config = { path: "/api/*" };
