// Audit 2026-09-03 — corrections de contenu et de portail (voir le rapport d'audit sur le bus privé).
// (1) plus aucune promesse de délai (« dans les 24 heures ») ; (2) FAQ : « Comment ça démarre? » passe par le portail,
// réponse solo au « vous », trois questions ajoutées (facturation, banque de consultations, confidentialité) ;
// (3) note des paliers alignée sur le vrai flux (code généré par la personne couverte, proche écrit sur Spruce) ;
// (4) portail : plus de m28.ca, plus de « texto » marketing, repli si le script Google ne charge pas, mobile.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const write = (f, s) => fs.writeFileSync(path.join(ROOT, f), s);
const log = [];
function sub(s, from, to, label, file) { if (to.includes(from) && s.includes(to)) { log.push("skip  " + file + " : " + label); return s; } if (!s.includes(from)) { log.push((s.includes(to) ? "skip  " : "MISS  ") + file + " : " + label); return s; } log.push("ok    " + file + " : " + label); return s.split(from).join(to); }
// Remplace un bloc bilingue : attribut data-fr, attribut data-en et texte visible (= FR).
function tri(s, file, label, fr, en, frNew, enNew) {
  s = sub(s, 'data-fr="' + fr + '"', 'data-fr="' + frNew + '"', label + " (fr)", file);
  s = sub(s, 'data-en="' + en + '"', 'data-en="' + enNew + '"', label + " (en)", file);
  s = sub(s, '">' + fr + "<", '">' + frNew + "<", label + " (texte)", file);
  return s;
}

/* ---------- pages flottes : index + tsq ---------- */
const SOLO_FR = "Oui. C’est un service aux entreprises : ton entreprise (ou toi, comme travailleur autonome) s’abonne pour une personne à 8 $/mois. Tu cliques sur M’abonner, tu entres le nom de l’entreprise, ton nom et ton cellulaire, et tu reçois ton invitation Spruce dans les 24 heures. Lien direct : truckstopsante.com/solo";
const SOLO_EN = "Yes. This is a business service: your company (or you, as a self-employed worker) subscribes for one person at $8/month. Click Subscribe, enter the company name, your name and your cell number, and you receive your Spruce invitation within 24 hours. Direct link: truckstopsante.com/solo";
const SOLO_FR2 = "Oui. C’est un service aux entreprises : votre entreprise (ou vous, comme travailleur autonome) s’abonne pour une personne à 8 $/mois. Cliquez sur M’abonner, entrez le nom de l’entreprise, votre nom et votre cellulaire, et vous recevez votre invitation Spruce. Lien direct : truckstopsante.com/solo";
const SOLO_EN2 = "Yes. This is a business service: your company (or you, as a self-employed worker) subscribes for one person at $8/month. Click Subscribe, enter the company name, your name and your cell number, and you receive your Spruce invitation. Direct link: truckstopsante.com/solo";
const START_FR = "Vous vous inscrivez, vous envoyez votre liste d’employés à cff@centremedicalfont.ca, et vos employés reçoivent leur invitation Spruce. C’est tout.";
const START_EN = "You sign up, you send your employee list to cff@centremedicalfont.ca, and your employees receive their Spruce invitation. That’s it.";
const START_FR2 = "Vous vous inscrivez, puis vous ajoutez vos employés dans votre portail entreprise (truckstopsante.com/portail) — ou vous envoyez simplement votre liste à cff@centremedicalfont.ca. Chaque employé reçoit son invitation Spruce. C’est tout.";
const START_EN2 = "You sign up, then you add your employees in your company portal (truckstopsante.com/portail) — or simply send your list to cff@centremedicalfont.ca. Each employee receives their Spruce invitation. That’s it.";
const NOTE_FR = "Comment ça marche : vous recevez un code. La personne nous écrit avec le code, par texto ou par courriel, et chaque consultation est déduite de la banque, jusqu’à zéro. Quelqu’un qui a besoin de 5 consultations dans le mois en utilise 5. Les membres de la famille peuvent s’en servir sans s’abonner. Les consultations non utilisées s’accumulent de mois en mois.";
const NOTE_EN = "How it works: you receive a code. The person writes to us with the code, by text or email, and each consultation is deducted from the bank, down to zero. Someone who needs 5 consultations in a month uses 5. Family members can use it without subscribing. Unused consultations carry over month to month.";
const NOTE_FR2 = "Comment ça marche : la personne couverte génère un code dans son espace membre et l’envoie à son proche. Le proche écrit au médecin sur Spruce avec ce code, et chaque consultation est déduite de la banque, jusqu’à zéro. Quelqu’un qui a besoin de 5 consultations dans le mois en utilise 5. Les membres de la famille peuvent s’en servir sans s’abonner. Les consultations non utilisées s’accumulent de mois en mois.";
const NOTE_EN2 = "How it works: the covered person generates a code in their member space and sends it to their relative. The relative writes to the doctor on Spruce with that code, and each consultation is deducted from the bank, down to zero. Someone who needs 5 consultations in a month uses 5. Family members can use it without subscribing. Unused consultations carry over month to month.";
const faq = (fr, en, afr, aen) => `
                <details>
                    <summary><span data-fr="${fr}" data-en="${en}">${fr}</span></summary>
                    <div class="faq-answer" data-fr="${afr}" data-en="${aen}">${afr}</div>
                </details>`;
const NEW_FAQ = faq(
  "Comment fonctionne la facturation?", "How does billing work?",
  "8 $ par personne couverte, par mois, facturés à l’entreprise par Stripe. Vous ajoutez, mettez en pause ou retirez des personnes dans votre portail entreprise; la facture du mois suivant suit le nombre de personnes couvertes. Une personne en pause garde sa couverture 90 jours sans facturation. Sans engagement.",
  "$8 per covered person, per month, billed to the company through Stripe. You add, pause or remove people in your company portal; the next month’s invoice follows the number of covered people. A paused person keeps their coverage for 90 days without billing. No commitment."
) + faq(
  "Qu’est-ce que la banque de consultations gratuites?", "What is the bank of free consultations?",
  "À chaque tranche de 100 personnes couvertes, votre entreprise reçoit 5 consultations gratuites par mois, et elles s’accumulent. Une personne couverte génère un code dans son espace membre et l’envoie à un proche : un code = une consultation avec le médecin, sans abonnement. La banque ne baisse que lorsque le médecin utilise le code. Vous voyez le solde, jamais qui a consulté.",
  "For every 100 covered people, your company receives 5 free consultations a month, and they accumulate. A covered person generates a code in their member space and sends it to a relative: one code = one consultation with the doctor, no subscription. The bank only goes down when the doctor uses the code. You see the balance, never who consulted."
) + faq(
  "Que voit l’employeur?", "What does the employer see?",
  "Le nombre de personnes couvertes et la facture. Jamais qui a consulté, ni pourquoi. Les documents (arrêt de travail, attestation, formulaire) sont remis au chauffeur, qui décide lui-même de ce qu’il transmet à son employeur. Confidentialité conforme à la Loi 25.",
  "The number of covered people and the invoice. Never who consulted, or why. Documents (sick leave, attestation, form) are given to the driver, who decides what to pass on to their employer. Confidentiality compliant with Quebec’s Law 25."
);
for (const f of ["index.html", "tsq/index.html"]) {
  let s = read(f);
  s = tri(s, f, "FAQ solo sans délai, au vous", SOLO_FR, SOLO_EN, SOLO_FR2, SOLO_EN2);
  s = tri(s, f, "FAQ comment ça démarre (portail)", START_FR, START_EN, START_FR2, START_EN2);
  s = tri(s, f, "note des paliers", NOTE_FR, NOTE_EN, NOTE_FR2, NOTE_EN2);
  if (!s.includes("Comment fonctionne la facturation?")) {
    const anchor = "Offrez-vous des examens de préembauche?";
    const i = s.indexOf(anchor); const end = s.indexOf("</details>", i) + "</details>".length;
    if (i > 0) { s = s.slice(0, end) + NEW_FAQ + s.slice(end); log.push("ok    " + f + " : 3 questions FAQ ajoutées"); } else log.push("MISS  " + f + " : ancre FAQ");
  } else log.push("skip  " + f + " : FAQ déjà ajoutée");
  write(f, s);
}
/* ---------- pages équipes : hedhofis + entreprises ---------- */
for (const f of ["hedhofis/index.html", "entreprises/index.html"]) {
  let s = read(f);
  s = tri(s, f, "note des paliers", NOTE_FR, NOTE_EN, NOTE_FR2, NOTE_EN2);
  s = sub(s, 'alt="Avis Google — Centre Médical M28"', 'alt="Avis Google — Centre Médical Font"', "alt avis Google sans M28", f);
  if (f.startsWith("entreprises")) {
    s = sub(s, 'data-fr="Offre aux entreprises" data-en="An offer for the community"', 'data-fr="Offre aux entreprises" data-en="An offer for businesses"', "eyebrow EN", f);
    s = sub(s, "subject=Inscription%20-%20Acces%20Medecin%20()", "subject=Inscription%20-%20Acces%20Medecin", "mailto sujet vide", f);
    s = sub(s, 'subject=Acces%20Medecin%20-%20"', 'subject=Acces%20Medecin%20-%20Entreprises"', "mailto sujet tronqué", f);
  }
  write(f, s);
}
/* ---------- solo ---------- */
{
  const f = "solo/index.html"; let s = read(f);
  s = sub(s, "<strong>Tu reçois ton invitation Spruce par texto dans les 24 heures</strong>", "<strong>Tu reçois ton invitation Spruce sur ton cellulaire</strong>", "étape 3 sans délai", f);
  write(f, s);
}
/* ---------- portail ---------- */
const GSI_FALLBACK = (msgExpr, extra) => `sc.onerror = function () { ${msgExpr}.textContent = "La connexion Google n’a pas pu se charger. Vérifiez votre connexion ou désactivez le bloqueur de publicité, puis rechargez la page.${extra || ""}"; };\n            `;
{
  const f = "portail/membre.html"; let s = read(f);
  s = sub(s, " (ou passe par m28.ca)", "", "m28 retiré", f);
  s = sub(s, '". Votre médecin est à un texto : " + "spruce.care/centremdicalfont"', '". Votre médecin est sur Spruce : spruce.care/centremdicalfont"', "texto → Spruce", f);
  s = sub(s, '            document.head.appendChild(sc);\n        } else {', "            " + GSI_FALLBACK("msg") + "document.head.appendChild(sc);\n        } else {", "repli script Google", f);
  write(f, s);
}
{
  const f = "portail/index.html"; let s = read(f);
  s = sub(s, "            document.head.appendChild(sc);\n        }\n    })();", "            " + GSI_FALLBACK("msg", " Votre code d’accès fonctionne quand même.") + "document.head.appendChild(sc);\n        }\n    })();", "repli script Google", f);
  write(f, s);
}
{
  const f = "cmf/index.html"; let s = read(f);
  s = sub(s, "            document.head.appendChild(sc);\n        }\n        load();", "            " + GSI_FALLBACK("msg", " Le code administrateur fonctionne quand même.") + "document.head.appendChild(sc);\n        }\n        load();", "repli script Google", f);
  write(f, s);
}
{
  const f = "portail/admin.html"; let s = read(f);
  s = sub(s, "Le proche arrive avec son code (Spruce, m28.ca) :", "Le proche arrive avec son code (sur Spruce) :", "m28 retiré", f);
  write(f, s);
}
{
  const f = "portail/medecin.html"; let s = read(f);
  s = sub(s, "Le proche arrive avec son code de consultation (Spruce ou m28.ca).", "Le proche arrive avec son code de consultation, sur Spruce.", "m28 retiré", f);
  write(f, s);
}
{
  const f = "portail/ajouter.html"; let s = read(f);
  s = sub(s, "cellulaire (qui reçoit les textos)", "cellulaire (qui reçoit l’invitation Spruce)", "textos → invitation Spruce", f);
  s = sub(s, "<th>Cellulaire (texto)</th>", "<th>Cellulaire</th>", "en-tête cellulaire", f);
  write(f, s);
}
{
  const f = "portail/tableau.html"; let s = read(f);
  s = sub(s, 'colspan="8"', 'colspan="7"', "colspan = 7 colonnes", f);
  write(f, s);
}
{
  const f = "portail/portail.css"; let s = read(f);
  const CSS = `
/* --- mobile (audit 2026-09-03) --- */
@media (max-width: 900px) {
  .grid { grid-template-columns: 1fr 1fr; }
  main { padding: 20px 14px 40px; }
  header.top { padding: 12px 16px; }
  .login { padding: 28px 20px; }
  form.new { grid-template-columns: 1fr; }
}
@media (max-width: 760px) {
  .card { overflow-x: auto; }
  .card table { min-width: 640px; }
  .hint, .sub, .fine { overflow-wrap: anywhere; }
  h1 { font-size: 1.8rem; }
}
@media (max-width: 520px) {
  .grid { grid-template-columns: 1fr; }
  .row .btn { width: 100%; justify-content: center; }
}
`;
  if (!s.includes("mobile (audit 2026-09-03)")) { s = s.trimEnd() + "\n" + CSS; log.push("ok    " + f + " : media queries ajoutées"); } else log.push("skip  " + f + " : media queries déjà là");
  write(f, s);
}
console.log(log.join("\n"));
if (log.some((l) => l.startsWith("MISS"))) process.exitCode = 1;
