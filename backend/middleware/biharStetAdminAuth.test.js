const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hasAdminSession,
  isTrustedAdminRequest,
  requireBiharStetAdmin
} = require('./biharStetAdminAuth');

test('only exact production origins or same-origin Fetch Metadata pass the admin origin guard', () => {
  assert.equal(isTrustedAdminRequest({ headers: { origin: 'https://2amstudy.com' } }, true), true);
  assert.equal(isTrustedAdminRequest({ headers: { origin: 'https://evil.2amstudy.com' } }, true), false);
  assert.equal(isTrustedAdminRequest({ headers: { origin: 'https://2amstudy.com.attacker.invalid' } }, true), false);
  assert.equal(isTrustedAdminRequest({ headers: { 'sec-fetch-site': 'same-origin' } }, true), true);
  assert.equal(isTrustedAdminRequest({ headers: { 'sec-fetch-site': 'same-site' } }, true), false);
  assert.equal(isTrustedAdminRequest({ headers: {} }, true), false);
});

test('development origins are accepted only outside production', () => {
  const request = { headers: { origin: 'http://localhost:3000' } };
  assert.equal(isTrustedAdminRequest(request, false), true);
  assert.equal(isTrustedAdminRequest(request, true), false);
});

test('admin session must carry one of the existing authenticated flags', () => {
  assert.equal(hasAdminSession({ session: { isAdmin: true } }), true);
  assert.equal(hasAdminSession({ session: { isStoreAdmin: true } }), true);
  assert.equal(hasAdminSession({ session: {} }), false);
  assert.equal(hasAdminSession({}), false);
});

test('admin middleware rejects untrusted origins before accepting a session', () => {
  let statusCode;
  let responseBody;
  let nextCalled = false;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    }
  };
  requireBiharStetAdmin(
    { headers: { origin: 'https://evil.2amstudy.com' }, session: { isAdmin: true } },
    response,
    () => { nextCalled = true; }
  );
  assert.equal(statusCode, 403);
  assert.equal(responseBody.success, false);
  assert.equal(nextCalled, false);
});
