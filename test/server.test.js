import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Server } from '../src/server.js';
import { Router } from '../src/router.js';
import { cors } from '../src/cors.js';
import { FakeTcp, send, parseResponse } from './helpers.js';

function makeApp(options) {
  const tcp = new FakeTcp();
  const app = new Server(tcp, options);
  return { app, tcp };
}

test('responds to a simple GET', async () => {
  const { app, tcp } = makeApp();
  app.get('/', (req, res) => res.json({ hello: 'world' }));
  app.listen(8080);

  const socket = await send(tcp, ['GET / HTTP/1.1\r\nHost: x\r\n\r\n']);
  const r = parseResponse(socket);
  assert.equal(r.status, 200);
  assert.equal(r.body, '{"hello":"world"}');
});

test('route params and query are available', async () => {
  const { app, tcp } = makeApp();
  app.get('/users/:id', (req, res) =>
    res.json({ id: req.params.id, verbose: req.query.verbose, ip: req.ip })
  );
  app.listen(8080);

  const socket = await send(tcp, ['GET /users/42?verbose=1 HTTP/1.1\r\n\r\n']);
  const r = parseResponse(socket);
  assert.deepEqual(JSON.parse(r.body), { id: '42', verbose: '1', ip: '192.168.1.50' });
});

test('unknown routes get 404 after global middleware ran', async () => {
  const { app, tcp } = makeApp();
  app.use((req, res, next) => {
    res.header('X-Global', 'yes');
    next();
  });
  app.listen(8080);

  const socket = await send(tcp, ['GET /nope HTTP/1.1\r\n\r\n']);
  const r = parseResponse(socket);
  assert.equal(r.status, 404);
  assert.equal(r.headers['x-global'], 'yes');
});

test('POST body in a single chunk is parsed', async () => {
  const { app, tcp } = makeApp();
  app.post('/echo', (req, res) => res.json({ got: req.json }));
  app.listen(8080);

  const body = '{"msg":"hi"}';
  const socket = await send(tcp, [
    `POST /echo HTTP/1.1\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
  ]);
  const r = parseResponse(socket);
  assert.deepEqual(JSON.parse(r.body), { got: { msg: 'hi' } });
});

test('POST body arriving in a later chunk than the headers is parsed', async () => {
  const { app, tcp } = makeApp();
  app.post('/echo', (req, res) => res.json({ got: req.json }));
  app.listen(8080);

  const body = '{"msg":"split across packets"}';
  const socket = await send(tcp, [
    `POST /echo HTTP/1.1\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n`,
    body.slice(0, 10),
    body.slice(10),
  ]);
  const r = parseResponse(socket);
  assert.deepEqual(JSON.parse(r.body), { got: { msg: 'split across packets' } });
});

test('route middleware short-circuits without calling next()', async () => {
  const { app, tcp } = makeApp();
  const auth = (req, res, next) => {
    if (req.headers['authorization'] !== 'Bearer ok') {
      return res.status(401).json({ error: 'No token' });
    }
    req.user = 'jane';
    next();
  };
  app.get('/private', auth, (req, res) => res.json({ user: req.user }));
  app.listen(8080);

  const denied = await send(tcp, ['GET /private HTTP/1.1\r\n\r\n']);
  assert.equal(parseResponse(denied).status, 401);

  const allowed = await send(tcp, ['GET /private HTTP/1.1\r\nAuthorization: Bearer ok\r\n\r\n']);
  const r = parseResponse(allowed);
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { user: 'jane' });
});

test('errors thrown in handlers produce a 500', async () => {
  const { app, tcp } = makeApp();
  app.get('/boom', () => {
    throw new Error('kaboom');
  });
  app.listen(8080);

  const socket = await send(tcp, ['GET /boom HTTP/1.1\r\n\r\n']);
  assert.equal(parseResponse(socket).status, 500);
});

test('rejected async handlers reach the custom error handler', async () => {
  const { app, tcp } = makeApp();
  app.get('/boom', async () => {
    throw new Error('async kaboom');
  });
  app.error((err, req, res) => res.status(503).json({ custom: err.message }));
  app.listen(8080);

  const socket = await send(tcp, ['GET /boom HTTP/1.1\r\n\r\n']);
  const r = parseResponse(socket);
  assert.equal(r.status, 503);
  assert.deepEqual(JSON.parse(r.body), { custom: 'async kaboom' });
});

test('cors() answers OPTIONS preflight with 204', async () => {
  const { app, tcp } = makeApp();
  app.use(cors());
  app.post('/data', (req, res) => res.json({ ok: true }));
  app.listen(8080);

  const socket = await send(tcp, [
    'OPTIONS /data HTTP/1.1\r\nOrigin: http://example.com\r\nAccess-Control-Request-Method: POST\r\n\r\n',
  ]);
  const r = parseResponse(socket);
  assert.equal(r.status, 204);
  assert.equal(r.headers['access-control-allow-origin'], '*');
  assert.match(r.headers['access-control-allow-methods'], /POST/);
});

test('malformed requests get 400 instead of crashing', async () => {
  const { app, tcp } = makeApp();
  app.get('/', (req, res) => res.json({ ok: true }));
  app.listen(8080);

  const socket = await send(tcp, ['THIS IS NOT HTTP\r\n\r\n']);
  assert.equal(parseResponse(socket).status, 400);
});

test('malformed percent-encoding in the path does not crash', async () => {
  const { app, tcp } = makeApp();
  app.get('/files/:name', (req, res) => res.json({ name: req.params.name }));
  app.listen(8080);

  const socket = await send(tcp, ['GET /files/%zz HTTP/1.1\r\n\r\n']);
  const r = parseResponse(socket);
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { name: '%zz' });
});

test('routers mount under a prefix', async () => {
  const { app, tcp } = makeApp();
  const api = new Router();
  api.get('/users', (req, res) => res.json({ users: [] }));
  api.get('/users/:id', (req, res) => res.json({ id: req.params.id }));
  app.use('/api', api);
  app.listen(8080);

  const list = await send(tcp, ['GET /api/users HTTP/1.1\r\n\r\n']);
  assert.equal(parseResponse(list).status, 200);

  const one = await send(tcp, ['GET /api/users/7 HTTP/1.1\r\n\r\n']);
  assert.deepEqual(JSON.parse(parseResponse(one).body), { id: '7' });
});

test('routers mount at the root when no prefix is given', async () => {
  const { app, tcp } = makeApp();
  const router = new Router();
  router.get('/ping', (req, res) => res.json({ pong: true }));
  app.use(router);
  app.listen(8080);

  const socket = await send(tcp, ['GET /ping HTTP/1.1\r\n\r\n']);
  assert.equal(parseResponse(socket).status, 200);
});

test('prefix middleware only applies under its prefix', async () => {
  const { app, tcp } = makeApp();
  app.use('/admin', (req, res, next) => {
    res.header('X-Admin', 'yes');
    next();
  });
  app.get('/admin/panel', (req, res) => res.json({ ok: true }));
  app.get('/administrator', (req, res) => res.json({ ok: true }));
  app.listen(8080);

  const inside = await send(tcp, ['GET /admin/panel HTTP/1.1\r\n\r\n']);
  assert.equal(parseResponse(inside).headers['x-admin'], 'yes');

  // '/administrator' starts with '/admin' as a string but is a different path
  const outside = await send(tcp, ['GET /administrator HTTP/1.1\r\n\r\n']);
  assert.equal(parseResponse(outside).headers['x-admin'], undefined);
});

test('all() matches every method', async () => {
  const { app, tcp } = makeApp();
  app.all('/any', (req, res) => res.json({ method: req.method }));
  app.listen(8080);

  const del = await send(tcp, ['DELETE /any HTTP/1.1\r\n\r\n']);
  assert.deepEqual(JSON.parse(parseResponse(del).body), { method: 'DELETE' });
});

test('incomplete requests are dropped after requestTimeout', async () => {
  const { app, tcp } = makeApp({ requestTimeout: 30 });
  app.get('/', (req, res) => res.json({ ok: true }));
  app.listen(8080);

  const socket = await send(tcp, ['GET / HTTP/1.1\r\nHost:']); // never completes
  assert.equal(socket.destroyed, false);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(socket.destroyed, true);
  assert.equal(socket.writes.length, 0);
});

test('listen() defaults to 0.0.0.0 and close() shuts the server down', () => {
  const { app, tcp } = makeApp();
  let started = false;
  app.listen(9999, () => {
    started = true;
  });
  assert.equal(started, true);
  assert.deepEqual(tcp.servers[0].listenOptions, { port: 9999, host: '0.0.0.0' });
  app.close();
  assert.equal(tcp.servers[0].closed, true);
});
