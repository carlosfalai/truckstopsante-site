// One-off: make /arpq speak to the MEMBER (who pays nothing) and keep the 8 $ for the association only.
// Carlos, 2026-09-02: "I can't tell people 8$/month and say they don't pay, then say you pay for family members."
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "arpq", "index.html");
let s = fs.readFileSync(file, "utf8");
const before = s;
let hits = 0;
function rep(re, to) {
  const m = s.match(re);
  if (!m) { console.log("MISS:", re.toString().slice(0, 90)); return; }
  hits += m.length;
  s = s.replace(re, to);
}
// text element with data-fr/data-en and plain inner text
function pair(frPrefixRe, newFr, newEn) {
  rep(new RegExp('data-fr="' + frPrefixRe + '[^"]*" data-en="[^"]*">[^<]*<', "g"), `data-fr="${newFr}" data-en="${newEn}">${newFr}<`);
}

// title + meta descriptions
rep(/<title>[^<]*<\/title>/, "<title>Truck Stop Santé × ARPQ | Un médecin pour la route, inclus avec ton adhésion</title>");
rep(/8 \$\/mois par membre; famille \(18 ans et plus\) sur demande, au même tarif par personne\. Tarif fixe, peu importe le nombre de consultations\./g, "inclus avec l’adhésion ARPQ, aucuns frais pour le membre; famille (18 ans et plus) ajoutable via l’ARPQ.");
rep(/\$8\/month per member; family \(18 and over\) on request, at the same per-person rate\. Fixed price, however many consultations\./g, "included with ARPQ membership, no cost to the member; family (18 and over) can be added through the ARPQ.");

// hero
pair("8 \\$/mois", "0 $ pour toi", "$0 for you");
pair("par membre\\. Famille \\(18 ans et plus\\) : au même tarif, par personne\\.", "Inclus avec ton adhésion ARPQ. Famille (18 ans et plus) : ajoutable via l’ARPQ.", "Included with your ARPQ membership. Family (18 and over): can be added through the ARPQ.");

// inclus
pair("Inclus dans le 8 \\$/mois", "Inclus avec ton adhésion", "Included with your membership");
pair("Un montant fixe, par membre, par mois — sans frais additionnels\\.", "Tout est pris en charge par l’ARPQ — aucuns frais pour toi.", "Everything is covered by the ARPQ — no cost to you.");
rep(/À votre demande, les membres de votre famille de 18 ans et plus peuvent être ajoutés — au même tarif par personne/g, "À votre demande, l’ARPQ peut ajouter les membres de votre famille de 18 ans et plus — aux mêmes conditions");
rep(/At your request, family members aged 18 and over can be added — at the same per-person rate/g, "At your request, the ARPQ can add your family members aged 18 and over — on the same terms");

// tarif section
pair("Un tarif fixe\\. Pas de surprise\\.", "Zéro frais pour le membre.", "Zero cost for the member.");
pair("Par personne, par mois", "Payé par le membre", "Paid by the member");
pair("Membre ou membre de la famille \\(18 ans et plus\\) — chaque personne couverte compte une place\\.", "Tout est pris en charge par l’ARPQ. Tu ne paies jamais la clinique.", "Everything is covered by the ARPQ. You never pay the clinic.");
rep(/data-fr="8 \$" data-en="\$8">8 \$</g, 'data-fr="0 $" data-en="$0">0 $<');
pair("Payé par le membre à la clinique", "Consultations", "Consultations");
pair("La couverture passe par l’ARPQ — le membre ne paie jamais la clinique directement\\.", "Autant que nécessaire. Peu importe le nombre de consultations.", "As many as you need. However many consultations.");
rep(/data-fr="0 \$" data-en="\$0">0 \$</, 'data-fr="Illimité" data-en="Unlimited">Illimité<');
rep(/data-fr="96 \$" data-en="\$96">96 \$<(\/[a-z]+>\s*<[^>]*data-fr=")Par année, au maximum" data-en="[^"]*">Par année, au maximum</, 'data-fr="Famille" data-en="Family">Famille<$1Dix-huit ans et plus" data-en="Eighteen and over">Dix-huit ans et plus<');
pair("Peu importe le nombre de consultations\\.\" data-en=\"However many consultations you need\\.\">Peu importe le nombre de consultations\\.<", "x", "x"); // placeholder no-op guard
rep(/data-fr="Peu importe le nombre de consultations\." data-en="However many consultations you need\.">Peu importe le nombre de consultations\.</, 'data-fr="Ajoutable via l’ARPQ, aux mêmes conditions que toi." data-en="Can be added through the ARPQ, on the same terms as you.">Ajoutable via l’ARPQ, aux mêmes conditions que toi.<');
rep(/<p([^>]*)data-fr="Le tarif ne change[\s\S]*?<\/p>/, '<p$1data-fr="L’inscription passe par l’ARPQ, qui prend en charge la couverture de ses membres : 8 $ par personne couverte, par mois, facturés à l’association. La clinique ne facture jamais les membres." data-en="Enrolment goes through the ARPQ, which covers its members: $8 per covered person, per month, billed to the association. The clinic never bills members.">L’inscription passe par l’ARPQ, qui prend en charge la couverture de ses membres : 8 $ par personne couverte, par mois, facturés à l’association. La clinique ne facture jamais les membres.</p>');

// calcul section
rep(/data-fr="96 \$" data-en="\$96">96 \$<(\/[a-z]+>\s*<[^>]*data-fr=")Le coût annuel, au maximum" data-en="[^"]*">Le coût annuel, au maximum</, 'data-fr="0 $" data-en="$0">0 $<$1Ce que ça te coûte" data-en="What it costs you">Ce que ça te coûte<');
pair("8 \\$ par mois, tarif fixe\\. Peu importe le nombre de consultations\\.", "Pris en charge par l’ARPQ. Peu importe le nombre de consultations.", "Covered by the ARPQ. However many consultations you need.");
rep(/<p([^>]*)data-fr="À 24 \$ l’heure, quatre heures perdues[\s\S]*?<\/p>/, '<p$1data-fr="À 24 $ l’heure, une visite au sans-rendez-vous te coûte quatre heures, soit 96 $. Ici, tu écris, le médecin répond, et tu continues ta route." data-en="At $24 an hour, a walk-in visit costs you four hours, or $96. Here, you write, the doctor replies, and you keep rolling.">À 24 $ l’heure, une visite au sans-rendez-vous te coûte quatre heures, soit 96 $. Ici, tu écris, le médecin répond, et tu continues ta route.</p>');

// FAQ family
rep(/Oui — à votre demande, les membres de votre famille de 18 ans et plus peuvent être ajoutés, au même tarif par personne\. À l’inscription ou plus tard\./g, "Oui — demandez à l’ARPQ d’ajouter les membres de votre famille de 18 ans et plus. Ils sont couverts aux mêmes conditions que vous, à l’inscription ou plus tard.");
rep(/Yes — at your request, family members aged 18 and over can be added, at the same per-person rate\. At enrolment or later\./g, "Yes — ask the ARPQ to add your family members aged 18 and over. They are covered on the same terms as you, at enrolment or later.");

fs.writeFileSync(file, s);
console.log("hits:", hits, "changed:", before !== s);
console.log("leftover: 'au même tarif' =", (s.match(/au même tarif/g) || []).length, "| 'same rate/per-person' =", (s.match(/same rate|same per-person/g) || []).length, "| '8 $' =", (s.match(/8 \$/g) || []).length);
