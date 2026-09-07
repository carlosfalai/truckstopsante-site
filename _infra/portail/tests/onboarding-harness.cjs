// Synthetic regression tests. Every database and network operation is intercepted;
// no credentials, live customers, messages or charges are used.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

function harness(options = {}) {
  const tables = new Map(), requests = [], subscriptions = new Map(), sessions = new Map(), checkouts = new Map(); let checkoutNumber = 0;
  const state = { searchFailure: false, existingContact: null, billingFailure: false, createTimeout: false, emailFailure: false };
  const key = o => o.partner_code ? o.partner_code.S + '/' + o.id.S : o.code.S;
  const table = name => { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name); };
  const conditionalError = () => Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' });
  const clone = o => JSON.parse(JSON.stringify(o));
  const classes = {};
  for (const name of ['GetItemCommand', 'PutItemCommand', 'UpdateItemCommand', 'QueryCommand', 'ScanCommand', 'DeleteItemCommand', 'TransactWriteItemsCommand']) classes[name] = class { constructor(input) { this.input = input; this.command = name; } };
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
  const context = vm.createContext({ ...classes, ...crypto, OAuth2Client: class { async verifyIdToken({idToken}) { if (!options.googleTokens?.[idToken]) throw new Error('synthetic invalid credential'); return { getPayload: () => options.googleTokens[idToken] }; } }, createConsentService: () => options.consentService, createSpruceConsentSync: () => null, createSpruceWithdrawalSync: () => null, isConsentStreamEvent: event => !event.requestContext && Array.isArray(event.Records), handleConsentStream: options.handleConsentStream, fetch: fakeFetch, process: { env: { ADMIN_CODE: 'SYNTHETIC-ADMIN', GOOGLE_CLIENT_ID: options.googleTokens ? 'synthetic-client' : '', STRIPE_SECRET_KEY: 'synthetic', STRIPE_PRICE_ID: 'price_tss8', SPRUCE_AUTH: 'synthetic', SPRUCE_INTERNAL_ENDPOINT_ID: 'synthetic', TELEGRAM_BOT_TOKEN: 'synthetic-must-never-be-used', TELEGRAM_CHAT_ID: 'synthetic-no-outbound' } }, console: { error() {} }, URLSearchParams, AbortSignal, Buffer, Date, setTimeout });
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

module.exports = { harness };
