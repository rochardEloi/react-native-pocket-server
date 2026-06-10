import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  byteLength,
  safeDecode,
  parseQuery,
  parseHttpRequest,
  isRequestComplete,
  matchPath,
  getMimeType,
} from '../src/http.js';

test('byteLength counts UTF-8 bytes', () => {
  assert.equal(byteLength('hello'), 5);
  assert.equal(byteLength('é'), 2);
  assert.equal(byteLength('€'), 3);
  assert.equal(byteLength('😀'), 4);
  assert.equal(byteLength(''), 0);
});

test('safeDecode decodes and never throws', () => {
  assert.equal(safeDecode('hello%20world'), 'hello world');
  assert.equal(safeDecode('%zz'), '%zz'); // malformed → returned as-is
});

test('parseQuery handles values, plus-signs and malformed encoding', () => {
  assert.deepEqual(parseQuery('a=1&b=hello%20world'), { a: '1', b: 'hello world' });
  assert.deepEqual(parseQuery('q=x+y'), { q: 'x y' });
  assert.deepEqual(parseQuery('flag'), { flag: '' });
  assert.deepEqual(parseQuery('v=a=b'), { v: 'a=b' }); // '=' inside value
  assert.deepEqual(parseQuery('bad=%zz'), { bad: '%zz' }); // no throw
  assert.deepEqual(parseQuery(''), {});
});

test('isRequestComplete waits for the full Content-Length body', () => {
  assert.equal(isRequestComplete('GET / HTTP/1.1\r\nHost: x'), false); // headers incomplete
  assert.equal(isRequestComplete('GET / HTTP/1.1\r\nHost: x\r\n\r\n'), true); // no body declared
  const post = 'POST /x HTTP/1.1\r\nContent-Length: 10\r\n\r\n';
  assert.equal(isRequestComplete(post), false);
  assert.equal(isRequestComplete(post + '12345'), false); // partial body
  assert.equal(isRequestComplete(post + '1234567890'), true);
});

test('isRequestComplete counts body bytes, not characters', () => {
  // 'éé' is 2 characters but 4 UTF-8 bytes
  const post = 'POST /x HTTP/1.1\r\nContent-Length: 4\r\n\r\néé';
  assert.equal(isRequestComplete(post), true);
});

test('parseHttpRequest parses method, path, query and headers', () => {
  const req = parseHttpRequest(
    'GET /search?q=hi&limit=5 HTTP/1.1\r\nHost: phone\r\nX-Token: abc\r\n\r\n'
  );
  assert.equal(req.method, 'GET');
  assert.equal(req.path, '/search');
  assert.deepEqual(req.query, { q: 'hi', limit: '5' });
  assert.equal(req.headers['host'], 'phone');
  assert.equal(req.headers['x-token'], 'abc');
});

test('parseHttpRequest parses a JSON body', () => {
  const body = '{"name":"Jane"}';
  const req = parseHttpRequest(
    `POST /users HTTP/1.1\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`
  );
  assert.equal(req.body, body);
  assert.deepEqual(req.json, { name: 'Jane' });
});

test('parseHttpRequest leaves json undefined for invalid JSON', () => {
  const req = parseHttpRequest(
    'POST /x HTTP/1.1\r\nContent-Type: application/json\r\n\r\nnot-json'
  );
  assert.equal(req.json, undefined);
  assert.equal(req.body, 'not-json');
});

test('parseHttpRequest rejects garbage', () => {
  assert.equal(parseHttpRequest('garbage'), null);
  assert.equal(parseHttpRequest('NOT_A_REQUEST\r\n\r\n'), null);
});

test('matchPath captures and decodes params', () => {
  assert.deepEqual(matchPath('/users/:id', '/users/42'), { id: '42' });
  assert.deepEqual(matchPath('/a/:x/:y', '/a/1/2'), { x: '1', y: '2' });
  assert.deepEqual(matchPath('/f/:name', '/f/caf%C3%A9'), { name: 'café' });
  assert.deepEqual(matchPath('/f/:name', '/f/%zz'), { name: '%zz' }); // no throw
  assert.deepEqual(matchPath('/', '/'), {});
});

test('matchPath rejects non-matching paths', () => {
  assert.equal(matchPath('/users/:id', '/posts/42'), null);
  assert.equal(matchPath('/users/:id', '/users'), null);
  assert.equal(matchPath('/users', '/users/42'), null);
});

test('getMimeType maps extensions', () => {
  assert.equal(getMimeType('photo.PNG'), 'image/png');
  assert.equal(getMimeType('/a/b/doc.pdf'), 'application/pdf');
  assert.equal(getMimeType('unknown.xyz'), 'application/octet-stream');
});
