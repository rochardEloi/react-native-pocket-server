import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Response } from '../src/response.js';
import { FakeSocket, parseResponse } from './helpers.js';

test('json() sends status, headers and body', () => {
  const socket = new FakeSocket();
  new Response(socket).json({ hello: 'world' });
  const r = parseResponse(socket);
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'application/json');
  assert.equal(r.headers['connection'], 'close');
  assert.equal(r.body, '{"hello":"world"}');
  assert.equal(r.headers['content-length'], String(r.body.length));
});

test('status() sets code and reason text', () => {
  const socket = new FakeSocket();
  new Response(socket).status(404).json({ error: 'nope' });
  const r = parseResponse(socket);
  assert.equal(r.status, 404);
  assert.match(r.statusLine, /404 Not Found/);
});

test('send() sends text with UTF-8 Content-Length', () => {
  const socket = new FakeSocket();
  new Response(socket).send('héllo');
  const r = parseResponse(socket);
  assert.equal(r.headers['content-type'], 'text/plain');
  assert.equal(r.headers['content-length'], '6'); // é is 2 bytes
});

test('send() forwards objects to json()', () => {
  const socket = new FakeSocket();
  new Response(socket).send({ a: 1 });
  const r = parseResponse(socket);
  assert.equal(r.headers['content-type'], 'application/json');
  assert.equal(r.body, '{"a":1}');
});

test('html() sets text/html', () => {
  const socket = new FakeSocket();
  new Response(socket).html('<h1>Hi</h1>');
  const r = parseResponse(socket);
  assert.equal(r.headers['content-type'], 'text/html');
  assert.equal(r.body, '<h1>Hi</h1>');
});

test('redirect() defaults to 302', () => {
  const socket = new FakeSocket();
  new Response(socket).redirect('/login');
  const r = parseResponse(socket);
  assert.equal(r.status, 302);
  assert.equal(r.headers['location'], '/login');
});

test('redirect(301, url) uses the given code', () => {
  const socket = new FakeSocket();
  new Response(socket).redirect(301, '/new');
  const r = parseResponse(socket);
  assert.equal(r.status, 301);
  assert.equal(r.headers['location'], '/new');
});

test('header() and set() add headers', () => {
  const socket = new FakeSocket();
  new Response(socket).header('X-A', '1').set('X-B', '2').end();
  const r = parseResponse(socket);
  assert.equal(r.headers['x-a'], '1');
  assert.equal(r.headers['x-b'], '2');
});

test('a response can only be sent once', () => {
  const socket = new FakeSocket();
  const res = new Response(socket);
  res.json({ first: true });
  res.json({ second: true });
  res.send('third');
  assert.equal(socket.writes.length, 1);
  assert.match(socket.writes[0].data, /"first":true/);
});

test('sendFile() streams a file-like object as binary', async () => {
  const socket = new FakeSocket();
  const file = {
    uri: '/data/photos/cat.png',
    exists: true,
    size: 3,
    base64: async () => 'QUJD', // "ABC"
  };
  await new Response(socket).sendFile(file);
  assert.equal(socket.writes.length, 2);
  const r = parseResponse(socket);
  assert.equal(r.headers['content-type'], 'image/png');
  assert.equal(r.headers['content-length'], '3');
  assert.match(r.headers['content-disposition'], /inline; filename="cat.png"/);
  assert.equal(socket.writes[1].data, 'QUJD');
  assert.equal(socket.writes[1].encoding, 'base64');
});

test('download() sends Content-Disposition attachment with custom name', async () => {
  const socket = new FakeSocket();
  const file = { uri: '/data/report.pdf', exists: true, size: 3, base64: async () => 'QUJD' };
  await new Response(socket).download(file, 'monthly.pdf');
  const r = parseResponse(socket);
  assert.match(r.headers['content-disposition'], /attachment; filename="monthly.pdf"/);
});

test('sendFile() returns 404 for missing files', async () => {
  const socket = new FakeSocket();
  await new Response(socket).sendFile({ uri: '/x.png', exists: false, size: null, base64: () => '' });
  const r = parseResponse(socket);
  assert.equal(r.status, 404);
});

test('sendFile() returns 500 for invalid arguments', async () => {
  const socket = new FakeSocket();
  await new Response(socket).sendFile('/just/a/string/path.png');
  const r = parseResponse(socket);
  assert.equal(r.status, 500);
  assert.match(r.body, /file object/);
});
