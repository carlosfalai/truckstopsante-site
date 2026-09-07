// Only Lambda's configured DynamoDB event source may execute stored jobs.
// HTTP requests are never interpreted as stream records, including body.Records.
export function isConsentStreamEvent(event) {
  return !event?.requestContext && !event?.rawPath && !event?.httpMethod && !Object.hasOwn(event || {}, "body") && Array.isArray(event?.Records);
}

export async function handleConsentStream(event, service, { streamArn = process.env.CONSENT_STREAM_ARN } = {}) {
  if (!isConsentStreamEvent(event) || !streamArn || !event.Records.length || event.Records.length > 5) throw new Error("invalid_consent_stream_event");
  // Validate the entire batch before doing any work.
  for (const record of event.Records) {
    if (record.eventSource !== "aws:dynamodb" || record.eventSourceARN !== streamArn || !["INSERT", "MODIFY"].includes(record.eventName)) throw new Error("invalid_consent_stream_source");
    const image = record.dynamodb?.NewImage, pk = image?.pk?.S, sk = image?.sk?.S;
    if (!/^MEMBER#[a-f0-9]{64}$/.test(pk || "") || !/^(SYNC|WITHDRAW_SYNC)#[a-f0-9]{40}$/.test(sk || "")) throw new Error("invalid_consent_stream_key");
  }
  for (const record of event.Records) {
    const image = record.dynamodb.NewImage;
    if (image.queue_ready?.S !== "1" || !["pending", "uploaded", "verifying", "failed"].includes(image.sync_state?.S)) continue;
    const [prefix, id] = image.sk.S.split("#");
    await service.syncStored(image.pk.S, id, prefix === "SYNC" ? "consent" : "withdrawal", true);
  }
  return { ok: true };
}
