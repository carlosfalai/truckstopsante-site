// Locks everything ARPQ behind a code: the page, the poster PDF, the registre and the two member videos are
// AES-256-GCM encrypted (key = PBKDF2-SHA256 of the code) and only decrypted in the visitor's browser.
// Plaintext source lives in _private/arpq/ (gitignored). Deployed artifacts: arpq/page.enc, arpq/*.enc, videos/arpq-*.enc.
// Usage: node _scripts/arpq-lock.cjs <code>
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const site = path.resolve(__dirname, "..");
const code = process.argv[2]; if (!code) { console.error("usage: node _scripts/arpq-lock.cjs <code>"); process.exit(1); }
const SALT = "truckstopsante.com/arpq", ITER = 310000;
const key = crypto.pbkdf2Sync(code, SALT, ITER, 32, "sha256");
function enc(buf) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv("aes-256-gcm", key, iv); const ct = Buffer.concat([c.update(buf), c.final()]); return Buffer.concat([iv, ct, c.getAuthTag()]); }
const priv = path.join(site, "_private", "arpq");
const out = { page: path.join(site, "arpq", "page.enc"), pdf: path.join(site, "arpq", "affiche.pdf.enc"), xlsx: path.join(site, "arpq", "registre.xlsx.enc"), fr: path.join(site, "videos", "arpq-membre-fr-web.mp4.enc"), en: path.join(site, "videos", "arpq-member-en-web.mp4.enc") };

let html = fs.readFileSync(path.join(priv, "index.html"), "utf8");
// assets become encrypted blobs resolved by the ARPQ helper injected at unlock time
html = html.replace('data-src-fr="/videos/arpq-membre-fr-web.mp4" data-src-en="/videos/arpq-member-en-web.mp4" poster="/videos/arpq-membre-fr.jpg"', 'data-src-fr="/videos/arpq-membre-fr-web.mp4.enc" data-src-en="/videos/arpq-member-en-web.mp4.enc"');
html = html.replace("v.setAttribute('src', s); v.muted = true; v.load(); v.play().catch(function(){});", "ARPQ.blob(s).then(function (u) { v.setAttribute('src', u); v.muted = true; v.load(); v.play().catch(function(){}); });");
html = html.replace(/href="[^"]*truck-stop-sante-arpq-affiche-fr-en.pdf"/g, 'href="#" data-enc="/arpq/affiche.pdf.enc" data-name="truck-stop-sante-arpq-affiche-fr-en.pdf" data-type="application/pdf"');
html = html.replace(/href="[^"]*registre-modele.xlsx"/g, 'href="#" data-enc="/arpq/registre.xlsx.enc" data-name="registre-modele-arpq.xlsx" data-type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"');
html = html.replace("<head>", '<head>\n<meta name="robots" content="noindex, nofollow">');
const left = (html.match(/href="[^"]*(affiche-fr-en\.pdf|registre-modele\.xlsx)"|\/videos\/arpq[^"]*\.mp4"/g) || []);
if (left.length) { console.error("plaintext asset refs still present:", left); process.exit(1); }
fs.writeFileSync(out.page, enc(Buffer.from(html, "utf8")));
const files = [["pdf", path.join(priv, "truck-stop-sante-arpq-affiche-fr-en.pdf")], ["xlsx", path.join(priv, "registre-modele.xlsx")], ["fr", path.join(priv, "arpq-membre-fr-web.mp4")], ["en", path.join(priv, "arpq-member-en-web.mp4")]];
for (const [k, src] of files) { if (!fs.existsSync(src)) { console.error("missing", src); process.exit(1); } fs.writeFileSync(out[k], enc(fs.readFileSync(src))); }
for (const [k, p] of Object.entries(out)) console.log(k, "->", path.relative(site, p), (fs.statSync(p).size / 1024).toFixed(0) + " KB");
