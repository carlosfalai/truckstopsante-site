// Carlos, 2026-09-02: tiers WITHOUT touching the 8 $ — each batch of covered members earns a monthly bank of free
// consultations the payer can give to anyone ("no need to pay, just send them over to us"). 1 000 covered -> 50 / month.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

const TIERS = [["100", "5"], ["500", "25"], ["1 000", "50"], ["2 000", "100"]];
const CSS = `
        /* --- paliers: banque d'accès gratuits (paliers-2026-09-02.cjs) --- */
        .paliers { padding: 72px 0; background: var(--surface-white, #fff); }
        .paliers .wrap, .paliers .container { max-width: 1040px; margin: 0 auto; padding: 0 24px; }
        .paliers h2 { text-align: center; margin: 0 0 12px; }
        .paliers .paliers-sub { text-align: center; max-width: 760px; margin: 0 auto 32px; color: var(--text-muted, #6b7280); font-size: 1.1rem; line-height: 1.55; }
        .paliers .paliers-sub strong { color: var(--text-dark, #14264A); }
        .paliers-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; max-width: 920px; margin: 0 auto; }
        .palier { border: 1px solid rgba(20,38,74,0.14); border-top: 4px solid var(--accent-amber, #F59E0B); border-radius: 10px; padding: 20px 18px; text-align: center; background: var(--bg-light, #f8fafc); }
        .palier .p-n { font-size: 0.85rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted, #6b7280); }
        .palier .p-head { font-size: 1.4rem; font-weight: 700; color: var(--text-dark, #14264A); margin: 4px 0 10px; }
        .palier .p-free { font-size: 2.4rem; font-weight: 800; color: var(--accent-amber, #F59E0B); line-height: 1; }
        .palier .p-label { font-size: 0.9rem; color: var(--text-dark, #14264A); margin-top: 6px; font-weight: 600; }
        .paliers-note { max-width: 860px; margin: 26px auto 0; text-align: center; font-size: 0.95rem; color: var(--text-muted, #6b7280); line-height: 1.55; }
        @media (max-width: 760px) { .paliers-grid { grid-template-columns: 1fr 1fr; } }
`;

function block(kind) {
  // kind: "fleet" (chauffeurs) or "team" (employés)
  const who = kind === "fleet" ? ["chauffeurs", "drivers"] : ["employés", "employees"];
  const cards = TIERS.map(([n, f]) => `
                <div class="palier">
                    <div class="p-n" data-fr="Palier" data-en="Tier">Palier</div>
                    <div class="p-head" data-fr="${n} personnes couvertes" data-en="${n.replace(" ", ",")} covered persons">${n} personnes couvertes</div>
                    <div class="p-free">${f}</div>
                    <div class="p-label" data-fr="accès gratuits par mois" data-en="free consultations a month">accès gratuits par mois</div>
                </div>`).join("");
  return `
    <section id="paliers" class="paliers">
        <div class="container">
            <h2 class="section-title" data-fr="Plus vous couvrez de monde, plus vous en offrez." data-en="The more people you cover, the more you can give away.">Plus vous couvrez de monde, plus vous en offrez.</h2>
            <p class="paliers-sub" data-fr="Le tarif ne bouge pas : <strong>8 $ par personne couverte, par mois</strong>. Ce qui grandit avec vous, c’est une banque de consultations gratuites — pour qui vous voulez : la famille, les saisonniers, les nouveaux, les membres à convaincre. Pas besoin de s’abonner. Un code, et on s’en occupe." data-en="The price never moves: <strong>$8 per covered person, per month</strong>. What grows with you is a bank of free consultations — for whoever you want: family, seasonal workers, new hires, members to win over. No subscription needed. One code, and we take it from there.">Le tarif ne bouge pas : <strong>8 $ par personne couverte, par mois</strong>. Ce qui grandit avec vous, c’est une banque de consultations gratuites — pour qui vous voulez : la famille, les saisonniers, les nouveaux, les membres à convaincre. Pas besoin de s’abonner. Un code, et on s’en occupe.</p>
            <div class="paliers-grid">${cards}
            </div>
            <p class="paliers-note" data-fr="Comment ça marche : vous recevez un code. La personne nous écrit avec le code, par texto ou par courriel, et chaque consultation est déduite de la banque, jusqu’à zéro. Quelqu’un qui a besoin de 5 consultations dans le mois en utilise 5. Les membres de la famille peuvent s’en servir sans s’abonner. La banque se renouvelle chaque mois et n’est pas cumulable." data-en="How it works: you receive a code. The person writes to us with the code, by text or email, and each consultation is deducted from the bank, down to zero. Someone who needs 5 consultations in a month uses 5. Family members can use it without subscribing. The bank renews every month and does not accumulate.">Comment ça marche : vous recevez un code. La personne nous écrit avec le code, par texto ou par courriel, et chaque consultation est déduite de la banque, jusqu’à zéro. Quelqu’un qui a besoin de 5 consultations dans le mois en utilise 5. Les membres de la famille peuvent s’en servir sans s’abonner. La banque se renouvelle chaque mois et n’est pas cumulable.</p>
        </div>
    </section>
`;
}

const TARGETS = [
  { file: "index.html", kind: "fleet", after: /<section id="prix"[\s\S]*?<\/section>\n/ },
  { file: "tsq/index.html", kind: "fleet", after: /<section id="prix"[\s\S]*?<\/section>\n/ },
  { file: "entreprises/index.html", kind: "team", after: /<section class="maths"[\s\S]*?<\/section>\n/ },
  { file: "hedhofis/index.html", kind: "team", after: /<section class="maths"[\s\S]*?<\/section>\n/ },
];

for (const t of TARGETS) {
  const file = path.join(ROOT, t.file);
  let s = fs.readFileSync(file, "utf8");
  if (s.includes('id="paliers"')) { console.log(t.file, "already has paliers"); continue; }
  const m = s.match(t.after);
  if (!m) { console.log("MISS anchor in", t.file); continue; }
  s = s.replace(t.after, m[0] + block(t.kind));
  s = s.replace(/(\n\s*)(<\/style>)/, `$1${CSS.trimEnd()}$1$2`);
  // nav link on the fleet pages
  if (t.kind === "fleet") s = s.replace(/(<a href="#prix"[^>]*>[^<]*<\/a>)/, `$1\n                <a href="#paliers" data-fr="Paliers" data-en="Tiers">Paliers</a>`);
  fs.writeFileSync(file, s);
  console.log(t.file, "paliers block added");
}

// /arpq: the association side of the page gets the same rule in one sentence
{
  const file = path.join(ROOT, "arpq/index.html");
  let s = fs.readFileSync(file, "utf8");
  const fr = "L’inscription passe par l’ARPQ. La clinique facture l’ARPQ 8 $ par personne couverte, par mois — jamais les membres.";
  const en = "Enrolment goes through the ARPQ. The clinic bills the ARPQ $8 per covered person, per month — never the members.";
  const frNew = fr + " Et à chaque tranche de 1 000 membres couverts, l’ARPQ reçoit 50 consultations gratuites par mois — pour la famille des membres ou pour qui elle veut, sans abonnement, avec un code. Chaque consultation est déduite jusqu’à zéro; la banque se renouvelle chaque mois, non cumulable.";
  const enNew = en + " And for every 1,000 covered members, the ARPQ receives 50 free consultations a month — for members’ families or whoever it wants, no subscription, with a code. Each consultation is deducted down to zero; the bank renews monthly and does not accumulate.";
  const before = s;
  s = s.split(fr).join(frNew).split(en).join(enNew);
  fs.writeFileSync(file, s);
  console.log("arpq/index.html", before !== s ? "association sentence updated" : "MISS sentence");
}
