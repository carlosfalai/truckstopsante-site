// Generates arpq/truck-stop-sante-arpq-affiche-fr-en.pdf (Letter, 2 pages: FR then EN) from HTML via headless Chrome.
// Wording rule (Carlos 2026-09-02): the MEMBER pays nothing; the 8 $ belongs to the association. Family via the ARPQ.
// Usage: node _scripts/gen-affiche-arpq.cjs
const path = require("path");
const os = require("os");
const fs = require("fs");
const puppeteer = require(path.join(process.env.USERPROFILE, "node_modules", "puppeteer-core"));

const OUT = path.join(__dirname, "..", "arpq", "truck-stop-sante-arpq-affiche-fr-en.pdf");

const T = {
  fr: {
    kicker: "OFFRE AUX MEMBRES", org: "Association des Routiers Professionnels du Québec",
    h1: "UN MÉDECIN POUR LA ROUTE.",
    lead: "Un problème de santé qui ne peut pas attendre ? Écris au médecin quand ça te convient — du camion, d’une halte ou de la maison. Sans rendez-vous, sans salle d’attente. Télémédecine 100 % asynchrone, sur Spruce.",
    big: "0 $ pour toi", bigLabel: "L’ARPQ EST FACTURÉE 8 $ PAR MEMBRE COUVERT, PAR MOIS",
    bigSub1: "Tu ne paies jamais la clinique. Peu importe le nombre de consultations.",
    bigSub2: "Famille (18 ans et plus) : ajoutable via l’ARPQ, 8 $ par personne couverte. Français · Español · English.",
    strip: "LE TARIF — FACTURÉ À L’ARPQ, JAMAIS AU MEMBRE",
    cells: [["8 $", "PAR PERSONNE COUVERTE, PAR MOIS — FACTURÉ À L’ARPQ"], ["0 $", "PAYÉ PAR LE MEMBRE"], ["Famille", "18 ANS ET PLUS, VIA L’ARPQ"], ["90 j", "DE GRÂCE SI ÇA SE TERMINE"]],
    stripNote: "L’inscription passe par l’ARPQ. La clinique facture l’ARPQ 8 $ par personne couverte, par mois — jamais les membres. Peu importe le nombre de consultations. Couverture maintenue 90 jours après un retrait.",
    steps: [["1", "VOUS VOUS INSCRIVEZ", "L’ARPQ t’ajoute à la liste. Tu reçois ton invitation Spruce par texto."], ["2", "VOUS ÉCRIVEZ", "Décrivez votre problème quand ça vous convient. Jour, soir ou fin de semaine."], ["3", "LE MÉDECIN RÉPOND", "Évaluation, puis ordonnance envoyée directement à votre pharmacie."]],
    inclTitle: "INCLUS AVEC TON ADHÉSION",
    incl: [["Urgences mineures et dépistage", "infections, peau, reflux, diabète, thyroïde…"], ["Douleur musculosquelettique", "dos, cou, épaule, entorses…"], ["Santé mentale", "anxiété, insomnie, épuisement…"], ["Documents d’arrêt de travail (congés)", ""], ["Formulaires d’assurance", "arrêts de travail temporaires"], ["Attestations d’aptitude", ""], ["Évaluations de retour au travail", ""], ["Références vers spécialistes", ""], ["Requêtes d’imagerie", "radiographie, échographie, IRM…"], ["Prises de sang et laboratoires", ""], ["Suivis", ""], ["Partout sur la route", "si c’est faisable en télémédecine pendant tes déplacements, on le fait"]],
    family: ["FAMILLE SUR DEMANDE", "demande à l’ARPQ d’ajouter les membres de ta famille de 18 ans et plus — 8 $ par personne couverte, facturés à l’ARPQ."],
    rating: "4,4 / 5 · 183 avis Google", ratingSub: "Centre Médical Font",
    footKicker: "INSCRIPTION — MEMBRES ARPQ", footLine: "Dr Carlos Font, médecin de famille — Truck Stop Santé · Centre Médical Font — permis CMQ 16812",
    legal: "Les services assurés par la RAMQ (consultations, traitements, prescriptions, suivis) sont facturés à la RAMQ et ne font l’objet d’aucuns frais pour le membre; le forfait couvre exclusivement des services non assurés. Le service ne remplace pas la prise en charge par un médecin de famille ni les soins d’urgence — en cas d’urgence, composez le 9-1-1.",
  },
  en: {
    kicker: "AN OFFER FOR MEMBERS", org: "Association des Routiers Professionnels du Québec",
    h1: "A DOCTOR FOR THE ROAD.",
    lead: "A health problem that can’t wait? Write to the doctor whenever it suits you — from the truck, a rest stop or home. No appointment, no waiting room. 100% asynchronous telemedicine, on Spruce.",
    big: "$0 for you", bigLabel: "THE ARPQ IS BILLED $8 PER COVERED MEMBER, PER MONTH",
    bigSub1: "You never pay the clinic. However many consultations you need.",
    bigSub2: "Family (18 and over): can be added through the ARPQ, $8 per covered person. Français · Español · English.",
    strip: "THE PRICE — BILLED TO THE ARPQ, NEVER TO THE MEMBER",
    cells: [["$8", "PER COVERED PERSON, PER MONTH — BILLED TO THE ARPQ"], ["$0", "PAID BY THE MEMBER"], ["Family", "18 AND OVER, THROUGH THE ARPQ"], ["90 d", "OF GRACE IF IT ENDS"]],
    stripNote: "Enrolment goes through the ARPQ. The clinic bills the ARPQ $8 per covered person, per month — never the members. However many consultations. Coverage kept 90 days after removal.",
    steps: [["1", "YOU ENROL", "The ARPQ adds you to the list. You receive your Spruce invitation by text."], ["2", "YOU WRITE", "Describe your problem whenever it suits you. Day, evening or weekend."], ["3", "THE DOCTOR REPLIES", "Assessment, then the prescription goes straight to your pharmacy."]],
    inclTitle: "INCLUDED WITH YOUR MEMBERSHIP",
    incl: [["Minor urgent care and screening", "infections, skin, reflux, diabetes, thyroid…"], ["Musculoskeletal pain", "back, neck, shoulder, sprains…"], ["Mental health", "anxiety, insomnia, burnout…"], ["Sick-leave documentation", ""], ["Insurance forms", "temporary work stoppages"], ["Fitness-for-duty attestations", ""], ["Return-to-work evaluations", ""], ["Referrals to specialists", ""], ["Imaging requisitions", "X-ray, ultrasound, MRI…"], ["Blood work and labs", ""], ["Follow-ups", ""], ["Anywhere on the road", "if it can be done by telemedicine while you’re on the road, we do it"]],
    family: ["FAMILY ON REQUEST", "ask the ARPQ to add your family members aged 18 and over — $8 per covered person, billed to the ARPQ."],
    rating: "4.4 / 5 · 183 Google reviews", ratingSub: "Centre Médical Font",
    footKicker: "ENROLMENT — ARPQ MEMBERS", footLine: "Dr Carlos Font, family physician — Truck Stop Santé · Centre Médical Font — CMQ licence 16812",
    legal: "Services insured by the RAMQ (consultations, treatments, prescriptions, follow-ups) are billed to the RAMQ and involve no charge to the member; this plan covers exclusively uninsured services. The service does not replace enrolment with a family doctor or emergency care — in an emergency, call 9-1-1.",
  },
};

const page = (t) => `
<section class="page">
  <header class="top">
    <div><div class="brand">TRUCK STOP <span>SANTÉ</span></div><div class="kicker">${t.kicker}</div></div>
    <div class="partner"><div class="pname">ARPQ</div><div class="porg">${t.org}</div></div>
  </header>
  <div class="dash"></div>
  <main>
    <h1>${t.h1}</h1>
    <p class="lead">${t.lead}</p>
    <div class="rule"></div>
    <div class="bigrow">
      <div class="big">${t.big}</div>
      <div class="bigtxt"><div class="biglabel">${t.bigLabel}</div><div class="bigsub1">${t.bigSub1}</div><div class="bigsub2">${t.bigSub2}</div></div>
    </div>
    <div class="rule"></div>
    <div class="strip">${t.strip}</div>
    <div class="cells">${t.cells.map(([a, b]) => `<div class="cell"><div class="cv">${a}</div><div class="cl">${b}</div></div>`).join("")}</div>
    <p class="note">${t.stripNote}</p>
    <div class="steps">${t.steps.map(([n, h, d]) => `<div class="step"><div class="sn">${n}</div><div class="sh">${h}</div><div class="sd">${d}</div></div>`).join("")}</div>
    <h2>${t.inclTitle}</h2>
    <div class="incl">${t.incl.map(([h, d]) => `<div class="item"><span class="chk">✓</span><span><b>${h}</b>${d ? ` — <span class="muted">${d}</span>` : ""}</span></div>`).join("")}</div>
    <div class="family"><b>${t.family[0]}</b> — ${t.family[1]}</div>
    <div class="ratingrow"><div class="stars">★★★★★ <b>${t.rating}</b> — ${t.ratingSub}</div></div>
  </main>
  <div class="dash"></div>
  <footer>
    <div class="fk">${t.footKicker}</div>
    <div class="frow"><div class="femail">cff@centremedicalfont.ca</div><div class="furl">truckstopsante.com/arpq</div></div>
    <div class="fline">${t.footLine}</div>
    <div class="legal">${t.legal}</div>
  </footer>
</section>`;

const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  @page { size: Letter; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Barlow, Arial, sans-serif; color: #14264A; }
  .page { width: 8.5in; height: 11in; page-break-after: always; display: flex; flex-direction: column; background: #fff; }
  .top { background: #14264A; color: #fff; padding: 22px 34px 16px; display: flex; justify-content: space-between; align-items: flex-end; }
  .brand { font-family: "Barlow Condensed", Impact, sans-serif; font-weight: 700; font-size: 30px; letter-spacing: 1px; }
  .brand span { color: #F59E0B; }
  .kicker { font-size: 10px; letter-spacing: 3px; color: rgba(255,255,255,.75); margin-top: 4px; }
  .partner { text-align: right; border-left: 1px solid rgba(255,255,255,.25); padding-left: 24px; }
  .pname { font-family: "Barlow Condensed", Impact, sans-serif; font-weight: 700; font-size: 26px; letter-spacing: 6px; }
  .porg { font-size: 9px; color: rgba(255,255,255,.75); max-width: 190px; }
  .dash { height: 8px; background: repeating-linear-gradient(90deg, #F59E0B 0 28px, #14264A 28px 46px); }
  main { padding: 20px 34px 0; flex: 1; }
  h1 { font-family: "Barlow Condensed", Impact, sans-serif; font-weight: 700; font-size: 44px; margin: 0 0 8px; letter-spacing: .5px; }
  .lead { font-size: 12.5px; line-height: 1.45; color: #4b5563; margin: 0 0 14px; }
  .rule { height: 3px; background: #14264A; }
  .bigrow { display: flex; align-items: center; gap: 24px; padding: 10px 0; }
  .big { font-family: "Barlow Condensed", Impact, sans-serif; font-weight: 700; font-size: 62px; color: #F59E0B; line-height: 1; white-space: nowrap; }
  .biglabel { font-family: "Barlow Condensed", Impact, sans-serif; font-weight: 700; font-size: 18px; letter-spacing: 1px; }
  .bigsub1 { font-size: 12px; font-weight: 700; margin-top: 3px; }
  .bigsub2 { font-size: 11.5px; color: #4b5563; margin-top: 2px; }
  .strip { font-family: "Barlow Condensed", Impact, sans-serif; font-weight: 600; color: #F59E0B; font-size: 12px; letter-spacing: 3px; padding: 10px 0 6px; border-bottom: 1px solid #e5e7eb; }
  .cells { display: grid; grid-template-columns: repeat(4, 1fr); }
  .cell { padding: 10px 12px 8px 0; border-right: 1px solid #e5e7eb; margin-right: 12px; }
  .cell:last-child { border-right: 0; margin-right: 0; }
  .cv { font-family: "Barlow Condensed", Impact, sans-serif; font-weight: 700; font-size: 26px; color: #F59E0B; }
  .cl { font-family: "Barlow Condensed", Impact, sans-serif; font-weight: 700; font-size: 11px; letter-spacing: 1px; margin-top: 2px; }
  .note { font-size: 9.5px; color: #4b5563; margin: 4px 0 10px; }
  .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-bottom: 12px; }
  .step { border-top: 3px solid #F59E0B; padding-top: 6px; }
  .sn { font-family: "Barlow Condensed", Impact, sans-serif; font-weight: 700; font-size: 22px; color: #F59E0B; }
  .sh { font-family: "Barlow Condensed", Impact, sans-serif; font-weight: 700; font-size: 14px; letter-spacing: .5px; }
  .sd { font-size: 9.5px; color: #4b5563; line-height: 1.35; }
  h2 { font-family: "Barlow Condensed", Impact, sans-serif; font-weight: 700; font-size: 19px; margin: 4px 0 6px; letter-spacing: .5px; }
  .incl { display: grid; grid-template-columns: 1fr 1fr; column-gap: 26px; }
  .item { display: flex; gap: 8px; font-size: 10.5px; padding: 4px 0; border-bottom: 1px solid #e5e7eb; }
  .chk { color: #16a34a; font-weight: 700; }
  .muted { color: #6b7280; }
  .family { background: #FEF6E6; border-left: 5px solid #F59E0B; padding: 8px 10px; font-size: 10.5px; margin-top: 10px; }
  .ratingrow { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; font-size: 10.5px; }
  .stars { color: #F59E0B; } .stars b { color: #14264A; }
  footer { background: #14264A; color: #fff; padding: 14px 34px 16px; }
  .fk { font-size: 10px; letter-spacing: 3px; color: #F59E0B; margin-bottom: 4px; }
  .frow { display: flex; justify-content: space-between; align-items: baseline; }
  .femail { font-family: "Barlow Condensed", Impact, sans-serif; font-weight: 700; font-size: 26px; }
  .furl { font-family: "Barlow Condensed", Impact, sans-serif; font-weight: 700; font-size: 16px; color: #F59E0B; }
  .fline { font-size: 9.5px; margin-top: 4px; color: rgba(255,255,255,.9); }
  .legal { font-size: 7.5px; color: rgba(255,255,255,.6); margin-top: 6px; line-height: 1.35; font-style: italic; }
</style></head><body>${page(T.fr)}${page(T.en)}</body></html>`;

(async () => {
  const tmp = path.join(os.tmpdir(), "affiche-arpq.html");
  fs.writeFileSync(tmp, html);
  const b = await puppeteer.launch({ headless: "new", executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", userDataDir: path.join(os.tmpdir(), "tss-pptr-profile"), args: ["--no-first-run"] });
  const p = await b.newPage();
  await p.goto("file:///" + tmp.replace(/\\/g, "/"), { waitUntil: "networkidle0", timeout: 60000 });
  await p.evaluateHandle("document.fonts.ready");
  await p.pdf({ path: OUT, format: "Letter", printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await b.close();
  console.log("wrote", OUT, fs.statSync(OUT).size, "bytes");
})().catch((e) => { console.error(e); process.exit(1); });
