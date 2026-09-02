// Second pass (Carlos): say WHO is billed. "L'ARPQ est facturée 8 $ par personne couverte, par mois. Toi, tu ne paies rien."
const fs = require("fs"); const path = require("path");
const file = path.join(__dirname, "..", "arpq", "index.html"); let s = fs.readFileSync(file, "utf8"); let hits = 0;
function rep(re, to) { const m = s.match(re); if (!m) { console.log("MISS:", re.toString().slice(0, 80)); return; } hits += m.length; s = s.replace(re, to); }
function pair(frRe, newFr, newEn) { rep(new RegExp('data-fr="' + frRe + '" data-en="[^"]*">[^<]*<', "g"), `data-fr="${newFr}" data-en="${newEn}">${newFr}<`); }
// hero sub
pair("Inclus avec ton adhésion ARPQ\. Famille \(18 ans et plus\) : ajoutable via l’ARPQ\.", "L’ARPQ est facturée 8 $ par membre couvert, par mois. Toi, tu ne paies rien. Famille (18 ans et plus) : ajoutable via l’ARPQ.", "The ARPQ is billed $8 per covered member, per month. You pay nothing. Family (18 and over): can be added through the ARPQ.");
// inclus sub
pair("Tout est pris en charge par l’ARPQ — aucuns frais pour toi\.", "Facturé à l’ARPQ, 8 $ par personne couverte par mois — aucuns frais pour toi.", "Billed to the ARPQ, $8 per covered person per month — no cost to you.");
// tarif cards: card1 becomes 8 $ billed to ARPQ
rep(/data-fr="0 \$" data-en="\$0">0 \$<(\/[a-z]+>\s*<[^>]*data-fr=")Payé par le membre" data-en="Paid by the member">Payé par le membre</, 'data-fr="8 $" data-en="$8">8 $<$1Par personne couverte, par mois" data-en="Per covered person, per month">Par personne couverte, par mois<');
pair("Tout est pris en charge par l’ARPQ\. Tu ne paies jamais la clinique\.", "Facturé à l’ARPQ, pas à toi. Membre ou membre de la famille : chaque personne couverte compte.", "Billed to the ARPQ, not to you. Member or family member: every covered person counts.");
// card2 Illimité -> 0 $ payé par le membre
rep(/data-fr="Illimité" data-en="Unlimited">Illimité<(\/[a-z]+>\s*<[^>]*data-fr=")Consultations" data-en="Consultations">Consultations</, 'data-fr="0 $" data-en="$0">0 $<$1Payé par le membre" data-en="Paid by the member">Payé par le membre<');
pair("Autant que nécessaire\. Peu importe le nombre de consultations\.", "Tu ne paies jamais la clinique. Peu importe le nombre de consultations.", "You never pay the clinic. However many consultations you need.");
// card3 family
pair("Ajoutable via l’ARPQ, aux mêmes conditions que toi\.", "Ajoutable via l’ARPQ — 8 $ par personne couverte, facturés à l’ARPQ.", "Can be added through the ARPQ — $8 per covered person, billed to the ARPQ.");
// paragraph
rep(/L’inscription passe par l’ARPQ, qui prend en charge la couverture de ses membres : 8 \$ par personne couverte, par mois, facturés à l’association\. La clinique ne facture jamais les membres\./g, "L’inscription passe par l’ARPQ. La clinique facture l’ARPQ 8 $ par personne couverte, par mois — jamais les membres.");
rep(/Enrolment goes through the ARPQ, which covers its members: \$8 per covered person, per month, billed to the association\. The clinic never bills members\./g, "Enrolment goes through the ARPQ. The clinic bills the ARPQ $8 per covered person, per month — never the members.");
// calcul card
pair("Pris en charge par l’ARPQ\. Peu importe le nombre de consultations\.", "L’ARPQ est facturée 8 $ par mois pour toi. Peu importe le nombre de consultations.", "The ARPQ is billed $8 a month for you. However many consultations you need.");
// FAQ family
rep(/Ils sont couverts aux mêmes conditions que vous, à l’inscription ou plus tard\./g, "Chaque personne ajoutée est une personne couverte, facturée à l’ARPQ au même 8 $ par mois — à l’inscription ou plus tard.");
rep(/They are covered on the same terms as you, at enrolment or later\./g, "Each added person is a covered person, billed to the ARPQ at the same $8 a month — at enrolment or later.");
// family card
rep(/l’ARPQ peut ajouter les membres de votre famille de 18 ans et plus — aux mêmes conditions/g, "l’ARPQ peut ajouter les membres de votre famille de 18 ans et plus — 8 $ par personne couverte, facturés à l’ARPQ");
rep(/the ARPQ can add your family members aged 18 and over — on the same terms/g, "the ARPQ can add your family members aged 18 and over — $8 per covered person, billed to the ARPQ");
fs.writeFileSync(file, s); console.log("hits:", hits);
