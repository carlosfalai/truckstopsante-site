// Carlos, 2026-09-02: (1) insurance forms = for temporary work stoppages; (2) add "if it can be done by telemedicine
// while on the road, we do it"; (3) remove every M28 / SAAQ-exam / clinic mention (there is no physical clinic).
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const PAGES = ["index.html", "tsq/index.html", "arpq/index.html", "hedhofis/index.html", "entreprises/index.html", "solo/index.html"];

for (const rel of PAGES) {
  const file = path.join(ROOT, rel);
  let s = fs.readFileSync(file, "utf8");
  const before = s;
  const isMember = rel.startsWith("arpq");
  const isFleet = rel === "index.html" || rel.startsWith("tsq");

  // (3) M28 / SAAQ removals
  s = s.replace(/\s*<a href="#m28"[^>]*>[^<]*<\/a>/g, "");
  s = s.replace(/\n\s*<section id="m28"[\s\S]*?<\/section>\n/g, "\n");
  s = s.replace(/\s*<details>\s*<summary><span[^>]*>[^<]*(?:M28|SAAQ)[^<]*<\/span><\/summary>[\s\S]*?<\/details>/g, "");
  s = s.replace(/<p class="proof-src">Centre Médical M28 · m28\.ca<\/p>/g, '<p class="proof-src">Centre Médical Font</p>');
  s = s.replace(/\s*<span data-fr="Examens SAAQ :" data-en="SAAQ exams:">Examens SAAQ :<\/span> <a href="https:\/\/m28\.ca"[^>]*>m28\.ca<\/a> ·/g, "");
  s = s.replace(/ · <a href="https:\/\/m28\.ca">m28\.ca<\/a>/g, "");
  s = s.replace(/<a href='https:\/\/m28\.ca'[^>]*>m28\.ca<\/a>/g, "Centre Médical Font");
  s = s.replace(/<a href="https:\/\/m28\.ca"[^>]*>m28\.ca<\/a>/g, "Centre Médical Font");
  s = s.replace(/Centre Médical Font — Centre Médical Font/g, "Centre Médical Font");
  s = s.replace(/la clinique d’origine derrière/g, "la pratique d’origine derrière");

  // (1) insurance forms
  s = s.replace(/data-fr="Formulaires d’assurance" data-en="Insurance forms">Formulaires d’assurance</g, 'data-fr="Formulaires d’assurance (arrêts de travail temporaires)" data-en="Insurance forms (temporary work stoppages)">Formulaires d’assurance (arrêts de travail temporaires)<');

  // (2) on the road line — appended to the "anywhere" checklist description
  const frLine = isMember ? " Si c’est faisable en télémédecine pendant tes déplacements, on le fait." : isFleet ? " Si c’est faisable en télémédecine pendant les déplacements du chauffeur, on le fait." : " Si c’est faisable en télémédecine, on le fait.";
  const enLine = isMember ? " If it can be done by telemedicine while you’re on the road, we do it." : isFleet ? " If it can be done by telemedicine while the driver is on the road, we do it." : " If it can be done by telemedicine, we do it.";
  let added = 0;
  s = s.replace(/(data-fr=")([^"]*aucun déplacement, aucune file)(" data-en=")([^"]*no travel, no queue)(">)([^<]*aucun déplacement, aucune file)(<)/g, (m, a, fr, b, en, c, txt, d) => { added++; return a + fr + frLine + b + en + enLine + c + txt + frLine + d; });

  fs.writeFileSync(file, s);
  const left = (s.split("\n").filter((l) => l.length < 3000 && /m28|saaq/i.test(l) && !/^\s*\.m28|@media[^{]*\.m28/.test(l)).length);
  console.log(rel.padEnd(22), "changed:", before !== s, "| road line added:", added, "| m28/saaq text lines left:", left);
}
