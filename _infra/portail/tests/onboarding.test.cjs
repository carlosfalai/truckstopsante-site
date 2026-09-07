// Synthetic regression tests. Every database and network operation is intercepted;
// no credentials, live customers, messages or charges are used.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

function harness() {
  const tables = new Map(), requests = [], subscriptions = new Map(), sessions = new Map(), checkouts = new Map(); let checkoutNumber = 0;
  const state = { searchFailure: false, existingContact: null, billingFailure: false, createTimeout: false, emailFailure: false };
  const key = o => o.partner_code ? o.partner_code.S + '/' + o.id.S : o.code.S;
  const table = name => { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name); };
  const conditionalError = () => Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' });
  const clone = o => JSON.parse(JSON.stringify(o));
  const classes = {};
  for (const name of ['GetItemCommand', 'PutItemCommand', 'UpdateItemCommand', 'QueryCommand', 'ScanCommand', 'DeleteItemCommand']) classes[name] = class { constructor(input) { this.input = input; this.command = name; } };
  classes.DynamoDBClient = class { async send(cmd) {
    const a = cmd.input, t = table(a.TableName);
    if (cmd.command === 'GetItemCommand') return { Item: t.has(key(a.Key)) ? clone(t.get(key(a.Key))) : undefined };
    if (cmd.command === 'ScanCommand') return { Items: [...t.values()].map(clone) };
    if (cmd.command === 'QueryCommand') return { Items: [...t.values()].filter(x => x.partner_code.S === a.ExpressionAttributeValues[':p'].S).map(clone) };
    if (cmd.command === 'PutItemCommand') { const k = key(a.Item); if (a.ConditionExpression && t.has(k)) throw conditionalError(); t.set(k, clone(a.Item)); return {}; }
    if (cmd.command === 'DeleteItemCommand') { t.delete(key(a.Key)); return {}; }
    if (cmd.command === 'UpdateItemCommand') {
      const k = key(a.Key), item = t.get(k) || clone(a.Key), names = a.ExpressionAttributeNames || {}, values = a.ExpressionAttributeValues || {};
      if (a.ConditionExpression && a.ConditionExpression.includes('#attempt')) {
        const old = item[names['#attempt']]?.S;
        if (old && old !== values[':retry'].S) throw conditionalError();
      }
      if (a.ConditionExpression?.startsWith('attribute_not_exists(activation_lock_until)') && item.activation_lock_until?.S && item.activation_lock_until.S >= values[':now'].S) throw conditionalError();
      if (a.ConditionExpression === 'activation_lock_owner = :owner' && item.activation_lock_owner?.S !== values[':owner'].S) throw conditionalError();
      if (a.ConditionExpression?.startsWith('attribute_not_exists(checkout_lock_until)') && item.checkout_lock_until?.S && item.checkout_lock_until.S >= values[':now'].S) throw conditionalError();
      if (a.ConditionExpression === 'checkout_lock_owner = :owner' && item.checkout_lock_owner?.S !== values[':owner'].S) throw conditionalError();
      if (a.ConditionExpression === '#status = :pending' && item.status?.S !== values[':pending'].S) throw conditionalError();
      if (a.ConditionExpression === 'attribute_not_exists(#lock) OR #lock = :released' && item.lock_state?.S && item.lock_state.S !== values[':released'].S) throw conditionalError();
      if (a.ConditionExpression === 'lock_owner = :owner' && item.lock_owner?.S !== values[':owner'].S) throw conditionalError();
      if (a.ConditionExpression?.startsWith('attribute_not_exists(stripe_subscription_id)') && item.stripe_subscription_id?.S && item.stripe_subscription_id.S !== values[':subscription'].S) throw conditionalError();
      for (const entry of a.UpdateExpression.replace(/^SET /, '').split(/,\s*/)) {
        const [field, value] = entry.split(/\s*=\s*/);
        item[names[field] || field] = clone(values[value]);
      }
      t.set(k, item); return {};
    }
    throw new Error('Unimplemented database command: ' + cmd.command);
  } };
  const json = (obj, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => clone(obj) });
  async function fakeFetch(url, opts = {}) {
    const u = new URL(url), method = opts.method || 'GET'; requests.push({ url, method, body: opts.body });
    if (u.hostname === 'api.stripe.com') {
      if (u.pathname === '/v1/checkout/sessions' && method === 'POST') {
        const idem = opts.headers['Idempotency-Key'];
        if (checkouts.has(idem)) return json(checkouts.get(idem));
        const s = { id: 'cs_created_' + (++checkoutNumber), status: 'open', url: 'https://checkout.stripe.com/synthetic/' + checkoutNumber };
        checkouts.set(idem, s); sessions.set(s.id, s); return json(s);
      }
      if (/\/v1\/checkout\/sessions\/[^/]+\/expire$/.test(u.pathname)) { const s = sessions.get(u.pathname.split('/').at(-2)); s.status = 'expired'; return json(s); }
      if (u.pathname.startsWith('/v1/checkout/sessions/')) return json(sessions.get(u.pathname.split('/').pop()) || {}, sessions.has(u.pathname.split('/').pop()) ? 200 : 404);
      if (u.pathname.startsWith('/v1/subscriptions/') && method === 'POST') {
        const s = subscriptions.get(u.pathname.split('/').pop()), p = new URLSearchParams(opts.body);
        assert.equal(p.get('proration_behavior'), 'always_invoice'); assert.equal(p.get('payment_behavior'), 'pending_if_incomplete');
        s.pending_update = { quantity: Number(p.get('items[0][quantity]')) };
        s.latest_invoice = { id: 'in_adjustment', paid: false, status: 'open', hosted_invoice_url: 'https://invoice.stripe.com/synthetic' };
        return json(s);
      }
      if (u.pathname.startsWith('/v1/subscriptions/')) return json(subscriptions.get(u.pathname.split('/').pop()) || {}, subscriptions.has(u.pathname.split('/').pop()) ? 200 : 404);
      if (u.pathname.startsWith('/v1/subscription_items/')) {
        if (state.billingFailure) return json({ error: { message: 'synthetic failure' } }, 503);
        const params = new URLSearchParams(opts.body);
        for (const sub of subscriptions.values()) for (const item of sub.items.data) if (item.id === u.pathname.split('/').pop()) item.quantity = Number(params.get('quantity'));
        return json({ id: u.pathname.split('/').pop() });
      }
      throw new Error('Unexpected synthetic Stripe request: ' + u.pathname);
    }
    if (u.hostname === 'api.sprucehealth.com') {
      if (u.pathname === '/v1/contacts/search') return state.searchFailure ? json({}, 503) : json({ contacts: state.existingContact ? [state.existingContact] : [] });
      if (u.pathname === '/v1/contacts') { if (state.createTimeout) throw new Error('synthetic uncertain timeout'); const input = JSON.parse(opts.body); return json({ contact: { id: crypto.randomUUID(), phoneNumbers: [{ id: 'phone', value: input.phoneNumbers[0].value }], emailAddresses: [{ id: 'email', value: input.emailAddresses[0].value }] } }, 201); }
      if (/\/v1\/contacts\/[^/]+\/invite$/.test(u.pathname)) return json({}, state.emailFailure && JSON.parse(opts.body).destinationId === 'email' ? 503 : 200);
      throw new Error('Unexpected synthetic Spruce request: ' + u.pathname);
    }
    throw new Error('External network forbidden: ' + u.hostname);
  }
  let source = fs.readFileSync(path.join(__dirname, '../lambda/index.mjs'), 'utf8').replace(/^import[\s\S]*?from\s+"[^"]+";\r?\n/gm, '').replace('export const handler', 'const handler');
  source += '\nglobalThis.api = {handler, completeEnrolment, paymentApproval};';
  const context = vm.createContext({ ...classes, ...crypto, fetch: fakeFetch, process: { env: { ADMIN_CODE: 'SYNTHETIC-ADMIN', STRIPE_SECRET_KEY: 'synthetic', STRIPE_PRICE_ID: 'price_tss8', SPRUCE_AUTH: 'synthetic', SPRUCE_INTERNAL_ENDPOINT_ID: 'synthetic' } }, console: { error() {} }, URLSearchParams, AbortSignal, Buffer, Date, setTimeout });
  vm.runInContext(source, context);
  const call = async (route, body = {}, method = 'POST') => {
    const r = await context.api.handler({ rawPath: route, requestContext: { http: { method } }, body: JSON.stringify(body), queryStringParameters: method === 'GET' ? body : {} });
    return { status: r.statusCode, ...JSON.parse(r.body) };
  };
  const person = i => ({ first_name: 'Synthetic', last_name: 'Driver' + i, phone: '+151400000' + String(i).padStart(2, '0'), email: 'driver' + i + '@example.invalid' });
  const create = () => call('/partner/create', { name: 'Synthetic Fleet', contact_email: 'fleet@example.invalid' });
  const pay = (code, quantity, extras = {}) => {
    const sub = { id: 'sub_synthetic', status: 'active', collection_method: 'charge_automatically', latest_invoice: { paid: true, status: 'paid' }, items: { data: [{ id: 'si_synthetic', price: { id: 'price_tss8' }, quantity }] } };
    subscriptions.set(sub.id, sub);
    const session = { id: 'cs_synthetic', mode: 'subscription', status: 'complete', payment_status: 'paid', subscription: sub, customer: 'cus_synthetic', client_reference_id: code, customer_details: { email: 'fleet@example.invalid', name: 'Synthetic Fleet' }, ...extras };
    sessions.set(session.id, session); return session;
  };
  return { call, create, person, pay, tables, requests, state, subscriptions, sessions, api: context.api };
}
const spruceWrites = h => h.requests.filter(r => r.url.includes('sprucehealth.com') && !r.url.endsWith('/search'));

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
