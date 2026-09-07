import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, generateKeyPairSync, createSign } from "node:crypto";
import { createRequire } from "node:module";
import { createConsentService } from "../lambda/consent.mjs";
import { createSpruceConsentSync, createSpruceWithdrawalSync } from "../lambda/spruce-consent.mjs";
import { handleConsentStream, isConsentStreamEvent } from "../lambda/consent-events.mjs";
const require = createRequire(import.meta.url);
const { PDFDocument } = createRequire(new URL("../lambda/package.json", import.meta.url))("pdf-lib");
const { harness: onboardingHarness } = require("./onboarding-harness.cjs");
const originalDocument = JSON.parse(readFileSync(new URL("../../../portail/legal/2026-09-07.json", import.meta.url), "utf8"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const copy = (value) => JSON.parse(JSON.stringify(value));

function storage() {
  const records = new Map(), commands = {};
  const key = (item) => item.pk.S + "/" + item.sk.S;
  const conditional = () => Object.assign(new Error("synthetic conflict"), { name: "ConditionalCheckFailedException" });
  for (const name of ["GetItemCommand", "QueryCommand", "TransactWriteItemsCommand", "UpdateItemCommand", "ScanCommand"]) commands[name] = class { constructor(input) { this.input = input; this.name = name; } };
  const db = { async send(command) {
    const a = command.input;
    if (command.name === "GetItemCommand") return { Item: records.has(key(a.Key)) ? copy(records.get(key(a.Key))) : undefined };
    if (command.name === "QueryCommand") return { Items: [...records.values()].filter((r) => r.pk.S === a.ExpressionAttributeValues[":pk"].S).map(copy) };
    if (command.name === "ScanCommand") return { Items: [...records.values()].filter((r) => /^(SYNC|WITHDRAW_SYNC)#/.test(r.sk.S)).slice(0, a.Limit).map(copy) };
    if (command.name === "TransactWriteItemsCommand") {
      for (const { Put: put } of a.TransactItems) {
        const before = records.get(key(put.Item));
        if ((put.ConditionExpression === "attribute_not_exists(pk)" && before) || (put.ConditionExpression === "revision = :previous" && before?.revision?.N !== put.ExpressionAttributeValues[":previous"].N)) throw Object.assign(new Error("transaction conflict"), { name: "TransactionCanceledException" });
      }
      for (const { Put: put } of a.TransactItems) records.set(key(put.Item), copy(put.Item));
      return {};
    }
    if (command.name === "UpdateItemCommand") {
      const current = records.get(key(a.Key)); if (!current) throw new Error("unexpected missing sync record");
      const v = a.ExpressionAttributeValues;
      if (a.ConditionExpression.includes("sync_lock_until") && current.sync_lock_until?.S && current.sync_lock_until.S >= v[":now"].S) throw conditional();
      if (a.ConditionExpression === "sync_owner = :owner" && current.sync_owner?.S !== v[":owner"].S) throw conditional();
      if (a.ConditionExpression.startsWith("sync_state = :waiting") && current.sync_state?.S !== v[":waiting"].S) throw conditional();
      for (const assignment of a.UpdateExpression.replace(/^SET /, "").split(/,\s*/)) { const [raw, value] = assignment.split(/\s*=\s*/); current[a.ExpressionAttributeNames?.[raw] || raw] = copy(v[value]); }
      return {};
    }
    throw new Error("unexpected command");
  } };
  return { records, commands, db };
}

function setup(syncReceipt = async () => {}, options = {}) {
  const store = storage(); let document = copy(originalDocument);
  const session = { m: { id: "synthetic-member", partner_code: "SYNTHETIC", first_name: "Élodie", last_name: "Exemple", phone: "+15140000001", email: "member@example.invalid", status: "actif" }, actor: { role: "member", iss: "https://accounts.google.com", sub: "synthetic-google-sub", email: "member@example.invalid" } };
  const identity = { ...session.actor, iat: Math.floor(Date.now() / 1000) };
  const sleeps = [];
  const service = createConsentService({ ...store, document: () => document, syncReceipt, sleep: async (ms) => { sleeps.push(ms); }, ...options });
  const input = (requestId = "synthetic-request-0001") => ({ request_id: requestId, version: document.version, document_hash: hash(JSON.stringify(document)), typed_name: "Élodie Exemple", self_age_14_plus: true, acknowledgements: document.acknowledgements.map((a) => a.id) });
  return { ...store, service, session, identity, input, sleeps, setDocument: (next) => { document = next; }, document: () => document };
}

test("first login gates actions; acceptance creates an exact signed PDF and atomic audit snapshot", async () => {
  const h = setup(); assert.equal((await h.service.status(h.session)).required, true);
  await assert.rejects(h.service.requireAccepted(h.session), { consentCode: "consent_required" });
  const accepted = await h.service.accept(h.session, h.input(), h.identity);
  assert.equal(accepted.required, false); assert.equal(accepted.consent.typed_name, "Élodie Exemple"); assert.equal(accepted.consent.sync_status, "pending");
  assert.equal(h.records.size, 3);
  const receipt = [...h.records.values()].map((r) => JSON.parse(r.data.S)).find((r) => r.kind === "receipt");
  assert.deepEqual(receipt.document, originalDocument); assert.equal(receipt.actor.sub, h.identity.sub);
  const download = await h.service.download(h.session, accepted.consent.receipt_id);
  const bytes = Buffer.from(download.base64, "base64"); assert.equal(hash(bytes), receipt.pdf_hash);
  const pdf = await PDFDocument.load(bytes); assert.ok(pdf.getPageCount() >= 3); assert.ok(pdf.catalog.getNames?.() || pdf.catalog.get(pdf.context.obj("Names")));
});

test("stale text, incomplete choices, unsupported signatures and weak/future identity never record consent", async () => {
  const h = setup();
  for (const change of [{ version: "stale" }, { document_hash: "bad" }, { acknowledgements: [] }, { self_age_14_plus: false }, { typed_name: "" }, { typed_name: "李明" }]) await assert.rejects(h.service.accept(h.session, { ...h.input(), ...change }, h.identity));
  for (const identity of [null, { ...h.identity, sub: "someone-else" }, { ...h.identity, iat: NaN }, { ...h.identity, iat: undefined }, { ...h.identity, iat: Date.now() / 1000 + 100 }, { ...h.identity, iat: Date.now() / 1000 - 601 }]) await assert.rejects(h.service.accept(h.session, h.input(), identity), { consentCode: "reauthentication_required" });
  assert.equal(h.records.size, 0);
});

test("repeat requests cannot duplicate signatures; changed text re-gates without rewriting the accepted copy", async () => {
  const h = setup(); const first = await h.service.accept(h.session, h.input(), h.identity);
  const before = await h.service.download(h.session, first.consent.receipt_id);
  await h.service.accept(h.session, h.input(), h.identity); await h.service.accept(h.session, h.input("synthetic-request-0002"), h.identity);
  assert.equal((await h.service.status(h.session)).history.length, 1);
  const changed = copy(h.document()); changed.telemedicine.sections[0].paragraphs[0] += " Texte modifié."; h.setDocument(changed);
  assert.equal((await h.service.status(h.session)).required, true);
  assert.equal((await h.service.download(h.session, first.consent.receipt_id)).base64, before.base64);
  await h.service.accept(h.session, h.input("synthetic-request-0003"), h.identity);
  assert.equal((await h.service.status(h.session)).history.length, 2);
});

test("withdrawal is durable, gates future actions, and preserves historical downloads", async () => {
  const h = setup(); const first = await h.service.accept(h.session, h.input(), h.identity);
  const withdrew = await h.service.withdraw(h.session, { request_id: "synthetic-withdraw-01" });
  assert.equal(withdrew.required, true); assert.equal(withdrew.consent.state, "withdrawn"); assert.ok(withdrew.history[0].withdrawn_at);
  await h.service.withdraw(h.session, { request_id: "synthetic-withdraw-01" }); assert.equal(h.records.size, 5);
  await assert.rejects(h.service.requireAccepted(h.session), { consentCode: "consent_required" });
  assert.ok((await h.service.download(h.session, first.consent.receipt_id)).base64);
});

test("admin previews and different members cannot sign, withdraw or read the patient's signed receipt", async () => {
  const h = setup(); const signed = await h.service.accept(h.session, h.input(), h.identity);
  const admin = { ...h.session, actor: { role: "admin" } };
  assert.deepEqual((await h.service.status(admin)).history, []);
  await assert.rejects(h.service.accept(admin, h.input(), h.identity), { consentCode: "admin_preview_cannot_sign" });
  await assert.rejects(h.service.withdraw(admin, { request_id: "synthetic-withdraw-01" }), { consentCode: "admin_preview_cannot_sign" });
  await assert.rejects(h.service.download(admin, signed.consent.receipt_id), { consentCode: "admin_preview_read_only" });
  await assert.rejects(h.service.download({ ...h.session, m: { ...h.session.m, id: "another-member" } }, signed.consent.receipt_id), { consentCode: "receipt_not_found" });
});

function spruceMock(options = {}) {
  const requests = []; let pdf, note, withdrawal; const identity = { id: "contact-synthetic", category: "patient", givenName: "Élodie", familyName: "Exemple", phoneNumbers: [{ value: "+15140000001" }], emailAddresses: [{ value: "member@example.invalid" }] };
  const json = (body) => ({ ok: true, json: async () => copy(body) });
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url, ...init });
    if (url.endsWith("/contacts/search")) { if (options.readFailure) throw new Error("synthetic read failure"); return json({ contacts: options.contacts || [identity] }); }
    if (url.endsWith("/media")) { if (options.uploadTimeout) throw new Error("uncertain timeout"); pdf = Buffer.from(await init.body.get("media").arrayBuffer()); return json({ id: "media-synthetic" }); }
    if (url.endsWith("/conversations") && init.method === "POST") {
      note = JSON.parse(init.body); assert.equal(note.type, "note"); assert.equal(note.note.message.internal, true); assert.deepEqual(note.note.associatedContactIds, [identity.id]); assert.match(init.headers["s-idempotency-key"], /^tss-consent-/);
      if (options.noteTimeout) throw new Error("uncertain timeout");
      return json({ conversation: { id: "conversation-synthetic" }, postMessageRequestId: "request-synthetic" });
    }
    if (url.endsWith("/conversations/conversation-synthetic")) return json({ conversation: { id: "conversation-synthetic", type: "note", associatedContactIds: [identity.id], externalParticipants: [] } });
    if (url.endsWith("/messages")) { withdrawal = JSON.parse(init.body); assert.equal(withdrawal.internal, true); assert.match(init.headers["s-idempotency-key"], /^tss-withdrawal-/); if (options.withdrawalTimeout) throw new Error("synthetic timeout"); return json({ requestId: "withdrawal-request-synthetic" }); }
    if (url.includes("/items?")) return json({ conversationItems: options.delayed ? [] : [ ...(note ? [{ id: "item-synthetic", conversationId: "conversation-synthetic", isInternalNote: true, requestId: "request-synthetic", text: note.note.message.body[0].value, attachments: [{ type: "document", title: note.note.message.attachments[0].title, data: { name: note.note.message.attachments[0].title, mimetype: "application/pdf", signedUrl: { url: "https://synthetic.sprucehealth.com/signed-pdf", expiresAt: new Date(Date.now() + 60000).toISOString() } } }] }] : []), ...(withdrawal ? [{ id: "withdrawal-item-synthetic", conversationId: "conversation-synthetic", isInternalNote: true, requestId: "withdrawal-request-synthetic", text: withdrawal.body[0].value }] : []) ] });
    if (url === "https://synthetic.sprucehealth.com/signed-pdf") { assert.equal(init.headers?.Authorization, undefined); return { ok: true, headers: { get: () => String(pdf.length) }, arrayBuffer: async () => options.wrongHash ? Buffer.from("wrong-pdf") : pdf }; }
    throw new Error("Unapproved synthetic network operation: " + url);
  };
  return { requests, options, fetchImpl, identity };
}

test("Spruce copy is internal only; saved requires downloaded attachment hash; retries reuse uploaded media and note", async () => {
  const mock = spruceMock(), h = setup(createSpruceConsentSync({ auth: "synthetic", fetchImpl: mock.fetchImpl }));
  const signed = await h.service.accept(h.session, h.input(), h.identity), id = signed.consent.receipt_id;
  assert.equal((await h.service.sync(h.session, id)).consent.sync_status, "uploaded");
  assert.equal((await h.service.sync(h.session, id)).consent.sync_status, "verifying");
  assert.equal((await h.service.sync(h.session, id)).consent.sync_status, "saved");
  await h.service.sync(h.session, id);
  assert.equal(mock.requests.filter((r) => r.url.endsWith("/media")).length, 1);
  assert.equal(mock.requests.filter((r) => r.url.endsWith("/conversations")).length, 1);
  assert.equal(mock.requests.some((r) => /telegram|\/invite$/.test(r.url) || (r.url.endsWith("/contacts") && r.method === "POST")), false);
});

test("ambiguous Spruce identities never upload; unknown writes seal retries without duplicating documents", async () => {
  for (const mode of ["ambiguous", "missing", "mismatch", "uploadTimeout", "noteTimeout", "wrongHash"]) {
    const mock = spruceMock();
    if (mode === "ambiguous") mock.options.contacts = [mock.identity, { ...mock.identity, id: "duplicate-contact" }];
    if (mode === "missing") mock.options.contacts = [];
    if (mode === "mismatch") mock.options.contacts = [{ ...mock.identity, emailAddresses: [{ value: "other@example.invalid" }] }];
    if (["uploadTimeout", "noteTimeout", "wrongHash"].includes(mode)) mock.options[mode] = true;
    const h = setup(createSpruceConsentSync({ auth: "synthetic", fetchImpl: mock.fetchImpl })); const signed = await h.service.accept(h.session, h.input(), h.identity);
    for (let i = 0; i < 4; i++) await h.service.sync(h.session, signed.consent.receipt_id);
    assert.equal((await h.service.status(h.session)).consent.sync_status, "needs_review", mode);
    assert.ok(mock.requests.filter((r) => r.url.endsWith("/media")).length <= 1, mode);
    assert.ok(mock.requests.filter((r) => r.url.endsWith("/conversations")).length <= 1, mode);
  }
});

test("asynchronous Spruce posting can be verified later without posting again", async () => {
  const mock = spruceMock({ delayed: true }), h = setup(createSpruceConsentSync({ auth: "synthetic", fetchImpl: mock.fetchImpl })); const signed = await h.service.accept(h.session, h.input(), h.identity);
  for (let i = 0; i < 3; i++) await h.service.sync(h.session, signed.consent.receipt_id);
  assert.equal((await h.service.status(h.session)).consent.sync_status, "verifying");
  mock.options.delayed = false; await h.service.sync(h.session, signed.consent.receipt_id);
  assert.equal((await h.service.status(h.session)).consent.sync_status, "saved"); assert.equal(mock.requests.filter((r) => r.url.endsWith("/conversations")).length, 1);
});

test("a crashed external-write stage becomes visible manual review after the worker lease expires", async () => {
  let externalCalls = 0; const h = setup(async () => { externalCalls++; }); const signed = await h.service.accept(h.session, h.input(), h.identity);
  const stored = [...h.records.values()].find((r) => r.sk.S.startsWith("SYNC#")); const data = JSON.parse(stored.data.S); data.state = "posting"; stored.data.S = JSON.stringify(data); stored.sync_lock_until = { S: "2000-01-01T00:00:00.000Z" };
  const state = await h.service.sync(h.session, signed.consent.receipt_id);
  assert.equal(state.consent.sync_status, "needs_review"); assert.equal(externalCalls, 0);
});

test("real handler uses expiring hashed member sessions, rejects surname-phone takeover, and makes no Telegram calls", async () => {
  const token = { sub: "google-synthetic", iss: "https://accounts.google.com", email: "driver1@example.invalid", email_verified: true, exp: Date.now() / 1000 + 3600, iat: Math.floor(Date.now() / 1000) };
  const h = onboardingHarness({ googleTokens: { valid: token, attacker: { ...token, sub: "attacker", email: "attacker@example.invalid" } }, consentService: { requireAccepted: async () => { throw Object.assign(new Error("consent_required"), { consentCode: "consent_required", status: 403 }); } } });
  const p = await h.create(); const row = await h.call("/member", { code: p.code, ...h.person(1) }); h.pay(p.code, 1); await h.call("/enrol/complete", { session_id: "cs_synthetic" });
  assert.equal((await h.call("/membre/verify", { credential: "attacker", phone: row.member.phone, last_name: row.member.last_name })).error, "clinic_assistance_required");
  assert.equal((await h.call("/membre/login", { credential: "attacker" })).error, "clinic_assistance_required");
  const login = await h.call("/membre/login", { credential: "valid" }); assert.equal(login.ok, true);
  const member = h.tables.get("tss-portail-membres").get(p.code + "/" + row.member.id);
  assert.equal(member.session_token.S, ""); assert.equal(member.session_token_hash.S, hash(login.token)); assert.equal(member.google_sub.S, token.sub);
  assert.equal((await h.call("/membre/code", { token: login.token })).error, "consent_required");
  member.session_expires_at.S = "2000-01-01T00:00:00.000Z";
  assert.equal((await h.call("/membre/state", { token: login.token })).error, "bad_session");
  assert.equal(h.requests.some((r) => /telegram/i.test(r.url)), false);
  assert.equal(/telegram|TG_TOKEN|TG_CHAT/i.test(readFileSync(new URL("../lambda/index.mjs", import.meta.url), "utf8")), false);
});

const streamArn = "arn:aws:dynamodb:ca-central-1:000000000000:table/tss-portail-consents/stream/2026-09-07T00:00:00.000";
const streamRecord = (image) => ({ eventSource: "aws:dynamodb", eventSourceARN: streamArn, eventName: "MODIFY", eventID: "synthetic-event", dynamodb: { SequenceNumber: "12345", NewImage: copy(image) } });
async function drain(h, maximum = 30) {
  for (let i = 0; i < maximum; i++) {
    const queued = [...h.records.values()].find((r) => /^(SYNC|WITHDRAW_SYNC)#/.test(r.sk.S) && r.queue_ready?.S === "1");
    if (!queued) return;
    await handleConsentStream({ Records: [streamRecord(queued)] }, h.service, { streamArn });
  }
  throw new Error("Synthetic queue failed to terminate");
}

test("stream alone files the signed document after browser closes; stale deliveries do not repost", async () => {
  const mock = spruceMock(), h = setup(createSpruceConsentSync({ auth: "synthetic", fetchImpl: mock.fetchImpl }));
  const signed = await h.service.accept(h.session, h.input(), h.identity);
  const initial = streamRecord([...h.records.values()].find((r) => r.sk.S.startsWith("SYNC#")));
  await drain(h);
  await handleConsentStream({ Records: [initial, initial] }, h.service, { streamArn });
  const state = await h.service.status(h.session);
  assert.equal(state.consent.sync_status, "saved"); assert.equal(state.consent.receipt_id, signed.consent.receipt_id);
  assert.equal(mock.requests.filter((r) => r.url.endsWith("/media")).length, 1);
  assert.equal(mock.requests.filter((r) => r.url.endsWith("/conversations")).length, 1);
  assert.deepEqual(h.sleeps, [2000]);
  assert.equal([...h.records.values()].some((r) => r.queue_ready?.S === "1"), false);
});

test("stream validates the exact source and complete batch; HTTP and in-progress updates cannot dispatch work", async () => {
  const image = { pk: { S: "MEMBER#" + "a".repeat(64) }, sk: { S: "SYNC#" + "b".repeat(40) }, queue_ready: { S: "1" }, sync_state: { S: "pending" } };
  let calls = 0; const service = { syncStored: async () => calls++ }, valid = streamRecord(image);
  for (const event of [
    { Records: [valid], requestContext: { http: { method: "POST" } } },
    { Records: [valid], body: "{}" },
    { Records: [{ ...valid, eventSourceARN: streamArn + "wrong" }] },
    { Records: [valid, { ...valid, eventSource: "aws:sqs" }] },
  ]) await assert.rejects(handleConsentStream(event, service, { streamArn }));
  assert.equal(calls, 0); assert.equal(isConsentStreamEvent({ rawPath: "/", Records: [valid] }), false);
  await handleConsentStream({ Records: [streamRecord({ ...image, queue_ready: { S: "0" } })] }, service, { streamArn });
  assert.equal(calls, 0);
  await handleConsentStream({ Records: [valid] }, service, { streamArn }); assert.equal(calls, 1);
});

test("concurrent stream delivery cannot acquire an active lease or repeat an external write", async () => {
  let release, entered, calls = 0;
  const began = new Promise((resolve) => { entered = resolve; }), waiting = new Promise((resolve) => { release = resolve; });
  const h = setup(async (receipt, before, persist) => { calls++; await persist({ ...before, state: "uploading" }); entered(); await waiting; await persist({ ...before, state: "uploaded", media_id: "synthetic" }); });
  await h.service.accept(h.session, h.input(), h.identity);
  const image = copy([...h.records.values()].find((r) => r.sk.S.startsWith("SYNC#"))), event = { Records: [streamRecord(image)] };
  const first = handleConsentStream(event, h.service, { streamArn }); await began;
  await assert.rejects(handleConsentStream(event, h.service, { streamArn }), /consent_worker_busy/);
  assert.equal(calls, 1); release(); await first;
  const row = h.records.get(image.pk.S + "/" + image.sk.S);
  assert.equal(row.queue_ready.S, "1"); assert.equal(row.sync_state.S, "uploaded");
});

test("automatic verification and failed reads are bounded and become visible clinical review cases", async () => {
  for (const options of [{ delayed: true }, { readFailure: true }]) {
    const mock = spruceMock(options), h = setup(createSpruceConsentSync({ auth: "synthetic", fetchImpl: mock.fetchImpl }));
    await h.service.accept(h.session, h.input(), h.identity); await drain(h);
    const status = await h.service.status(h.session); assert.equal(status.consent.sync_status, "needs_review");
    assert.equal(status.consent.can_retry_sync, false);
    const jobs = await h.service.listJobs(); assert.equal(jobs.items[0].status, "needs_review"); assert.equal(jobs.items[0].can_retry, false);
    assert.ok(h.sleeps.every((ms) => ms === 2000));
    if (options.delayed) assert.equal(mock.requests.filter((r) => r.url.includes("/items?")).length, 5);
    else assert.equal(mock.requests.filter((r) => r.url.endsWith("/contacts/search")).length, 3);
    assert.equal(JSON.stringify(jobs).includes("pdf_base64"), false); assert.equal(JSON.stringify(jobs).includes("member@example.invalid"), false);
  }
});

test("withdrawal queued before filing waits, appends an exact internal note, and preserves historical PDF", async () => {
  const mock = spruceMock(), config = { auth: "synthetic", fetchImpl: mock.fetchImpl };
  const h = setup(createSpruceConsentSync(config), { syncWithdrawal: createSpruceWithdrawalSync(config) });
  const signed = await h.service.accept(h.session, h.input(), h.identity), pdf = await h.service.download(h.session, signed.consent.receipt_id);
  await h.service.withdraw(h.session, { request_id: "synthetic-withdraw-01" });
  const initialWithdrawal = streamRecord([...h.records.values()].find((r) => r.sk.S.startsWith("WITHDRAW_SYNC#")));
  await handleConsentStream({ Records: [initialWithdrawal] }, h.service, { streamArn });
  assert.equal((await h.service.status(h.session)).consent.withdrawal_sync_status, "waiting");
  await drain(h);
  await handleConsentStream({ Records: [initialWithdrawal, initialWithdrawal] }, h.service, { streamArn });
  const state = await h.service.status(h.session);
  assert.equal(state.required, true); assert.equal(state.consent.state, "withdrawn");
  assert.equal(state.consent.sync_status, "saved"); assert.equal(state.consent.withdrawal_sync_status, "saved");
  assert.equal((await h.service.download(h.session, signed.consent.receipt_id)).base64, pdf.base64);
  const notices = mock.requests.filter((r) => r.url.endsWith("/messages")); assert.equal(notices.length, 1);
  const body = JSON.parse(notices[0].body); assert.equal(body.internal, true); assert.equal(body.attachments, undefined);
  assert.ok(body.body[0].value.includes(state.consent.withdrawn_at)); assert.ok(body.body[0].value.includes(h.identity.sub));
});

test("unknown withdrawal write is not replayed and stays visibly unconfirmed", async () => {
  const mock = spruceMock({ withdrawalTimeout: true }), config = { auth: "synthetic", fetchImpl: mock.fetchImpl };
  const h = setup(createSpruceConsentSync(config), { syncWithdrawal: createSpruceWithdrawalSync(config) });
  await h.service.accept(h.session, h.input(), h.identity); await drain(h);
  await h.service.withdraw(h.session, { request_id: "synthetic-withdraw-01" }); await drain(h);
  assert.equal((await h.service.status(h.session)).consent.withdrawal_sync_status, "needs_review");
  const job = (await h.service.listJobs()).items.find((r) => r.kind === "withdrawal");
  await h.service.syncStored(job.pk, job.job_id, job.kind);
  assert.equal(mock.requests.filter((r) => r.url.endsWith("/messages")).length, 1);
});

test("employers cannot inspect or retry clinical jobs and HTTP Records cannot invoke the worker", async () => {
  let reads = 0, worker = 0;
  const h = onboardingHarness({ consentService: { listJobs: async () => { reads++; return { ok: true, items: [] }; }, syncStored: async () => { reads++; } }, handleConsentStream: async () => { worker++; } });
  const partner = await h.create();
  assert.equal((await h.call("/admin/consents", { code: partner.code })).status, 403);
  assert.equal((await h.call("/admin/consents/retry", { code: partner.code })).status, 403);
  assert.equal(reads, 0);
  await h.api.handler({ requestContext: { http: { method: "POST" } }, rawPath: "/admin/consents", Records: [{}], body: JSON.stringify({ code: partner.code, Records: [{}] }) });
  assert.equal(worker, 0);
  assert.equal((await h.call("/admin/consents", { code: "SYNTHETIC-ADMIN" })).ok, true); assert.equal(reads, 1);
});

test("a concurrent filing completion cannot lose the withdrawal wake-up during lease release", async () => {
  const mock = spruceMock(), config = { auth: "synthetic", fetchImpl: mock.fetchImpl };
  const h = setup(createSpruceConsentSync(config), { syncWithdrawal: createSpruceWithdrawalSync(config) });
  const signed = await h.service.accept(h.session, h.input(), h.identity);
  await h.service.sync(h.session, signed.consent.receipt_id); await h.service.sync(h.session, signed.consent.receipt_id);
  await h.service.withdraw(h.session, { request_id: "synthetic-withdraw-race" });
  const original = [...h.records.values()].find((r) => r.sk.S.startsWith("SYNC#"));
  const withdrawal = [...h.records.values()].find((r) => r.sk.S.startsWith("WITHDRAW_SYNC#"));
  const send = h.db.send.bind(h.db); let interleaved = false;
  h.db.send = async (command) => {
    const result = await send(command);
    if (!interleaved && command.input.ExpressionAttributeValues?.[":state"]?.S === "waiting") {
      interleaved = true;
      original.data.S = JSON.stringify({ ...JSON.parse(original.data.S), state: "saved" }); original.sync_state.S = "saved"; original.queue_ready.S = "0";
      await h.service.syncStored(original.pk.S, signed.consent.receipt_id);
      assert.equal(withdrawal.queue_ready.S, "0", "active withdrawal lease prevents an early wake-up");
    }
    return result;
  };
  await handleConsentStream({ Records: [streamRecord(withdrawal)] }, h.service, { streamArn });
  assert.equal(interleaved, true); assert.equal(withdrawal.sync_state.S, "pending"); assert.equal(withdrawal.queue_ready.S, "1");
  await drain(h); assert.equal((await h.service.status(h.session)).consent.withdrawal_sync_status, "saved");
});

test("concurrent identical withdrawal requests append one event and admin cursors accept receipt scan boundaries", async () => {
  const h = setup(); await h.service.accept(h.session, h.input(), h.identity);
  await Promise.all([h.service.withdraw(h.session, { request_id: "synthetic-withdraw-race" }), h.service.withdraw(h.session, { request_id: "synthetic-withdraw-race" })]);
  assert.equal([...h.records.values()].filter((r) => r.sk.S.startsWith("WITHDRAWAL#")).length, 1);
  const saved = [...h.records.values()].find((r) => r.sk.S.startsWith("RECEIPT#"));
  const cursor = Buffer.from(JSON.stringify({ pk: saved.pk, sk: saved.sk })).toString("base64url");
  assert.equal((await h.service.listJobs(cursor)).ok, true);
  await assert.rejects(h.service.listJobs("bad-cursor"), { consentCode: "invalid_cursor" });
});

test("pinned Google verifier checks cryptographic signatures, audience and issuer without external calls", async () => {
  const { OAuth2Client } = createRequire(new URL("../lambda/package.json", import.meta.url))("google-auth-library");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const client = new OAuth2Client("synthetic-client");
  client.getFederatedSignonCertsAsync = async () => ({ certs: { synthetic: publicKey.export({ type: "spki", format: "pem" }) }, format: "PEM" });
  const payload = { sub: "synthetic-sub", iss: "https://accounts.google.com", aud: "synthetic-client", email: "patient@example.invalid", email_verified: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
  const token = (body) => { const unsigned = Buffer.from(JSON.stringify({ alg: "RS256", kid: "synthetic" })).toString("base64url") + "." + Buffer.from(JSON.stringify(body)).toString("base64url"); return unsigned + "." + createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url"); };
  assert.equal((await client.verifyIdToken({ idToken: token(payload), audience: "synthetic-client" })).getPayload().sub, "synthetic-sub");
  await assert.rejects(client.verifyIdToken({ idToken: token({ ...payload, iss: "https://attacker.invalid" }), audience: "synthetic-client" }));
  await assert.rejects(client.verifyIdToken({ idToken: token(payload), audience: "another-client" }));
  const parts = token(payload).split("."); parts[1] = Buffer.from(JSON.stringify({ ...payload, sub: "attacker" })).toString("base64url");
  await assert.rejects(client.verifyIdToken({ idToken: parts.join("."), audience: "synthetic-client" }));
});

test("an employer changing a linked member's email cannot rebind their Google identity or obtain their session", async () => {
  const owner = { sub: "linked-member-sub", iss: "https://accounts.google.com", email: "driver1@example.invalid", email_verified: true, exp: Date.now() / 1000 + 3600, iat: Math.floor(Date.now() / 1000) };
  const attacker = { ...owner, sub: "employer-attacker-sub", email: "employer@example.invalid" };
  const h = onboardingHarness({ googleTokens: { owner, attacker } });
  const partner = await h.create();
  const created = await h.call("/member", { code: partner.code, ...h.person(1) });
  h.pay(partner.code, 1); await h.call("/enrol/complete", { session_id: "cs_synthetic" });
  const originalLogin = await h.call("/membre/login", { credential: "owner" }); assert.equal(originalLogin.ok, true);
  const changed = await h.call("/member/update", { code: partner.code, id: created.member.id, email: attacker.email, google_sub: attacker.sub, google_iss: attacker.iss, google_email: attacker.email });
  assert.equal(changed.ok, true);
  const stored = h.tables.get("tss-portail-membres").get(partner.code + "/" + created.member.id);
  assert.equal(stored.email.S, attacker.email); assert.equal(stored.google_sub.S, owner.sub); assert.equal(stored.google_iss.S, owner.iss); assert.equal(stored.google_email.S, owner.email);
  const denied = await h.call("/membre/login", { credential: "attacker" });
  assert.equal(denied.status, 403); assert.equal(denied.error, "clinic_assistance_required"); assert.equal(denied.token, undefined);
  assert.equal(stored.session_token_hash.S, hash(originalLogin.token));
  const valid = await h.call("/membre/login", { credential: "owner" });
  assert.equal(valid.ok, true); assert.equal(JSON.parse(stored.session_actor.S).sub, owner.sub); assert.equal(stored.google_sub.S, owner.sub);
});
