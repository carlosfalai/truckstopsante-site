// Portail partenaire Truck Stop Santé — API.
// Une association ou une entreprise se connecte avec son code, voit ses personnes couvertes,
// en ajoute (une par une ou en lot depuis une liste collée), les met en pause, les retire,
// et voit ce qui sera facturé ce mois-ci. Chaque ajout déclenche l'invitation Spruce (texto + courriel)
// après vérification sur Spruce (jamais de doublon), et une alerte Telegram à Carlos.
// Carlos (code admin) crée les partenaires, active la facturation Stripe, suit les invitations.
import {
  DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand, QueryCommand, ScanCommand, DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { randomUUID, randomBytes } from "node:crypto";

const db = new DynamoDBClient({ region: "ca-central-1" });
const T_PARTNERS = "tss-portail-partenaires";
const T_MEMBERS = "tss-portail-membres";
const PRIX = 8; // $ CAD par personne couverte par mois
const ADMIN_CODE = process.env.ADMIN_CODE || "";
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_PRICE = process.env.STRIPE_PRICE_ID || "";
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || "";
const SPRUCE_AUTH = process.env.SPRUCE_AUTH || ""; // "Basic …" — même valeur que spruce-invite-today.js
const AUTO_INVITE = (process.env.AUTO_INVITE || "oui") === "oui";
const COVERAGES = ["indeterminee", "3", "6", "12"];
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const ADMIN_GOOGLE_EMAILS = (process.env.ADMIN_GOOGLE_EMAILS || "").toLowerCase().split(",").map((e) => e.trim()).filter(Boolean);
const splitEmails = (v) => String(v || "").toLowerCase().split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};
const reply = (code, body) => ({ statusCode: code, headers: CORS, body: JSON.stringify(body) });
const clean = (v, n) => String(v ?? "").trim().slice(0, n);
const S = (v) => ({ S: String(v ?? "") });
const now = () => new Date().toISOString();
const digits = (p) => String(p || "").replace(/\D/g, "");
const e164 = (p) => { let d = digits(p); if (d.length === 10) d = "1" + d; return d.length === 11 ? "+" + d : ""; };
const validPhone = (p) => digits(p).length >= 10;
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/* ---------- Google (connexion des entreprises, jamais des membres) ---------- */
// Vérifie un ID token "Sign in with Google" : signature + audience validées par Google, courriel vérifié exigé.
async function verifyGoogle(idToken) {
  if (!GOOGLE_CLIENT_ID || !idToken) return null;
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken));
    if (!r.ok) return null;
    const t = await r.json();
    if (t.aud !== GOOGLE_CLIENT_ID || t.email_verified !== "true" || !t.email) return null;
    return { email: String(t.email).toLowerCase(), sub: t.sub, name: t.name || "", picture: t.picture || "" };
  } catch { return null; }
}
async function findPartnerByGoogleEmail(email) {
  const all = await listPartners();
  return all.find((p) => p.active !== "non" && (splitEmails(p.google_emails).includes(email) || (p.contact_email || "").toLowerCase() === email)) || null;
}

/* ---------- DynamoDB helpers ---------- */
const unmarshal = (it) => {
  const o = {};
  for (const [k, v] of Object.entries(it || {})) o[k] = v.S ?? (v.N !== undefined ? Number(v.N) : v.BOOL ?? null);
  return o;
};
async function getPartner(code) {
  if (!code || code.length < 8) return null;
  const r = await db.send(new GetItemCommand({ TableName: T_PARTNERS, Key: { code: S(code) } }));
  if (!r.Item) return null;
  const p = unmarshal(r.Item);
  return p.active === "non" ? null : p;
}
async function listPartners() {
  const r = await db.send(new ScanCommand({ TableName: T_PARTNERS }));
  return (r.Items || []).map(unmarshal).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}
async function listMembers(partnerCode) {
  const r = await db.send(new QueryCommand({
    TableName: T_MEMBERS,
    KeyConditionExpression: "partner_code = :p",
    ExpressionAttributeValues: { ":p": S(partnerCode) },
  }));
  return (r.Items || []).map(unmarshal).sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
}
async function getMember(partnerCode, id) {
  const r = await db.send(new GetItemCommand({ TableName: T_MEMBERS, Key: { partner_code: S(partnerCode), id: S(id) } }));
  return r.Item ? unmarshal(r.Item) : null;
}
async function putItem(table, item) {
  const Item = {}; for (const [k, v] of Object.entries(item)) Item[k] = S(v);
  await db.send(new PutItemCommand({ TableName: table, Item }));
}
async function updateFields(table, key, fields) {
  const names = {}, values = {}, sets = [];
  let i = 0;
  for (const [k, v] of Object.entries(fields)) {
    i++; names["#f" + i] = k; values[":v" + i] = S(v); sets.push(`#f${i} = :v${i}`);
  }
  await db.send(new UpdateItemCommand({
    TableName: table, Key: key,
    UpdateExpression: "SET " + sets.join(", "),
    ExpressionAttributeNames: names, ExpressionAttributeValues: values,
  }));
}

/* ---------- Stripe (facturation mensuelle = actifs x 8 $) ---------- */
async function stripe(method, path, params) {
  if (!STRIPE_KEY) return null;
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const r = await fetch("https://api.stripe.com" + path, {
    method,
    headers: { Authorization: "Bearer " + STRIPE_KEY, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = await r.json();
  if (!r.ok) throw new Error("stripe: " + (j.error?.message || r.status));
  return j;
}
async function syncStripeQuantity(partner, actifs) {
  if (partner.demo === "oui") return { synced: false, reason: "demo" };
  if (!partner.stripe_subscription_id) return { synced: false, reason: "no_subscription" };
  const sub = await stripe("GET", "/v1/subscriptions/" + partner.stripe_subscription_id);
  const item = sub.items?.data?.[0];
  if (!item) return { synced: false, reason: "no_item" };
  if (Number(item.quantity) === actifs) return { synced: true, unchanged: true };
  await stripe("POST", "/v1/subscription_items/" + item.id, { quantity: String(actifs), proration_behavior: "none" });
  return { synced: true, quantity: actifs };
}
async function billingInfo(partner) {
  if (!partner.stripe_subscription_id) return { actif: false };
  try {
    const sub = await stripe("GET", "/v1/subscriptions/" + partner.stripe_subscription_id);
    return {
      actif: ["active", "trialing", "past_due"].includes(sub.status),
      statut: sub.status,
      quantite: sub.items?.data?.[0]?.quantity ?? 0,
      prochaine_facture: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString().slice(0, 10) : null,
      mode: sub.collection_method,
    };
  } catch (e) {
    return { actif: false, erreur: e.message };
  }
}
// Lien vers le portail client Stripe (changer la carte, voir les factures, annuler).
async function stripePortalLink(partner) {
  if (!partner.stripe_customer_id) return null;
  try {
    const s = await stripe("POST", "/v1/billing_portal/sessions", { customer: partner.stripe_customer_id, return_url: "https://truckstopsante.com/portail/tableau.html" });
    return s.url;
  } catch { return null; }
}

/* ---------- Spruce (vérifier d'abord, inviter ensuite : texto + courriel) ---------- */
async function spruce(method, path, body) {
  if (!SPRUCE_AUTH) throw new Error("spruce_not_configured");
  const r = await fetch("https://api.sprucehealth.com" + path, {
    method,
    headers: { Authorization: SPRUCE_AUTH, Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = {};
  try { j = await r.json(); } catch { j = {}; }
  return { s: r.status, b: j };
}
function contactMatches(c, phone, email) {
  const ph = digits(phone), em = (email || "").toLowerCase();
  const phones = (c.phoneNumbers || []).map((p) => digits(p.value || p.displayValue));
  const emails = (c.emailAddresses || []).map((e) => (e.value || "").toLowerCase());
  return (ph && phones.some((x) => x.endsWith(ph.slice(-10)))) || (em && emails.includes(em));
}
// Cherche un contact Spruce par téléphone puis par courriel (la recherche est floue : on valide sur les vrais champs).
async function findSpruceContact(phone, email) {
  // Several Spruce contacts can share a phone (duplicates): prefer one with an account, then a pending invite.
  const hits = [];
  for (const q of [e164(phone), digits(phone).slice(-10), email].filter(Boolean)) {
    const r = await spruce("POST", "/v1/contacts/search", { freeText: q });
    const list = (r.s === 200 && r.b.contacts) || [];
    for (const c of list) if (contactMatches(c, phone, email) && !hits.some((h) => h.id === c.id)) hits.push(c);
  }
  if (!hits.length) return null;
  return hits.find((c) => c.hasAccount) || hits.find((c) => c.hasPendingInvite) || hits[0];
}
// Retour : { statut: "compte" | "invite" | "erreur", detail }
async function spruceInvite(m) {
  const existing = await findSpruceContact(m.phone, m.email);
  if (existing) {
    if (existing.hasAccount) return { statut: "compte", detail: "déjà un compte Spruce" };
    if (existing.hasPendingInvite) return { statut: "invite", detail: "invitation déjà en attente" };
  }
  let contact = existing;
  if (!contact) {
    const cr = await spruce("POST", "/v1/contacts", {
      givenName: m.first_name, familyName: m.last_name, category: "patient",
      phoneNumbers: [{ value: e164(m.phone) || m.phone }],
      emailAddresses: m.email ? [{ value: m.email }] : [],
    });
    if (cr.s !== 200 && cr.s !== 201) return { statut: "erreur", detail: "création contact HTTP " + cr.s };
    contact = cr.b.contact || cr.b;
  }
  if (!contact.phoneNumbers?.length && !contact.emailAddresses?.length) {
    const g = await spruce("GET", "/v1/contacts/" + contact.id);
    contact = g.b.contact || g.b;
  }
  const results = [];
  for (const dest of [...(contact.phoneNumbers || []).slice(0, 1), ...(contact.emailAddresses || []).slice(0, 1)]) {
    if (!dest.id) continue;
    const ir = await spruce("POST", `/v1/contacts/${contact.id}/invite`, { destinationId: dest.id });
    results.push(ir.s);
  }
  const ok = results.some((s) => s === 200 || s === 201);
  return ok ? { statut: "invite", detail: "texto + courriel envoyés", contact_id: contact.id } : { statut: "erreur", detail: "invitation HTTP " + results.join("/") };
}

/* ---------- Telegram (alerte à Carlos) ---------- */
async function telegram(text, partner) {
  if (!TG_TOKEN || !TG_CHAT || (partner && partner.demo === "oui")) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: true }),
    });
  } catch { /* une alerte manquée ne doit pas bloquer le portail */ }
}

/* ---------- Résumé ---------- */
function summary(members, billing, full) {
  const actifs = members.filter((m) => m.status === "actif");
  const pause = members.filter((m) => m.status === "pause");
  const retires = members.filter((m) => m.status === "retire");
  const mois = now().slice(0, 7);
  const ajoutsMois = members.filter((m) => (m.created_at || "").startsWith(mois)).length;
  const pausesMois = members.filter((m) => (m.paused_at || "").startsWith(mois) && m.status === "pause").length;
  const retraitsMois = members.filter((m) => (m.removed_at || "").startsWith(mois)).length;
  const aInviter = actifs.filter((m) => (m.spruce || "a_inviter") === "a_inviter").length;
  const enAttente = actifs.filter((m) => m.spruce === "invite").length;
  const banque = Math.floor(actifs.length / 100) * 5; // 5 consultations gratuites / mois par tranche de 100 personnes couvertes
  return {
    actifs: actifs.length, pause: pause.length, retires: retires.length,
    prix: PRIX, montant: actifs.length * PRIX,
    ajouts_mois: ajoutsMois, pauses_mois: pausesMois, retraits_mois: retraitsMois,
    ...(full ? { a_inviter: aInviter, invitations_en_attente: enAttente } : {}),
    banque_consultations: banque,
    places_payees: billing?.quantite ?? null,
    prochaine_facture: billing?.prochaine_facture || null,
    facturation_active: !!billing?.actif,
  };
}
const monthsSince = (iso) => { if (!iso) return 0; const d = (Date.now() - new Date(iso).getTime()) / (30.44 * 86400000); return Math.max(0, Math.floor(d)); };
const publicMember = (m, full) => ({
  id: m.id, first_name: m.first_name, last_name: m.last_name, phone: m.phone, email: m.email,
  status: m.status, family_of: m.family_of || "", note: m.note || "",
  since_months: m.since_months ? Number(m.since_months) : 0, coverage: m.coverage || "indeterminee",
  created_at: m.created_at, months_covered: monthsSince(m.created_at), paused_at: m.paused_at || "", removed_at: m.removed_at || "",
  ...(full ? { spruce: m.spruce || "a_inviter", spruce_detail: m.spruce_detail || "", spruce_invited_at: m.spruce_invited_at || "" } : {}),
});
const publicPartner = (p) => ({
  code: p.code, name: p.name, type: p.type, contact_name: p.contact_name, contact_email: p.contact_email,
  contact_phone: p.contact_phone, billing_email: p.billing_email, created_at: p.created_at,
  stripe_subscription_id: p.stripe_subscription_id || "", stripe_customer_id: p.stripe_customer_id || "",
  bank_code: p.bank_code || "", demo: p.demo === "oui", google_emails: splitEmails(p.google_emails),
});
function makeCode(name) {
  const base = clean(name, 12).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "TSS";
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = randomBytes(6);
  let tail = "";
  for (let i = 0; i < 6; i++) tail += alphabet[b[i] % alphabet.length];
  return `${base}-${tail}`;
}

// Ajoute une personne : vérifie, enregistre, invite sur Spruce, retourne le résultat.
async function addMember(partner, data, existingMembers) {
  const first_name = clean(data.first_name, 80), last_name = clean(data.last_name, 80);
  const phone = clean(data.phone, 40), email = clean(data.email, 160).toLowerCase();
  if (!first_name || !last_name) return { ok: false, error: "missing_name" };
  if (!validPhone(phone)) return { ok: false, error: "bad_phone" };
  if (!validEmail(email)) return { ok: false, error: "bad_email" };
  const dup = existingMembers.find((m) => m.status !== "retire" && ((m.email || "").toLowerCase() === email || digits(m.phone) === digits(phone)));
  if (dup) return { ok: false, error: "duplicate", member: publicMember(dup) };
  const since = Math.max(0, Math.min(600, parseInt(data.since_months, 10) || 0));
  const coverage = COVERAGES.includes(String(data.coverage)) ? String(data.coverage) : "indeterminee";
  const item = {
    partner_code: partner.code, id: randomUUID(), first_name, last_name, phone, email,
    status: "actif", family_of: clean(data.family_of, 80), note: clean(data.note, 300),
    since_months: String(since), coverage,
    spruce: "a_inviter", spruce_detail: "", spruce_invited_at: "",
    created_at: now(), updated_at: now(), paused_at: "", removed_at: "",
  };
  if (partner.demo === "oui") {
    item.spruce = data.spruce === "invite" ? "invite" : "compte"; item.spruce_detail = "démo (personne fictive)"; if (item.spruce === "invite") item.spruce_invited_at = now();
  } else if (AUTO_INVITE) {
    try {
      const r = await spruceInvite(item);
      item.spruce = r.statut === "erreur" ? "a_inviter" : r.statut;
      item.spruce_detail = r.detail;
      if (r.statut === "invite") item.spruce_invited_at = now();
    } catch (e) { item.spruce_detail = "spruce: " + e.message; }
  }
  await putItem(T_MEMBERS, item);
  existingMembers.push(item);
  return { ok: true, member: publicMember(item) };
}

/* ---------- Handler ---------- */
export const handler = async (event) => {
  const method = event.requestContext?.http?.method ?? "GET";
  const path = (event.rawPath || "/").replace(/\/+$/, "") || "/";
  if (method === "OPTIONS") return reply(200, { ok: true });
  const q = event.queryStringParameters || {};
  let data = {};
  if (method === "POST") {
    try { data = JSON.parse(event.body || "{}"); } catch { return reply(400, { error: "invalid_json" }); }
  }
  const code = clean(method === "GET" ? q.code : data.code, 60);
  const isAdmin = ADMIN_CODE && code === ADMIN_CODE;

  try {
    /* ----- Connexion ----- */
    if (path === "/login" && method === "POST") {
      if (isAdmin) return reply(200, { ok: true, role: "admin" });
      const p = await getPartner(code);
      if (!p) return reply(401, { error: "bad_code" });
      return reply(200, { ok: true, role: "partner", partner: publicPartner(p) });
    }

    // Connexion Google : le courriel Google doit être connu (contact de l'entreprise ou courriel lié). Sinon, lier une fois avec le code.
    if (path === "/login/google" && method === "POST") {
      const g = await verifyGoogle(clean(data.credential, 4000));
      if (!g) return reply(401, { error: "bad_google" });
      if (ADMIN_GOOGLE_EMAILS.includes(g.email)) return reply(200, { ok: true, role: "admin", code: ADMIN_CODE, google: { email: g.email, name: g.name } });
      const p = await findPartnerByGoogleEmail(g.email);
      if (!p) return reply(404, { error: "unknown_google", email: g.email });
      return reply(200, { ok: true, role: "partner", code: p.code, partner: publicPartner(p), google: { email: g.email, name: g.name } });
    }
    if (path === "/login/google/link" && method === "POST") {
      const g = await verifyGoogle(clean(data.credential, 4000));
      if (!g) return reply(401, { error: "bad_google" });
      const p = await getPartner(code);
      if (!p) return reply(401, { error: "bad_code" });
      const emails = splitEmails(p.google_emails);
      if (!emails.includes(g.email)) { emails.push(g.email); await updateFields(T_PARTNERS, { code: S(p.code) }, { google_emails: emails.join(",") }); p.google_emails = emails.join(","); }
      await telegram(`Portail TSS — ${p.name} a lié le compte Google ${g.email}`, p);
      return reply(200, { ok: true, role: "partner", code: p.code, partner: publicPartner(p), google: { email: g.email, name: g.name } });
    }

    /* ----- Admin : vue globale ----- */
    if (path === "/admin/state" && method === "GET") {
      if (!isAdmin) return reply(401, { error: "bad_code" });
      const partners = await listPartners();
      const out = [];
      for (const p of partners) {
        const members = await listMembers(p.code);
        out.push({ ...publicPartner(p), active: p.active !== "non", resume: summary(members, null, true), members: members.map((m) => publicMember(m, true)) });
      }
      return reply(200, { ok: true, partners: out, prix: PRIX });
    }
    if (path === "/admin/partner" && method === "POST") {
      if (!isAdmin) return reply(401, { error: "bad_code" });
      const name = clean(data.name, 120);
      if (!name) return reply(400, { error: "missing_name" });
      let pcode = makeCode(name);
      while (await getPartner(pcode)) pcode = makeCode(name);
      const item = {
        code: pcode, name, type: ["association", "entreprise"].includes(data.type) ? data.type : "entreprise",
        contact_name: clean(data.contact_name, 120), contact_email: clean(data.contact_email, 160),
        contact_phone: clean(data.contact_phone, 40), billing_email: clean(data.billing_email || data.contact_email, 160),
        stripe_customer_id: clean(data.stripe_customer_id, 80), stripe_subscription_id: clean(data.stripe_subscription_id, 80),
        bank_code: clean(data.bank_code, 40) || (name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) + "-SANTE"),
        demo: data.demo === "oui" ? "oui" : "non", google_emails: splitEmails(data.google_emails).join(","),
        active: "oui", created_at: now(),
      };
      await putItem(T_PARTNERS, item);
      return reply(200, { ok: true, partner: publicPartner(item) });
    }
    if (path === "/admin/partner/update" && method === "POST") {
      if (!isAdmin) return reply(401, { error: "bad_code" });
      const p = await getPartner(clean(data.partner_code, 60));
      if (!p) return reply(404, { error: "unknown_partner" });
      const fields = {};
      for (const k of ["name", "contact_name", "contact_email", "contact_phone", "billing_email", "stripe_customer_id", "stripe_subscription_id", "active", "type", "bank_code", "demo", "google_emails"]) {
        if (data[k] !== undefined) fields[k] = k === "google_emails" ? splitEmails(data[k]).join(",").slice(0, 1000) : clean(data[k], 160);
      }
      if (!Object.keys(fields).length) return reply(400, { error: "nothing_to_update" });
      await updateFields(T_PARTNERS, { code: S(p.code) }, fields);
      return reply(200, { ok: true });
    }
    // Activer la facturation : client Stripe + abonnement mensuel payé par facture (30 jours), quantité = actifs.
    if (path === "/admin/billing/activate" && method === "POST") {
      if (!isAdmin) return reply(401, { error: "bad_code" });
      const p = await getPartner(clean(data.partner_code, 60));
      if (!p) return reply(404, { error: "unknown_partner" });
      if (p.stripe_subscription_id) return reply(400, { error: "already_active" });
      if (!STRIPE_PRICE) return reply(500, { error: "no_price_configured" });
      const members = await listMembers(p.code);
      const actifs = members.filter((m) => m.status === "actif").length;
      if (actifs < 1) return reply(400, { error: "no_active_members" });
      let customerId = p.stripe_customer_id;
      if (!customerId) {
        const c = await stripe("POST", "/v1/customers", {
          name: p.name, email: p.billing_email || p.contact_email || "",
          description: `Truck Stop Santé — ${p.type} — portail ${p.code}`,
          "metadata[portail_code]": p.code,
        });
        customerId = c.id;
      }
      const sub = await stripe("POST", "/v1/subscriptions", {
        customer: customerId,
        "items[0][price]": STRIPE_PRICE, "items[0][quantity]": String(actifs),
        collection_method: "send_invoice", days_until_due: "30",
        "metadata[portail_code]": p.code, "metadata[channel]": "portail-partenaire",
        description: `Truck Stop Santé — ${p.name} — personnes couvertes x ${PRIX} $/mois`,
      });
      await updateFields(T_PARTNERS, { code: S(p.code) }, { stripe_customer_id: customerId, stripe_subscription_id: sub.id });
      return reply(200, { ok: true, customer: customerId, subscription: sub.id, quantite: actifs });
    }
    if (path === "/admin/member/delete" && method === "POST") {
      if (!isAdmin) return reply(401, { error: "bad_code" });
      const pcode = clean(data.partner_code, 60), id = clean(data.id, 80);
      const m = await getMember(pcode, id);
      if (!m) return reply(404, { error: "unknown_member" });
      await db.send(new DeleteItemCommand({ TableName: T_MEMBERS, Key: { partner_code: S(pcode), id: S(id) } }));
      return reply(200, { ok: true, deleted: id });
    }
    if (path === "/admin/member/spruce" && method === "POST") {
      if (!isAdmin) return reply(401, { error: "bad_code" });
      const pcode = clean(data.partner_code, 60), id = clean(data.id, 80);
      const m = await getMember(pcode, id);
      if (!m) return reply(404, { error: "unknown_member" });
      if (data.action === "inviter") {
        const r = await spruceInvite(m);
        const fields = { spruce: r.statut === "erreur" ? "a_inviter" : r.statut, spruce_detail: r.detail, updated_at: now() };
        if (r.statut === "invite") fields.spruce_invited_at = now();
        await updateFields(T_MEMBERS, { partner_code: S(pcode), id: S(id) }, fields);
        return reply(200, { ok: true, spruce: r });
      }
      const spruce_ = ["a_inviter", "invite", "compte"].includes(data.spruce) ? data.spruce : "a_inviter";
      await updateFields(T_MEMBERS, { partner_code: S(pcode), id: S(id) }, { spruce: spruce_, updated_at: now() });
      return reply(200, { ok: true });
    }

    /* ----- Partenaire (ou admin qui regarde un partenaire) ----- */
    let partner = null;
    if (isAdmin && (data.partner_code || q.partner_code)) partner = await getPartner(clean(data.partner_code || q.partner_code, 60));
    else if (!isAdmin) partner = await getPartner(code);
    if (!partner) return reply(401, { error: "bad_code" });

    if (path === "/state" && method === "GET") {
      const members = await listMembers(partner.code);
      const billing = await billingInfo(partner);
      return reply(200, {
        ok: true, partner: publicPartner(partner), members: members.map(publicMember),
        resume: summary(members, billing), facturation: billing,
      });
    }

    if (path === "/billing/portal" && method === "POST") {
      const url = await stripePortalLink(partner);
      if (!url) return reply(400, { error: "no_stripe_customer" });
      return reply(200, { ok: true, url });
    }

    if (path === "/member" && method === "POST") {
      const members = await listMembers(partner.code);
      const r = await addMember(partner, data, members);
      if (!r.ok) return reply(r.error === "duplicate" ? 409 : 400, r);
      const actifs = members.filter((m) => m.status === "actif").length;
      let stripeSync = null;
      try { stripeSync = await syncStripeQuantity(partner, actifs); } catch (e) { stripeSync = { synced: false, reason: e.message }; }
      const m = r.member;
      await telegram(`Portail TSS — ${partner.name} a ajouté ${m.first_name} ${m.last_name}\n${m.phone} · ${m.email}${m.family_of ? "\n(famille de " + m.family_of + ")" : ""}\nSpruce : ${m.spruce} (${m.spruce_detail || "à faire"})\nActifs : ${actifs} → ${actifs * PRIX} $/mois`, partner);
      return reply(200, { ok: true, member: m, actifs, stripe: stripeSync });
    }

    // Ajout en lot : la liste collée sur le portail (max 200 personnes par envoi)
    if (path === "/members/bulk" && method === "POST") {
      const rows = Array.isArray(data.members) ? data.members.slice(0, 200) : [];
      if (!rows.length) return reply(400, { error: "no_members" });
      const members = await listMembers(partner.code);
      const results = [];
      for (const row of rows) results.push(await addMember(partner, row, members));
      const actifs = members.filter((m) => m.status === "actif").length;
      let stripeSync = null;
      try { stripeSync = await syncStripeQuantity(partner, actifs); } catch (e) { stripeSync = { synced: false, reason: e.message }; }
      const added = results.filter((r) => r.ok);
      const invited = added.filter((r) => r.member.spruce === "invite").length;
      const already = added.filter((r) => r.member.spruce === "compte").length;
      const failed = results.length - added.length;
      await telegram(`Portail TSS — ${partner.name} a ajouté ${added.length} personne(s) (liste collée)\nInvitations Spruce envoyées : ${invited} · déjà sur Spruce : ${already} · rejetées : ${failed}\nActifs : ${actifs} → ${actifs * PRIX} $/mois`, partner);
      return reply(200, { ok: true, results, actifs, stripe: stripeSync, resume: { added: added.length, failed } });
    }

    if (path === "/member/status" && method === "POST") {
      const id = clean(data.id, 80);
      const status = ["actif", "pause", "retire"].includes(data.status) ? data.status : null;
      if (!id || !status) return reply(400, { error: "bad_request" });
      const m = await getMember(partner.code, id);
      if (!m) return reply(404, { error: "unknown_member" });
      if (m.status === status) return reply(200, { ok: true, unchanged: true });
      const fields = { status, updated_at: now() };
      if (status === "pause") fields.paused_at = now();
      if (status === "retire") fields.removed_at = now();
      if (status === "actif") { fields.paused_at = ""; fields.removed_at = ""; }
      await updateFields(T_MEMBERS, { partner_code: S(partner.code), id: S(id) }, fields);
      const members = await listMembers(partner.code);
      const actifs = members.filter((x) => x.status === "actif").length;
      let stripeSync = null;
      try { stripeSync = await syncStripeQuantity(partner, actifs); } catch (e) { stripeSync = { synced: false, reason: e.message }; }
      const verbe = status === "actif" ? "a réactivé" : status === "pause" ? "a mis en pause" : "a retiré";
      await telegram(`Portail TSS — ${partner.name} ${verbe} ${m.first_name} ${m.last_name}. Actifs : ${actifs} → ${actifs * PRIX} $/mois`, partner);
      return reply(200, { ok: true, status, actifs, stripe: stripeSync });
    }

    if (path === "/member/update" && method === "POST") {
      const id = clean(data.id, 80);
      const m = await getMember(partner.code, id);
      if (!m) return reply(404, { error: "unknown_member" });
      const fields = { updated_at: now() };
      if (data.first_name !== undefined) fields.first_name = clean(data.first_name, 80);
      if (data.last_name !== undefined) fields.last_name = clean(data.last_name, 80);
      if (data.phone !== undefined) { if (!validPhone(clean(data.phone, 40))) return reply(400, { error: "bad_phone" }); fields.phone = clean(data.phone, 40); }
      if (data.email !== undefined) { if (!validEmail(clean(data.email, 160))) return reply(400, { error: "bad_email" }); fields.email = clean(data.email, 160).toLowerCase(); }
      if (data.note !== undefined) fields.note = clean(data.note, 300);
      if (data.family_of !== undefined) fields.family_of = clean(data.family_of, 80);
      if (data.since_months !== undefined) fields.since_months = String(Math.max(0, Math.min(600, parseInt(data.since_months, 10) || 0)));
      if (data.coverage !== undefined) fields.coverage = COVERAGES.includes(String(data.coverage)) ? String(data.coverage) : "indeterminee";
      await updateFields(T_MEMBERS, { partner_code: S(partner.code), id: S(id) }, fields);
      return reply(200, { ok: true });
    }

    return reply(404, { error: "not_found" });
  } catch (e) {
    console.error(e);
    return reply(500, { error: "server_error", detail: e.message });
  }
};
