import { createHash } from "node:crypto";

const spruceConsentHash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const spruceConsentPhone = (value) => String(value || "").replace(/\D/g, "").slice(-10);
const spruceConsentName = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Contracts: developer.sprucehealth.com/reference/uploadmedia,
// createconversation, conversation and conversationitems. Note conversations
// and internal messages are explicitly selected; this never sends to patients.
function createSpruceConsentTransport({ auth, fetchImpl = fetch }) {
  async function api(path, { method = "GET", body, idempotencyKey, multipart = false } = {}) {
    if (!auth) throw new Error("spruce_unavailable");
    const response = await fetchImpl("https://api.sprucehealth.com/v1" + path, {
      method, headers: { Authorization: auth, Accept: "application/json", ...(multipart ? {} : { "Content-Type": "application/json" }), ...(idempotencyKey ? { "s-idempotency-key": idempotencyKey } : {}) },
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body), signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error("spruce_http_" + response.status);
    return response.json();
  }
  async function uniqueContact(patient) {
    const phone = spruceConsentPhone(patient.phone), email = String(patient.email || "").toLowerCase();
    if (phone.length !== 10 || !email) throw new Error("identity_review");
    const hits = new Map();
    for (const freeText of ["+1" + phone, phone, email]) {
      const result = await api("/contacts/search", { method: "POST", body: { freeText } });
      if (!Array.isArray(result.contacts) || result.hasMore) throw new Error("identity_review");
      for (const contact of result.contacts) {
        const samePhone = (contact.phoneNumbers || []).some((p) => spruceConsentPhone(p.value) === phone);
        const sameEmail = (contact.emailAddresses || []).some((e) => String(e.value || "").toLowerCase() === email);
        if (samePhone || sameEmail) hits.set(contact.id, { contact, samePhone, sameEmail });
      }
    }
    if (hits.size !== 1) throw new Error("identity_review");
    const match = [...hits.values()][0];
    if (!match.contact.id || !match.samePhone || !match.sameEmail || match.contact.category !== "patient" || !spruceConsentName(patient.first_name) || !spruceConsentName(patient.last_name) || spruceConsentName(match.contact.givenName) !== spruceConsentName(patient.first_name) || spruceConsentName(match.contact.familyName) !== spruceConsentName(patient.last_name)) throw new Error("identity_review");
    return match.contact.id;
  }
  return { api, uniqueContact };
}

export function createSpruceConsentSync({ auth, fetchImpl = fetch }) {
  const { api, uniqueContact } = createSpruceConsentTransport({ auth, fetchImpl });
  return async function syncConsentToSpruce(receipt, previous, persist) {
    let stage = { ...(previous || {}), receipt_id: receipt.receipt_id, state: previous?.state || "pending" };
    const save = async (changes) => { stage = { ...stage, ...changes, updated_at: new Date().toISOString() }; await persist(stage); };
    const filename = "Consentement-TSS-" + receipt.receipt_id + ".pdf";
    const marker = "TSS-CONSENT:" + receipt.receipt_id + ":" + receipt.pdf_hash;
    try {
      // Current phone AND email must identify one and the same patient. A
      // previous local association is never a substitute for the direct check.
      const contactId = await uniqueContact(receipt.patient);
      if (stage.contact_id && stage.contact_id !== contactId) throw new Error("identity_review");
      stage.contact_id = contactId;
      if (!stage.media_id) {
        await save({ state: "uploading", detail: "Copie signée conservée; téléversement clinique à confirmer." });
        const form = new FormData(); form.append("media", new Blob([Buffer.from(receipt.pdf_base64, "base64")], { type: "application/pdf" }), filename);
        const media = await api("/media", { method: "POST", multipart: true, body: form });
        if (!media.id) throw new Error("media_response_unknown");
        await save({ state: "uploaded", media_id: media.id, detail: "Document téléversé; association au dossier à confirmer." });
        return;
      }
      if (!stage.conversation_id) {
        await save({ state: "posting", detail: "Dépôt de la note interne en cours de vérification." });
        const result = await api("/conversations", { method: "POST", idempotencyKey: "tss-consent-" + receipt.receipt_id, body: { type: "note", note: {
          associatedContactIds: [contactId], title: "Truck Stop Santé — consentement signé — " + receipt.version,
          message: { internal: true, body: [{ type: "text", value: "Consentement personnel signé dans le portail. Version " + receipt.version + ", date " + receipt.accepted_at + ". Document historique joint; tout retrait ultérieur est enregistré séparément.\n" + marker }], attachments: [{ attachmentId: stage.media_id, title: filename }] },
        } } });
        if (!result.conversation?.id) throw new Error("conversation_response_unknown");
        await save({ state: "verifying", conversation_id: result.conversation.id, post_request_id: result.postMessageRequestId || "", detail: "Note créée; pièce jointe encore à vérifier." });
        return;
      }
      const found = await api("/conversations/" + encodeURIComponent(stage.conversation_id));
      const conversation = found.conversation;
      if (conversation?.type !== "note" || conversation.id !== stage.conversation_id || conversation.associatedContactIds?.length !== 1 || conversation.associatedContactIds[0] !== contactId || (conversation.externalParticipants || []).length) throw new Error("note_identity_review");
      const result = await api("/conversations/" + encodeURIComponent(stage.conversation_id) + "/items?pageSize=200&order=newest_first");
      if (!Array.isArray(result.conversationItems)) throw new Error("items_response_unknown");
      const matching = result.conversationItems.filter((item) => item.conversationId === stage.conversation_id && item.isInternalNote === true && item.text?.includes(marker) && (!stage.post_request_id || item.requestId === stage.post_request_id));
      if (!matching.length) { await save({ state: "verifying", detail: "Spruce prépare encore la pièce jointe. Vous pouvez reprendre la vérification." }); return; }
      if (matching.length !== 1) throw new Error("duplicate_note_review");
      const attachments = (matching[0].attachments || []).filter((attachment) => attachment.type === "document" && attachment.data?.mimetype === "application/pdf" && (attachment.data.name === filename || attachment.title === filename));
      if (attachments.length !== 1) throw new Error("attachment_review");
      const signedUrl = attachments[0].data.signedUrl;
      const url = new URL(signedUrl?.url);
      const trustedHost = url.hostname.endsWith(".sprucehealth.com") || url.hostname.endsWith(".amazonaws.com") || url.hostname.endsWith(".cloudfront.net") || url.hostname === "storage.googleapis.com";
      if (url.protocol !== "https:" || url.username || url.password || !trustedHost) throw new Error("attachment_url_review");
      if (signedUrl.expiresAt && Date.parse(signedUrl.expiresAt) <= Date.now()) throw new Error("attachment_download_unavailable");
      // Never send the Spruce credential to a signed download URL.
      const downloaded = await fetchImpl(url.href, { signal: AbortSignal.timeout(4000), redirect: "error" });
      if (!downloaded.ok) throw new Error("attachment_download_unavailable");
      const length = Number(downloaded.headers?.get("content-length") || 0);
      if (length > 2 * 1024 * 1024) throw new Error("attachment_hash_review");
      const bytes = Buffer.from(await downloaded.arrayBuffer());
      if (bytes.length > 2 * 1024 * 1024 || spruceConsentHash(bytes) !== receipt.pdf_hash) throw new Error("attachment_hash_review");
      await save({ state: "saved", conversation_item_id: matching[0].id, saved_at: new Date().toISOString(), detail: "Copie signée et pièce jointe vérifiées dans votre dossier clinique Spruce." });
    } catch (error) {
      const uncertainWrite = ["uploading", "posting"].includes(stage.state);
      const manual = uncertainWrite || /review|response_unknown/.test(error.message);
      await save({ state: manual ? "needs_review" : stage.conversation_id ? "verifying" : "failed", detail: manual ? "La copie signée est conservée. La clinique doit vérifier son association au dossier; aucun nouvel envoi automatique ne sera fait." : "La copie signée est conservée. Le dépôt au dossier n’est pas confirmé; vous pouvez reprendre la vérification." });
    }
  };
}

// Primary contract: /reference/postconversationmessage. This appends an
// internal clinical notice; it cannot overwrite the historical signed PDF.
export function createSpruceWithdrawalSync({ auth, fetchImpl = fetch }) {
  const { api, uniqueContact } = createSpruceConsentTransport({ auth, fetchImpl });
  return async function syncWithdrawalToSpruce(receipt, withdrawal, original, previous, persist) {
    let stage = { ...previous, conversation_id: original.conversation_id, contact_id: original.contact_id };
    const save = async (changes) => { stage = { ...stage, ...changes, updated_at: new Date().toISOString() }; await persist(stage); };
    const marker = "TSS-WITHDRAWAL:" + withdrawal.withdrawal_id + ":" + receipt.receipt_id;
    const notice = "Retrait du consentement du portail Truck Stop Santé, enregistré le " + withdrawal.withdrawn_at + " (UTC). Déclaration de la personne authentifiée : " + withdrawal.signer_name + ". Compte : " + withdrawal.actor.email + ". Identité de compte : " + withdrawal.actor.iss + " / " + withdrawal.actor.sub + ". Version retirée : " + receipt.version + ". Ce retrait vise les usages futurs du portail; il ne supprime pas la copie historique signée et ne vaut pas une décision sur tous les soins directs.\n" + marker;
    try {
      const contactId = await uniqueContact(receipt.patient);
      if (contactId !== original.contact_id || !original.conversation_id) throw new Error("withdrawal_identity_review");
      const result = await api("/conversations/" + encodeURIComponent(original.conversation_id));
      const conversation = result.conversation;
      if (conversation?.id !== original.conversation_id || conversation.type !== "note" || conversation.associatedContactIds?.length !== 1 || conversation.associatedContactIds[0] !== contactId || (conversation.externalParticipants || []).length) throw new Error("withdrawal_identity_review");
      if (!stage.post_request_id) {
        await save({ state: "posting", detail: "Retrait enregistré; dépôt de la note interne en cours de vérification." });
        const posted = await api("/conversations/" + encodeURIComponent(original.conversation_id) + "/messages", { method: "POST", idempotencyKey: "tss-withdrawal-" + withdrawal.withdrawal_id, body: { internal: true, stayArchived: false, body: [{ type: "text", value: notice }] } });
        if (!posted.requestId) throw new Error("withdrawal_response_unknown");
        await save({ state: "verifying", post_request_id: posted.requestId, detail: "Note de retrait transmise; présence au dossier en cours de vérification." });
        return;
      }
      const items = await api("/conversations/" + encodeURIComponent(original.conversation_id) + "/items?pageSize=200&order=newest_first");
      if (!Array.isArray(items.conversationItems)) throw new Error("withdrawal_response_unknown");
      const matches = items.conversationItems.filter((item) => item.conversationId === original.conversation_id && item.isInternalNote === true && item.requestId === stage.post_request_id && item.text === notice);
      if (!matches.length) { await save({ state: "verifying", detail: "Spruce prépare encore la note de retrait. Vérification en attente." }); return; }
      if (matches.length !== 1) throw new Error("withdrawal_duplicate_review");
      await save({ state: "saved", conversation_item_id: matches[0].id, saved_at: new Date().toISOString(), detail: "Retrait vérifié dans le dossier clinique Spruce. La copie signée historique est conservée." });
    } catch (error) {
      const manual = stage.state === "posting" || /review|response_unknown/.test(error.message);
      await save({ state: manual ? "needs_review" : stage.post_request_id ? "verifying" : "failed", detail: manual ? "Retrait conservé dans le portail. La clinique doit vérifier sa présence au dossier; aucun nouvel envoi automatique ne sera fait." : "Retrait conservé; sa présence au dossier clinique reste à confirmer." });
    }
  };
}
