const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./onboarding-harness.cjs');
// Contact creation and invitations only: membership/company tagging (tags, contact GET/PATCH) is expected on every resolved contact.
const spruceWrites = h => h.requests.filter(r => r.url.includes('sprucehealth.com') && (r.url.endsWith('/v1/contacts') || r.url.endsWith('/invite')));

test('signup + roster + checkout never invite before payment; duplicate email exposes no code', async () => {
  const h = harness(), p = await h.create(); assert.equal(p.ok, true);
  const duplicate = await h.create(); assert.equal(duplicate.status, 409); assert.equal(duplicate.code, undefined); assert.equal(duplicate.partner, undefined);
  const r = await h.call('/members/bulk', { code: p.code, members: [h.person(1), h.person(2)] });
  assert.equal(r.resume.en_attente_paiement, 2); assert.equal(r.actifs, 0); assert.equal(spruceWrites(h).length, 0);
  const checkout = await h.call('/billing/checkout', { code: p.code }); assert.equal(checkout.quantity, 2);
  assert.equal(new URLSearchParams(h.requests.find(r => r.url.endsWith('/v1/checkout/sessions')).body).get('line_items[0][quantity]'), '2');
  h.pay(p.code, 2, { payment_status: 'unpaid' });
  assert.equal((await h.call('/enrol/complete', { session_id: 'cs_synthetic' })).error, 'not_paid');
  assert.equal(spruceWrites(h).length, 0);
});
test('paid activation is bounded by paid seats; retries and concurrent callbacks do not invite twice', async () => {
  const h = harness(), p = await h.create();
  await h.call('/members/bulk', { code: p.code, members: [h.person(1), h.person(2)] });
  h.pay(p.code, 1);
  await Promise.all([h.call('/enrol/complete', { session_id: 'cs_synthetic' }), h.call('/enrol/complete', { session_id: 'cs_synthetic' })]);
  const again = await h.call('/enrol/complete', { session_id: 'cs_synthetic' });
  assert.equal(again.actifs, 1); assert.equal(again.activation.pending_remaining, 1); assert.equal(again.activation.payment_required, true);
  assert.equal(h.requests.filter(r => r.url.endsWith('/v1/contacts')).length, 1);
  assert.equal(h.requests.filter(r => r.url.endsWith('/invite')).length, 2);
  const late = await h.call('/member', { code: p.code, ...h.person(3) });
  assert.equal(late.stripe.reason, 'initial_payment_required');
  assert.equal(late.actifs, 1); assert.equal(h.subscriptions.get('sub_synthetic').items.data[0].quantity, 1);
});
test('search failure stops contact creation; existing Spruce contact gets no invite; lookup includes phone AND email', async () => {
  for (const mode of ['failure', 'existing']) {
    const h = harness(), p = await h.create(), driver = h.person(1);
    await h.call('/member', { code: p.code, ...driver }); h.pay(p.code, 1);
    if (mode === 'failure') h.state.searchFailure = true;
    else h.state.existingContact = { id: 'existing', phoneNumbers: [{ value: driver.phone }], emailAddresses: [{ value: driver.email }], hasAccount: false, hasPendingInvite: false };
    await h.call('/enrol/complete', { session_id: 'cs_synthetic' });
    assert.equal(spruceWrites(h).length, 0);
    if (mode === 'existing') assert.ok(h.requests.some(r => r.url.endsWith('/search') && JSON.parse(r.body).freeText === driver.email));
  }
});
test('other products, oversized batches, empty checkout and unpaid reactivation cannot bypass payment', async () => {
  const h = harness(), p = await h.create();
  assert.equal((await h.call('/billing/checkout', { code: p.code })).error, 'no_members');
  assert.equal((await h.call('/members/bulk', { code: p.code, members: Array.from({ length: 6 }, (_, i) => h.person(i + 1)) })).error, 'batch_too_large');
  const row = await h.call('/member', { code: p.code, ...h.person(1) });
  assert.equal((await h.call('/member/status', { code: p.code, id: row.member.id, status: 'pause' })).error, 'not_active');
  await h.call('/member/status', { code: p.code, id: row.member.id, status: 'retire' });
  const resumed = await h.call('/member/status', { code: p.code, id: row.member.id, status: 'actif' });
  assert.equal(resumed.status, 'en_attente_paiement'); assert.equal(spruceWrites(h).length, 0);
  h.pay(p.code, 1).subscription.items.data[0].price.id = 'price_m28';
  assert.equal((await h.call('/enrol/complete', { session_id: 'cs_synthetic' })).error, 'not_paid');
  assert.equal(spruceWrites(h).length, 0);
});
test('existing paid subscriber additions update Stripe first; failed billing leaves new driver pending', async () => {
  const h = harness(), p = await h.create();
  await h.call('/member', { code: p.code, ...h.person(1) }); h.pay(p.code, 1);
  await h.call('/enrol/complete', { session_id: 'cs_synthetic' });
  const added = await h.call('/member', { code: p.code, ...h.person(2) });
  assert.equal(added.member.status, 'actif'); assert.equal(h.subscriptions.get('sub_synthetic').items.data[0].quantity, 2);
  h.state.billingFailure = true;
  const failed = await h.call('/member', { code: p.code, ...h.person(3) });
  assert.equal(failed.member.status, 'en_attente_paiement'); assert.equal(failed.stripe.reason, 'billing_update_failed');
  assert.equal(h.requests.filter(r => r.url.endsWith('/v1/contacts')).length, 2);
});
test('explicit Stripe invoice mode and demo stay supported', async () => {
  const h = harness(), p = await h.create();
  await h.call('/member', { code: p.code, ...h.person(1) }); const session = h.pay(p.code, 1);
  await h.call('/enrol/complete', { session_id: session.id });
  const sub = h.subscriptions.get('sub_synthetic'); sub.collection_method = 'send_invoice'; sub.latest_invoice = { paid: false, status: 'open' };
  const added = await h.call('/member', { code: p.code, ...h.person(2) }); assert.equal(added.member.status, 'actif');
  const demo = await h.call('/admin/partner', { code: 'SYNTHETIC-ADMIN', name: 'Synthetic Demo', demo: 'oui' });
  const before = h.requests.length;
  const d = await h.call('/member', { code: demo.partner.code, ...h.person(3) }); assert.equal(d.member.status, 'actif'); assert.equal(h.requests.length, before);
});
test('uncertain contact creation is never automatically replayed and admin cannot bypass unpaid coverage', async () => {
  const h = harness(), p = await h.create();
  const row = await h.call('/member', { code: p.code, ...h.person(1) });
  assert.equal((await h.call('/admin/member/spruce', { code: 'SYNTHETIC-ADMIN', partner_code: p.code, id: row.member.id, action: 'inviter' })).error, 'payment_required');
  h.pay(p.code, 1); h.state.createTimeout = true;
  await h.call('/enrol/complete', { session_id: 'cs_synthetic' });
  await h.call('/admin/member/spruce', { code: 'SYNTHETIC-ADMIN', partner_code: p.code, id: row.member.id, action: 'inviter' });
  assert.equal(h.requests.filter(r => r.url.endsWith('/v1/contacts')).length, 1);
  const stored = h.tables.get('tss-portail-membres').get(p.code + '/' + row.member.id);
  assert.equal(stored.spruce_attempt_state.S, 'needs_review');
});
test('partial invitation reports only confirmed channel and retired person can re-enroll', async () => {
  const h = harness(), p = await h.create();
  const row = await h.call('/member', { code: p.code, ...h.person(1) }); h.pay(p.code, 1); h.state.emailFailure = true;
  await h.call('/enrol/complete', { session_id: 'cs_synthetic' });
  const stored = h.tables.get('tss-portail-membres').get(p.code + '/' + row.member.id);
  assert.equal(stored.spruce_detail.S, 'texto : envoi confirmé; autre envoi non confirmé');
  await h.call('/member/status', { code: p.code, id: row.member.id, status: 'retire' });
  const again = await h.call('/member', { code: p.code, ...h.person(1) });
  assert.equal(again.ok, true); assert.notEqual(again.member.id, row.member.id);
});
test('concurrent duplicate phone cannot create two roster entries or duplicate Spruce contacts', async () => {
  const h = harness(), p = await h.create(); const a = h.person(1), b = { ...h.person(2), phone: a.phone };
  const results = await Promise.all([h.call('/member', { code: p.code, ...a }), h.call('/member', { code: p.code, ...b })]);
  assert.equal(results.filter(r => r.ok).length, 1); assert.equal(results.filter(r => r.error === 'duplicate').length, 1);
  h.pay(p.code, 2); await h.call('/enrol/complete', { session_id: 'cs_synthetic' });
  assert.equal(h.requests.filter(r => r.url.endsWith('/v1/contacts')).length, 1);
});
test('only one payable checkout exists per partner; roster change expires the previous session', async () => {
  const h = harness(), p = await h.create(); await h.call('/member', { code: p.code, ...h.person(1) });
  const [a, busy] = await Promise.all([h.call('/billing/checkout', { code: p.code }), h.call('/billing/checkout', { code: p.code })]);
  assert.ok([a, busy].some(r => r.ok)); assert.ok([a, busy].some(r => r.error === 'checkout_busy'));
  const first = await h.call('/billing/checkout', { code: p.code });
  assert.equal(h.sessions.size, 1);
  await h.call('/member', { code: p.code, ...h.person(2) });
  const replacement = await h.call('/billing/checkout', { code: p.code });
  assert.notEqual(first.url, replacement.url); assert.equal(h.sessions.get('cs_created_1').status, 'expired');
  assert.equal([...h.sessions.values()].filter(s => s.status === 'open').length, 1);
});
test('extra initial seats recover through paid Stripe invoice without activating unpaid quantity', async () => {
  const h = harness(), p = await h.create(); await h.call('/members/bulk', { code: p.code, members: [h.person(1), h.person(2)] });
  h.pay(p.code, 1); await h.call('/enrol/complete', { session_id: 'cs_synthetic' });
  const recovery = await h.call('/billing/checkout', { code: p.code });
  assert.equal(recovery.url, 'https://invoice.stripe.com/synthetic');
  const waiting = await h.call('/enrol/activate', { code: p.code }); assert.equal(waiting.activated, 0);
  const sub = h.subscriptions.get('sub_synthetic'); sub.items.data[0].quantity = sub.pending_update.quantity; delete sub.pending_update; sub.latest_invoice.paid = true; sub.latest_invoice.status = 'paid';
  const paid = await h.call('/enrol/activate', { code: p.code }); assert.equal(paid.activated, 1); assert.equal(paid.pending_remaining, 0);
});
test('two partners cannot concurrently create or invite the same Spruce identity', async () => {
  const h = harness(), base = h.pay('unused', 1).subscription;
  const a = await h.call('/admin/partner', { code: 'SYNTHETIC-ADMIN', name: 'Synthetic A', stripe_subscription_id: 'sub_a' });
  const b = await h.call('/admin/partner', { code: 'SYNTHETIC-ADMIN', name: 'Synthetic B', stripe_subscription_id: 'sub_b' });
  h.subscriptions.set('sub_a', { ...base, id: 'sub_a' }); h.subscriptions.set('sub_b', { ...base, id: 'sub_b' });
  const result = await Promise.all([h.call('/member', { code: a.partner.code, ...h.person(1) }), h.call('/member', { code: b.partner.code, ...h.person(1) })]);
  assert.equal(h.requests.filter(r => r.url.endsWith('/v1/contacts')).length, 1);
  assert.equal(h.requests.filter(r => r.url.endsWith('/invite')).length, 2);
  assert.ok(result.some(r => r.member.spruce_attempt_state === 'needs_review'));
});
test('every resolved Spruce contact gets TSQ_membership + company tag, merged with existing tags; tag failure never changes the invite', async () => {
  const members = h => [...h.tables.get('tss-portail-membres').values()].filter(m => m.id.S.startsWith('member-'));
  // New contact: created, invited, then tagged.
  let h = harness(), p = await h.create();
  await h.call('/member', { code: p.code, ...h.person(1) }); h.pay(p.code, 1);
  await h.call('/enrol/complete', { session_id: 'cs_synthetic' });
  let tagged = Object.values(h.state.contactTags); assert.equal(tagged.length, 1);
  assert.deepEqual(tagged[0].sort(), ['tag_Synthetic_Fleet', 'tag_TSQ_membership']);
  assert.equal(members(h)[0].spruce.S, 'invite'); assert.ok(members(h)[0].spruce_tagged_at?.S);
  // Existing contact with an unrelated tag: no invite, tags merged (never wiped).
  h = harness(); p = await h.create(); const driver = h.person(1);
  h.state.existingContact = { id: 'existing', phoneNumbers: [{ value: driver.phone }], emailAddresses: [{ value: driver.email }], hasAccount: true, hasPendingInvite: false };
  h.state.contactTags.existing = ['tag_ADHD'];
  await h.call('/member', { code: p.code, ...driver }); h.pay(p.code, 1);
  await h.call('/enrol/complete', { session_id: 'cs_synthetic' });
  assert.deepEqual(h.state.contactTags.existing.sort(), ['tag_ADHD', 'tag_Synthetic_Fleet', 'tag_TSQ_membership']);
  assert.equal(spruceWrites(h).length, 0);
  // Solo payer whose "company" is their own name: membership tag only.
  h = harness(); p = await h.call('/partner/create', { name: 'David Solo', contact_name: 'DAVID SOLO', contact_email: 'solo@example.invalid' });
  await h.call('/member', { code: p.code, ...h.person(1) }); h.pay(p.code, 1, { customer_details: { email: 'solo@example.invalid', name: 'DAVID SOLO' } });
  await h.call('/enrol/complete', { session_id: 'cs_synthetic' });
  assert.deepEqual(Object.values(h.state.contactTags)[0], ['tag_TSQ_membership']);
  // Tagging outage: invitation result unchanged, no tagged timestamp.
  h = harness(); p = await h.create(); h.state.tagFailure = true;
  await h.call('/member', { code: p.code, ...h.person(1) }); h.pay(p.code, 1);
  await h.call('/enrol/complete', { session_id: 'cs_synthetic' });
  assert.equal(members(h)[0].spruce.S, 'invite'); assert.equal(members(h)[0].spruce_tagged_at, undefined);
});
