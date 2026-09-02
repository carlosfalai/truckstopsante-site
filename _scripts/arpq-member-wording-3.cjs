// Third pass: fix the pricing card order and the hero billing line, by exact line content.
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "arpq", "index.html");
const L = fs.readFileSync(file, "utf8").split("\n");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function fix(oldFr, newFr, newEn) {
  const re = new RegExp('data-fr="' + esc(oldFr) + '" data-en="[^"]*">' + esc(oldFr) + "<");
  const i = L.findIndex((l) => re.test(l));
  if (i < 0) { console.log("MISS:", oldFr.slice(0, 50)); return; }
  L[i] = L[i].replace(re, 'data-fr="' + newFr + '" data-en="' + newEn + '">' + newFr + "<");
  console.log("ok line", i + 1, "->", newFr.slice(0, 50));
}
fix("Inclus avec ton adhésion ARPQ. Famille (18 ans et plus) : ajoutable via l’ARPQ.", "L’ARPQ est facturée 8 $ par membre couvert, par mois. Toi, tu ne paies rien. Famille (18 ans et plus) : ajoutable via l’ARPQ.", "The ARPQ is billed $8 per covered member, per month. You pay nothing. Family (18 and over): can be added through the ARPQ.");
fix("Illimité", "8 $", "$8");
fix("Payé par le membre", "Par personne couverte, par mois", "Per covered person, per month");
fix("Consultations", "Payé par le membre", "Paid by the member");
fs.writeFileSync(file, L.join("\n"));
