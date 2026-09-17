// Rattrapage des étiquettes Spruce des membres Truck Stop Santé.
// Chaque personne couverte doit porter deux étiquettes sur Spruce : TSQ_membership + le nom de son entreprise.
// Le portail (lambda/index.mjs, tagSpruceContact) les pose automatiquement à chaque invitation ;
// ce script vérifie TOUT le monde (abonnés Stripe + personnes actives des partenaires du portail) et corrige.
//
//   node sync-spruce-tags.mjs          -> applique les étiquettes et affiche le résultat par personne
//   node sync-spruce-tags.mjs --dry    -> affiche seulement ce qui serait fait
//
// Clés : ~/.claude/.env (STRIPE_SECRET_KEY, HEALTHYPLAN_AWS_*) et l'authentification Spruce de ~/spruce-invite-today.js.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const HOME = "C:/Users/Carlos Faviel Font";
const DRY = process.argv.includes("--dry");
const STRIPE_PRICE_ID = "price_1TuXuRKyyCqeElTHUDNlr3KS"; // Truck Stop Santé — 8 $ CAD / mois / personne
const MEMBERSHIP_TAG = "TSQ_membership";
// Même entreprise écrite autrement au paiement.
const COMPANY_ALIASES = { cftc: "Centre de formation en Transport de Charlesbourg" };

const env = {};
for (const line of readFileSync(HOME + "/.claude/.env", "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ""); }
process.env.AWS_ACCESS_KEY_ID = env.HEALTHYPLAN_AWS_ACCESS_KEY_ID;
process.env.AWS_SECRET_ACCESS_KEY = env.HEALTHYPLAN_AWS_SECRET_ACCESS_KEY;
const SPRUCE_AUTH = (readFileSync(HOME + "/spruce-invite-today.js", "utf8").match(/SPRUCE_AUTH = "([^"]+)"/) || [])[1];
if (!env.STRIPE_SECRET_KEY || !SPRUCE_AUTH || !env.HEALTHYPLAN_AWS_ACCESS_KEY_ID) throw new Error("clé manquante (Stripe, Spruce ou AWS)");

const req = createRequire(import.meta.url);
const { DynamoDBClient, ScanCommand } = req("@aws-sdk/client-dynamodb");
const db = new DynamoDBClient({ region: "ca-central-1" });

const clean = (v) => String(v ?? "").trim();
const digits = (p) => String(p || "").replace(/\D/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Nom d'entreprise -> étiquette. Rien si le « nom d'entreprise » est le nom de la personne (payeur solo).
function companyTag(company, personName) {
  let c = clean(company);
  if (!c) return "";
  if (clean(personName).toLowerCase().includes(c.toLowerCase())) return "";
  c = COMPANY_ALIASES[c.toLowerCase()] || c;
  return c.replace(/\s+/g, "_");
}

async function stripeGet(path) {
  const r = await fetch("https://api.stripe.com" + path, { headers: { Authorization: "Bearer " + env.STRIPE_SECRET_KEY } });
  const j = await r.json();
  if (j.error) throw new Error("stripe: " + j.error.message);
  return j;
}
async function spruce(method, path, body) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch("https://api.sprucehealth.com" + path, {
      method, headers: { Authorization: SPRUCE_AUTH, Accept: "application/json", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 429 && attempt < 3) { await sleep(15000); continue; }
    let b = {}; try { b = await r.json(); } catch { b = {}; }
    return { s: r.status, b };
  }
}
async function scan(table) {
  let items = [], key;
  do { const r = await db.send(new ScanCommand({ TableName: table, ExclusiveStartKey: key })); items = items.concat(r.Items || []); key = r.LastEvaluatedKey; } while (key);
  return items;
}

/* 1. Qui doit être étiqueté */
const people = new Map(); // courriel (ou téléphone) -> { name, email, phone, tags:Set, sources:[] }
function addPerson({ name, email, phone, company, source, usePhone }) {
  const key = clean(email).toLowerCase() || digits(phone).slice(-10);
  if (!key) return;
  const p = people.get(key) || { name: clean(name), email: clean(email).toLowerCase(), phone: "", usePhone: false, companies: new Set(), sources: [] };
  if (usePhone && phone) { p.phone = digits(phone).slice(-10); p.usePhone = true; }
  const tag = companyTag(company, name);
  if (tag) p.companies.add(tag);
  p.sources.push(source);
  people.set(key, p);
}

const partners = (await scan("tss-portail-partenaires")).map((i) => Object.fromEntries(Object.entries(i).map(([k, v]) => [k, v.S ?? v.N ?? ""])));
const members = (await scan("tss-portail-membres")).map((i) => Object.fromEntries(Object.entries(i).map(([k, v]) => [k, v.S ?? v.N ?? ""])));
const realPartners = partners.filter((p) => p.demo !== "oui" && p.active !== "non" && p.type !== "medecin");

// Portail : personnes actives des partenaires réels.
for (const p of realPartners) {
  for (const m of members.filter((x) => x.partner_code === p.code && x.status === "actif" && !String(x.id).startsWith("code#") && x.kind !== "identity_lock")) {
    // Étiquette entreprise du portail : spruce_tag || nom, sauf si c'est le nom du payeur.
    const company = companyTag(p.spruce_tag || p.name, p.contact_name) ? (p.spruce_tag || p.name) : "";
    addPerson({ name: `${m.first_name} ${m.last_name}`, email: m.email, phone: m.phone, company, source: "portail:" + p.name, usePhone: true });
  }
}

// Stripe : abonnements actifs Truck Stop Santé.
const noPartner = [];
let startingAfter = "";
for (;;) {
  const page = await stripeGet("/v1/subscriptions?status=active&price=" + STRIPE_PRICE_ID + "&limit=100" + (startingAfter ? "&starting_after=" + startingAfter : ""));
  for (const sub of page.data) {
    const sessions = await stripeGet("/v1/checkout/sessions?subscription=" + sub.id + "&limit=1");
    const s = sessions.data[0];
    let name = s?.customer_details?.name, email = s?.customer_details?.email, phone = s?.customer_details?.phone;
    if (!email) { const c = await stripeGet("/v1/customers/" + sub.customer); name = name || c.name; email = c.email; phone = phone || c.phone; }
    const fields = Object.fromEntries((s?.custom_fields || []).map((f) => [f.key, (f.text || f.dropdown || f.numeric || {}).value || ""]));
    const partner = partners.find((p) => p.stripe_subscription_id === sub.id);
    const company = partner ? (companyTag(partner.spruce_tag || partner.name, partner.contact_name) ? (partner.spruce_tag || partner.name) : "") : fields.entreprise;
    addPerson({ name, email, phone, company, source: "stripe:" + sub.id });
    if (!partner) noPartner.push({ name, email, entreprise: fields.entreprise || "", sub: sub.id, created: new Date(sub.created * 1000).toISOString().slice(0, 10), session: s?.id || "" });
  }
  if (!page.has_more) break;
  startingAfter = page.data[page.data.length - 1].id;
}

/* 2. Étiquettes Spruce */
const tagIds = {};
async function tagId(value) {
  if (tagIds[value]) return tagIds[value];
  const r = await spruce("POST", "/v1/contacts/tags", { value });
  if (![200, 201].includes(r.s) || !r.b.id) throw new Error(`étiquette « ${value} » refusée (HTTP ${r.s})`);
  return (tagIds[value] = r.b.id);
}
async function findContacts(p) {
  const hits = new Map();
  for (const q of [p.email, p.usePhone && p.phone ? "+1" + p.phone : ""].filter(Boolean)) {
    const r = await spruce("POST", "/v1/contacts/search", { freeText: q });
    if (r.s !== 200) throw new Error("recherche Spruce HTTP " + r.s);
    for (const c of r.b.contacts || []) {
      const emailOk = p.email && (c.emailAddresses || []).some((e) => clean(e.value).toLowerCase() === p.email);
      const phoneOk = p.usePhone && p.phone && (c.phoneNumbers || []).some((n) => digits(n.value || n.displayValue).endsWith(p.phone));
      if (emailOk || phoneOk) hits.set(c.id, c);
    }
  }
  return [...hits.values()];
}

let failures = 0;
console.log(`\n${people.size} personne(s) à vérifier${DRY ? " (essai, rien n'est modifié)" : ""}\n`);
for (const p of people.values()) {
  const wanted = [MEMBERSHIP_TAG, ...p.companies];
  try {
    const contacts = await findContacts(p);
    if (!contacts.length) { console.log(`- ${p.name} <${p.email}> : PAS SUR SPRUCE (voulu : ${wanted.join(", ")})`); continue; }
    for (const c of contacts) {
      const full = (await spruce("GET", "/v1/contacts/" + encodeURIComponent(c.id))).b;
      const current = (full.tags || []).map((t) => t.id);
      let now = (full.tags || []).map((t) => t.value);
      const missing = wanted.filter((v) => !now.includes(v));
      if (missing.length && !DRY) {
        const ids = [...new Set([...current, ...(await Promise.all(wanted.map(tagId)))])];
        const u = await spruce("PATCH", "/v1/contacts/" + encodeURIComponent(c.id), { tagIds: ids });
        if (u.s !== 200) throw new Error("mise à jour Spruce HTTP " + u.s);
        now = ((await spruce("GET", "/v1/contacts/" + encodeURIComponent(c.id))).b.tags || []).map((t) => t.value);
      }
      const ok = wanted.every((v) => now.includes(v));
      if (!ok && !DRY) failures++;
      const label = DRY ? (missing.length ? "À AJOUTER : " + missing.join(", ") : "déjà OK") : (missing.length ? (ok ? "ajouté" : "ÉCHEC") : "déjà OK");
      console.log(`- ${c.givenName || p.name} ${c.familyName || ""} <${p.email}> : ${label} -> étiquettes : ${now.join(", ") || "(aucune)"}`);
    }
  } catch (e) {
    failures++;
    console.log(`- ${p.name} <${p.email}> : ERREUR ${e.message}`);
  }
  await sleep(300);
}

if (noPartner.length) {
  console.log("\nAbonnés Stripe SANS partenaire dans le portail (pas de code d'accès, pas de tableau de bord) :");
  for (const n of noPartner) console.log(`- ${n.name} <${n.email}> — entreprise « ${n.entreprise} », payé le ${n.created}, ${n.sub}`);
}
console.log(failures ? `\n${failures} problème(s).` : "\nTerminé sans erreur.");
process.exitCode = failures ? 1 : 0;
