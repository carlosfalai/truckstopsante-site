import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const consentHash = (value) => createHash("sha256").update(value).digest("hex");
const consentString = (value) => ({ S: String(value) });
const consentNow = () => new Date().toISOString();
const consentDocumentPath = new URL("./legal-documents.json", import.meta.url);
const consentError = (code, status = 400) => Object.assign(new Error(code), { consentCode: code, status });
const consentRequestId = (value) => {
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(String(value || ""))) throw consentError("invalid_request_id");
  return value;
};

export function loadConsentDocument() {
  const document = JSON.parse(readFileSync(consentDocumentPath, "utf8"));
  if (!document.version || !document.privacy?.sections?.length || !document.telemedicine?.sections?.length || !document.acknowledgements?.length) throw consentError("consent_document_unavailable", 503);
  return document;
}

// The exact PDF bytes are retained with the receipt; later retrieval never
// regenerates an accepted document from a newer policy or mutable member name.
export async function buildConsentPdf(receipt) {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Truck Stop Santé — consentement signé");
  pdf.setAuthor("Truck Stop Santé");
  pdf.setCreationDate(new Date(receipt.accepted_at));
  pdf.setModificationDate(new Date(receipt.accepted_at));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  try { regular.encodeText(receipt.typed_name); } catch { throw consentError("clinic_assistance_required", 403); }
  let page, y;
  const cleanText = (value) => String(value ?? "").replace(/[\u202f\u00a0]/g, " ");
  const newPage = () => { page = pdf.addPage([595.28, 841.89]); y = 795; };
  function line(value, heading = false) {
    if (heading && page && y < 100) newPage();
    const font = heading ? bold : regular, size = heading ? 12 : 10, maxWidth = 503;
    const words = cleanText(value).split(/\s+/).flatMap((word) => {
      const parts = []; let chunk = "";
      for (const char of word) { if (chunk && font.widthOfTextAtSize(chunk + char, size) > maxWidth) { parts.push(chunk); chunk = ""; } chunk += char; }
      if (chunk) parts.push(chunk); return parts;
    }); let current = "";
    for (const word of words) {
      if (current && font.widthOfTextAtSize(current + " " + word, size) > maxWidth) { draw(current); current = word; }
      else current += (current ? " " : "") + word;
    }
    if (current) draw(current);
    y -= 7;
    function draw(text) { if (!page || y < 55) newPage(); page.drawText(text, { x: 46, y, size, font, color: rgb(0.08, 0.12, 0.18) }); y -= 15; }
  }
  line("Truck Stop Santé — consentement personnel", true);
  line("Version : " + receipt.version + " | Reçu : " + receipt.receipt_id);
  line("Nom saisi par la personne : " + receipt.typed_name);
  line("Signature électronique par déclaration et acceptation explicites, pour soi-même (14 ans ou plus).");
  line("Accepté le : " + receipt.accepted_at + " (UTC)");
  line("Compte authentifié : " + receipt.actor.email);
  line("Empreinte du document (SHA-256) : " + receipt.document_hash);
  for (const kind of ["telemedicine", "privacy"]) {
    const section = receipt.document[kind]; line(section.title, true);
    for (const part of section.sections) { line(part.heading, true); for (const paragraph of part.paragraphs || []) line(paragraph); }
  }
  if (y < 270) newPage();
  line("Déclarations expressément acceptées", true);
  for (const acknowledgement of receipt.document.acknowledgements) line("[Accepté] " + acknowledgement.text);
  line("Le document et les déclarations ci-dessus étaient ceux affichés lors de cette acceptation. La preuve du compte authentifié n'est pas une vérification gouvernementale de l'identité civile.");
  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(`${i + 1} / ${pages.length}`, { x: 500, y: 30, size: 8, font: regular }));
  await pdf.attach(Buffer.from(JSON.stringify(receipt, null, 2), "utf8"), "consentement-original.json", { mimeType: "application/json", description: "Document original et preuve exacte de cette acceptation" });
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

export function createConsentService({ db, commands, table = process.env.CONSENTS_TABLE || "tss-portail-consents", document = loadConsentDocument, syncReceipt, syncWithdrawal, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const { GetItemCommand, QueryCommand, TransactWriteItemsCommand, UpdateItemCommand, ScanCommand } = commands;
  const pkFor = (session) => "MEMBER#" + consentHash(session.m.partner_code + ":" + session.m.id);
  const key = (pk, sk) => ({ pk: consentString(pk), sk: consentString(sk) });
  const item = (pk, sk, value, revision) => ({ ...key(pk, sk), data: consentString(JSON.stringify(value)), ...(revision === undefined ? {} : { revision: { N: String(revision) } }) });
  async function get(pk, sk) { const r = await db.send(new GetItemCommand({ TableName: table, Key: key(pk, sk), ConsistentRead: true })); return r.Item ? JSON.parse(r.Item.data.S) : null; }
  async function all(pk) {
    const values = []; let cursor;
    do { const r = await db.send(new QueryCommand({ TableName: table, KeyConditionExpression: "pk = :pk", ExpressionAttributeValues: { ":pk": consentString(pk) }, ConsistentRead: true, ExclusiveStartKey: cursor })); values.push(...(r.Items || []).map((x) => JSON.parse(x.data.S))); cursor = r.LastEvaluatedKey; } while (cursor);
    return values;
  }
  const canSign = (session) => session.actor?.role === "member" && !!session.actor.sub && !!session.actor.iss;
  async function status(session) {
    const currentDocument = document(), documentHash = consentHash(JSON.stringify(currentDocument)), pk = pkFor(session);
    if (!canSign(session)) return { ok: true, required: true, version: currentDocument.version, document_hash: documentHash, document: currentDocument, member: { id: session.m.id, name: session.m.first_name + " " + session.m.last_name }, can_sign: false, admin_preview: true, consent: null, history: [] };
    const rows = await all(pk);
    const current = rows.find((r) => r.kind === "current");
    const receipt = current && rows.find((r) => r.kind === "receipt" && r.receipt_id === current.receipt_id);
    const sync = current && rows.find((r) => r.kind === "sync" && r.receipt_id === current.receipt_id);
    const withdrawalSync = current && rows.find((r) => r.kind === "withdraw_sync" && r.receipt_id === current.receipt_id);
    if (sync && ["uploading", "posting"].includes(sync.state) && Date.now() - Date.parse(sync.updated_at || "") > 30000) { sync.state = "needs_review"; sync.detail = "Une opération clinique a été interrompue. La copie signée est conservée; la clinique doit vérifier le résultat avant tout nouvel envoi."; }
    const history = rows.filter((r) => r.kind === "receipt").map((r) => ({ receipt_id: r.receipt_id, version: r.version, accepted_at: r.accepted_at, withdrawn_at: rows.find((w) => w.kind === "withdrawal" && w.receipt_id === r.receipt_id)?.withdrawn_at || "" })).sort((a, b) => b.accepted_at.localeCompare(a.accepted_at));
    return { ok: true, required: !current || current.state !== "accepted" || current.version !== currentDocument.version || current.document_hash !== documentHash, version: currentDocument.version, document_hash: documentHash, document: currentDocument, member: { id: session.m.id, name: session.m.first_name + " " + session.m.last_name }, actor_sub: session.actor.sub, can_sign: canSign(session), admin_preview: false, consent: current ? { state: current.state, version: current.version, receipt_id: current.receipt_id, typed_name: receipt?.typed_name || "", accepted_at: receipt?.accepted_at || "", withdrawn_at: current.withdrawn_at || "", withdrawal_sync_status: withdrawalSync?.state || "", withdrawal_sync_detail: withdrawalSync?.detail || "", sync_status: sync?.state || "pending", can_retry_sync: ["pending", "uploaded", "verifying", "failed"].includes(sync?.state || "pending"), sync_detail: sync?.detail || "La copie signée est conservée. Le dépôt au dossier clinique reste à confirmer." } : null, history };
  }
  async function requireAccepted(session) { const state = await status(session); if (state.required || !canSign(session)) throw Object.assign(consentError(state.admin_preview ? "admin_preview_read_only" : "consent_required", 403), { consentStatus: state }); return state; }
  async function accept(session, input, identity) {
    if (!canSign(session)) throw consentError("admin_preview_cannot_sign", 403);
    if (!identity || identity.sub !== session.actor.sub || identity.iss !== session.actor.iss || !Number.isFinite(identity.iat) || identity.iat > Date.now() / 1000 || Date.now() / 1000 - identity.iat > 600) throw consentError("reauthentication_required", 401);
    const requestId = consentRequestId(input.request_id), pk = pkFor(session);
    const receiptId = consentHash(pk + ":accept:" + requestId).slice(0, 40);
    if (await get(pk, "RECEIPT#" + receiptId)) return status(session);
    const currentDocument = document();
    const documentHash = consentHash(JSON.stringify(currentDocument));
    if (input.version !== currentDocument.version || input.document_hash !== documentHash) throw consentError("consent_version_changed", 409);
    const name = String(input.typed_name || "").trim();
    if (name.length < 2 || name.length > 160 || /[\x00-\x1f]/.test(name)) throw consentError("signature_name_required");
    if (input.self_age_14_plus !== true) throw consentError("clinic_assistance_required", 403);
    const ids = currentDocument.acknowledgements.map((a) => a.id);
    if (!Array.isArray(input.acknowledgements) || input.acknowledgements.length !== ids.length || !ids.every((id) => input.acknowledgements.includes(id))) throw consentError("acknowledgements_required");
    const before = await get(pk, "CURRENT");
    if (before?.state === "accepted" && before.version === currentDocument.version && before.document_hash === documentHash) return status(session);
    const acceptedAt = consentNow();
    const receipt = { kind: "receipt", receipt_id: receiptId, version: currentDocument.version, accepted_at: acceptedAt, typed_name: name, self_age_14_plus: true, acknowledgements: ids, actor: { iss: identity.iss, sub: identity.sub, email: identity.email }, document: currentDocument, document_hash: consentHash(JSON.stringify(currentDocument)), patient: { first_name: session.m.first_name, last_name: session.m.last_name, phone: session.m.phone, email: session.m.email } };
    const pdf = await buildConsentPdf(receipt); receipt.pdf_hash = consentHash(pdf); receipt.pdf_base64 = pdf.toString("base64");
    if (Buffer.byteLength(JSON.stringify(receipt), "utf8") > 350000) throw consentError("consent_document_too_large", 503);
    const current = { kind: "current", state: "accepted", version: receipt.version, document_hash: documentHash, receipt_id: receiptId, accepted_at: acceptedAt, revision: (before?.revision || 0) + 1 };
    try { await db.send(new TransactWriteItemsCommand({ ClientRequestToken: randomUUID(), TransactItems: [
      { Put: { TableName: table, Item: item(pk, "RECEIPT#" + receiptId, receipt), ConditionExpression: "attribute_not_exists(pk)" } },
      { Put: { TableName: table, Item: item(pk, "CURRENT", current, current.revision), ConditionExpression: before ? "revision = :previous" : "attribute_not_exists(pk)", ...(before ? { ExpressionAttributeValues: { ":previous": { N: String(before.revision) } } } : {}) } },
      { Put: { TableName: table, Item: { ...item(pk, "SYNC#" + receiptId, { kind: "sync", receipt_id: receiptId, state: "pending", detail: "Copie conservée; dépôt au dossier clinique en attente." }), sync_state: consentString("pending"), queue_ready: consentString("1") }, ConditionExpression: "attribute_not_exists(pk)" } },
    ] })); } catch (e) { if (e.name !== "TransactionCanceledException") throw e; if (!await get(pk, "RECEIPT#" + receiptId)) throw consentError("consent_state_changed", 409); }
    return status(session);
  }
  async function withdraw(session, input) {
    if (!canSign(session)) throw consentError("admin_preview_cannot_sign", 403);
    const requestId = consentRequestId(input.request_id), pk = pkFor(session), sk = "WITHDRAWAL#" + consentHash(requestId).slice(0, 40);
    if (await get(pk, sk)) return status(session);
    const before = await get(pk, "CURRENT");
    if (!before || before.state === "withdrawn") return status(session);
    const at = consentNow(), withdrawalId = sk.slice("WITHDRAWAL#".length), current = { ...before, state: "withdrawn", withdrawn_at: at, revision: before.revision + 1 };
    const savedReceipt = await get(pk, "RECEIPT#" + before.receipt_id);
    try { await db.send(new TransactWriteItemsCommand({ TransactItems: [
      { Put: { TableName: table, Item: item(pk, sk, { kind: "withdrawal", withdrawal_id: withdrawalId, receipt_id: before.receipt_id, withdrawn_at: at, signer_name: savedReceipt.typed_name, actor: { iss: session.actor.iss, sub: session.actor.sub, email: session.actor.email || "" } }), ConditionExpression: "attribute_not_exists(pk)" } },
      { Put: { TableName: table, Item: item(pk, "CURRENT", current, current.revision), ConditionExpression: "revision = :previous", ExpressionAttributeValues: { ":previous": { N: String(before.revision) } } } },
      { Put: { TableName: table, Item: { ...item(pk, "WITHDRAW_SYNC#" + withdrawalId, { kind: "withdraw_sync", withdrawal_id: withdrawalId, receipt_id: before.receipt_id, state: "pending", detail: "Retrait enregistré; transmission au dossier clinique en attente." }), sync_state: consentString("pending"), queue_ready: consentString("1") }, ConditionExpression: "attribute_not_exists(pk)" } },
    ] })); } catch (error) { if (error.name !== "TransactionCanceledException") throw error; if (!await get(pk, sk)) throw consentError("consent_state_changed", 409); }
    return status(session);
  }
  async function receipt(session, receiptId) {
    if (!canSign(session)) throw consentError("admin_preview_read_only", 403);
    if (!/^[a-f0-9]{40}$/.test(String(receiptId || ""))) throw consentError("receipt_not_found", 404);
    const saved = await get(pkFor(session), "RECEIPT#" + receiptId);
    if (!saved) throw consentError("receipt_not_found", 404);
    return saved;
  }
  async function download(session, receiptId) { const saved = await receipt(session, receiptId); return { ok: true, filename: "Truck-Stop-Sante-consentement-" + saved.version + ".pdf", mime_type: "application/pdf", base64: saved.pdf_base64 }; }
  const runnable = (state) => ["pending", "uploaded", "verifying", "failed"].includes(state);
  function validateJob(pk, id, kind) {
    if (!/^MEMBER#[a-f0-9]{64}$/.test(String(pk)) || !/^[a-f0-9]{40}$/.test(String(id)) || !["consent", "withdrawal"].includes(kind)) throw consentError("invalid_consent_job", 400);
  }
  async function wakeWithdrawals(pk, receiptId, receiptState) {
    for (const pending of (await all(pk)).filter((r) => r.kind === "withdraw_sync" && r.receipt_id === receiptId && r.state === "waiting")) {
      const next = { ...pending, state: receiptState === "saved" ? "pending" : "needs_review", detail: receiptState === "saved" ? "Retrait enregistré; transmission au dossier clinique en attente." : "Le retrait est conservé. La clinique doit vérifier son dépôt au dossier." };
      try { await db.send(new UpdateItemCommand({ TableName: table, Key: key(pk, "WITHDRAW_SYNC#" + pending.withdrawal_id), UpdateExpression: "SET #data = :data, sync_state = :state, queue_ready = :ready", ConditionExpression: "sync_state = :waiting AND (attribute_not_exists(sync_lock_until) OR sync_lock_until < :now)", ExpressionAttributeNames: { "#data": "data" }, ExpressionAttributeValues: { ":data": consentString(JSON.stringify(next)), ":state": consentString(next.state), ":ready": consentString(next.state === "pending" ? "1" : "0"), ":waiting": consentString("waiting"), ":now": consentString(consentNow()) } })); }
      catch (error) { if (error.name !== "ConditionalCheckFailedException") throw error; }
    }
  }
  // Server-only entry point: the stream passes opaque keys, never a stored token.
  async function syncStored(pk, id, kind = "consent", worker = false) {
    validateJob(pk, id, kind);
    const sk = (kind === "consent" ? "SYNC#" : "WITHDRAW_SYNC#") + id;
    let before = await get(pk, sk);
    if (!before) throw consentError("consent_job_not_found", 404);
    if (["saved", "needs_review"].includes(before.state)) { if (kind === "consent") await wakeWithdrawals(pk, id, before.state); return before; }
    const saved = await get(pk, "RECEIPT#" + before.receipt_id);
    if (!saved) throw consentError("receipt_not_found", 404);
    const owner = randomUUID();
    try { await db.send(new UpdateItemCommand({ TableName: table, Key: key(pk, sk), UpdateExpression: "SET sync_owner = :owner, sync_lock_until = :until, queue_ready = :zero", ConditionExpression: "attribute_not_exists(sync_lock_until) OR sync_lock_until < :now", ExpressionAttributeValues: { ":owner": consentString(owner), ":until": consentString(new Date(Date.now() + 30000).toISOString()), ":now": consentString(consentNow()), ":zero": consentString("0") } })); }
    catch (error) { if (error.name !== "ConditionalCheckFailedException") throw error; if (worker) { await sleep(20000); throw new Error("consent_worker_busy"); } return before; }
    // A concurrent delivery may have completed before our lease was acquired.
    before = await get(pk, sk);
    let latest = before;
    const saveStage = async (next) => {
      latest = { ...next, kind: before.kind, receipt_id: saved.receipt_id, ...(kind === "withdrawal" ? { withdrawal_id: id } : {}) };
      await db.send(new UpdateItemCommand({ TableName: table, Key: key(pk, sk), UpdateExpression: "SET #data = :data, sync_state = :state", ConditionExpression: "sync_owner = :owner", ExpressionAttributeNames: { "#data": "data" }, ExpressionAttributeValues: { ":data": consentString(JSON.stringify(latest)), ":state": consentString(latest.state), ":owner": consentString(owner) } }));
    };
    try {
      if (["saved", "needs_review"].includes(before.state)) return before;
      if (["uploading", "posting"].includes(before.state)) await saveStage({ ...before, state: "needs_review", detail: "Une opération clinique a été interrompue. La clinique doit vérifier son résultat avant tout nouvel envoi." });
      else {
        const verificationAttempts = Number(before.verification_attempts || 0) + (before.state === "verifying" ? 1 : 0);
        const attempts = Number(before.attempts || 0) + 1;
        const failures = Number(before.failures || 0) + (before.state === "failed" ? 1 : 0);
        if (verificationAttempts > 5 || failures >= 3 || attempts > 10) await saveStage({ ...before, state: "needs_review", detail: "La vérification automatique est terminée sans confirmation. La clinique doit contrôler le dépôt au dossier." });
        else {
          if (worker && ["verifying", "failed"].includes(before.state)) await sleep(2000);
          const next = { ...before, attempts, verification_attempts: verificationAttempts, failures };
          // Retain the attempt before network I/O, including a Lambda timeout.
          await saveStage(next);
          const persist = (stage) => saveStage({ ...stage, attempts, verification_attempts: verificationAttempts, failures });
          if (kind === "consent") await syncReceipt(saved, next, persist);
          else {
            const original = await get(pk, "SYNC#" + saved.receipt_id);
            if (original?.state !== "saved") await persist({ ...next, state: original?.state === "needs_review" ? "needs_review" : "waiting", detail: "Retrait conservé; le dépôt clinique attend la vérification de la copie signée." });
            else await syncWithdrawal(saved, await get(pk, "WITHDRAWAL#" + id), original, next, persist);
          }
        }
      }
    } finally {
      await db.send(new UpdateItemCommand({ TableName: table, Key: key(pk, sk), UpdateExpression: "SET sync_lock_until = :empty, queue_ready = :ready", ConditionExpression: "sync_owner = :owner", ExpressionAttributeValues: { ":empty": consentString(""), ":ready": consentString(runnable(latest.state) ? "1" : "0"), ":owner": consentString(owner) } }));
    }
    if (kind === "consent" && ["saved", "needs_review"].includes(latest.state)) await wakeWithdrawals(pk, id, latest.state);
    if (kind === "withdrawal" && latest.state === "waiting") {
      const original = await get(pk, "SYNC#" + saved.receipt_id);
      if (["saved", "needs_review"].includes(original?.state)) await wakeWithdrawals(pk, saved.receipt_id, original.state);
    }
    return latest;
  }
  async function sync(session, receiptId) {
    await receipt(session, receiptId);
    await syncStored(pkFor(session), receiptId);
    return status(session);
  }
  async function listJobs(cursor) {
    let exclusive;
    try { if (cursor) { if (String(cursor).length > 512) throw new Error(); const parsed = JSON.parse(Buffer.from(String(cursor), "base64url").toString()); if (!/^MEMBER#[a-f0-9]{64}$/.test(parsed.pk?.S || "") || !/^(CURRENT|(RECEIPT|SYNC|WITHDRAWAL|WITHDRAW_SYNC)#[a-f0-9]{40})$/.test(parsed.sk?.S || "")) throw new Error(); exclusive = key(parsed.pk.S, parsed.sk.S); } } catch { throw consentError("invalid_cursor"); }
    const result = await db.send(new ScanCommand({ TableName: table, Limit: 40, ExclusiveStartKey: exclusive, FilterExpression: "begins_with(sk, :sync) OR begins_with(sk, :withdraw)", ExpressionAttributeValues: { ":sync": consentString("SYNC#"), ":withdraw": consentString("WITHDRAW_SYNC#") } }));
    const items = [];
    for (const row of result.Items || []) {
      const job = JSON.parse(row.data.S), saved = await get(row.pk.S, "RECEIPT#" + job.receipt_id);
      if (!saved) continue;
      if (["uploading", "posting"].includes(job.state) && Date.now() - Date.parse(job.updated_at || "") > 30000) { job.state = "needs_review"; job.detail = "Une opération clinique a été interrompue. Vérifiez son résultat dans Spruce avant toute autre action."; }
      items.push({ pk: row.pk.S, job_id: job.withdrawal_id || job.receipt_id, kind: job.kind === "withdraw_sync" ? "withdrawal" : "consent", member_name: saved.patient.first_name.slice(0, 1) + ". " + saved.patient.last_name, receipt_id: saved.receipt_id, version: saved.version, date: job.kind === "withdraw_sync" ? (await get(row.pk.S, "WITHDRAWAL#" + job.withdrawal_id))?.withdrawn_at : saved.accepted_at, status: job.state, detail: job.detail, can_retry: runnable(job.state) });
    }
    return { ok: true, items, cursor: result.LastEvaluatedKey ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64url") : "" };
  }
  return { status, requireAccepted, accept, withdraw, download, sync, syncStored, listJobs };
}
