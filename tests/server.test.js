const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function server({ ml = false, historyFailure = false } = {}) {
  const callbacks = {}, endpoints = {}, sent = [], events = [], writes = [];
  let sensor = { fallDetected: false, manualSOS: false, gpsValid: true, latitude: 13, longitude: 80 };
  const ref = p => ({
    on: (_, cb) => { callbacks[p] = cb; },
    once: async () => ({ val: () => p === 'notificationTokens' ? { 'test-token': true } : sensor, forEach: () => {} }),
    set: async value => {
      writes.push([p, value]);
      if(p === 'sensorData/timestamp') {
        sensor.timestamp = value;
        // Reentrant Firebase event before the caller resumes after await.
        await callbacks.sensorData({ val: () => ({...sensor}) });
      }
    },
    push: async value => { if(historyFailure) throw Error('offline'); events.push(value); },
    update: async value => { writes.push([p, value]); },
    orderByChild: () => ref(p), endAt: () => ref(p), limitToFirst: () => ref(p),
  });
  const app = { use() {}, get() {}, post(url, ...handlers) { endpoints[url] = handlers; }, listen() {} };
  const express = () => app; express.json = () => () => {};
  const admin = { credential: {cert: () => ({})}, initializeApp() {},
    database: () => ({ref}), messaging: () => ({send: async message => { sent.push(message); return 'ok'; }}) };
  const context = { require: name => name === 'express' ? express : name === 'firebase-admin' ? admin : require(name),
    process: { env: {ENABLE_ANALYTICS: 'true', ENABLE_ML_NOTIFICATIONS: String(ml), ALERT_API_KEY: 'test-secret'} },
    console: {log(){}, error(){}}, Buffer, Date };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'), context);
  return { callbacks, endpoints, sent, events, writes, setSensor: value => {sensor = {...sensor, ...value};},
    emit: async (p, value) => { if(p === 'sensorData') sensor = {...sensor, ...value}; await callbacks[p]({val: () => p === 'sensorData' ? {...sensor} : value}); } };
}

test('fall rising edge sends once despite reentrant timestamp update', async () => {
  const s = server();
  await s.emit('sensorData', {fallDetected: false});
  await s.emit('sensorData', {fallDetected: true});
  await s.emit('sensorData', {fallDetected: true});
  assert.equal(s.sent.length, 1); assert.equal(s.events.length, 1);
  assert.equal(s.sent[0].data.type, 'fall_alert');
  assert.equal(s.sent[0].data.gpsValid, 'true');
  assert.equal(s.events[0].type, 'fall');
  await s.emit('sensorData', {fallDetected: false});
  await s.emit('sensorData', {fallDetected: true});
  assert.equal(s.sent.length, 2);
});

test('SOS rising edge and manual endpoint preserve notification payload', async () => {
  const s = server();
  await s.emit('sensorData', {});
  await s.emit('sensorData/manualSOS', false);
  s.setSensor({manualSOS: true});
  await s.emit('sensorData/manualSOS', true);
  await s.emit('sensorData/manualSOS', true);
  assert.equal(s.sent.length, 1); assert.equal(s.sent[0].data.type, 'sos_alert');
  let status;
  const res = { status(code) {status=code; return this;}, json() {} };
  await s.endpoints['/sos-alert'].at(-1)({body: {}}, res);
  assert.equal(status, 200); assert.equal(s.sent.length, 2);
  assert.equal(s.events[1].source, 'endpoint');
});

test('startup does not emit an alert and history failure does not block FCM', async () => {
  const s = server({historyFailure: true});
  await s.emit('sensorData', {fallDetected: true}); assert.equal(s.sent.length, 0);
  await s.emit('sensorData', {fallDetected: false});
  await s.emit('sensorData', {fallDetected: true}); assert.equal(s.sent.length, 1);
});

test('optional ML notification retains cooldown and ignores stale events', async () => {
  const s = server({ml: true});
  await s.emit('mlPrediction', {fallDetected: false, timestamp: Date.now()});
  await s.emit('mlPrediction', {fallDetected: true, timestamp: Date.now()-60000});
  assert.equal(s.sent.length, 0);
  await s.emit('mlPrediction', {fallDetected: false, timestamp: Date.now()});
  await s.emit('mlPrediction', {fallDetected: true, timestamp: Date.now(), probability: .99});
  assert.equal(s.sent.length, 1); assert.equal(s.events[0].source, 'sisfall-rf');
});

test('optional endpoint secret rejects unauthorized callers', () => {
  const s = server(); let denied = false, next = false;
  s.endpoints['/fall-alert'][0]({get: () => 'wrong'}, {status: code => ({json: () => {denied = code === 401;}})}, () => {next=true;});
  assert.equal(denied, true); assert.equal(next, false);
});

test('ML fall history is recorded even when ML notifications are disabled', async () => {
  const s = server();
  await s.emit('mlPrediction', {fallDetected: false, timestamp: Date.now()});
  await s.emit('mlPrediction', {fallDetected: true, timestamp: Date.now(), probability: .97});
  assert.equal(s.events.length, 1);
  assert.equal(s.events[0].source, 'sisfall-rf');
  assert.equal(s.sent.length, 0);
});
