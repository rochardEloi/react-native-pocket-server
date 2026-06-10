// Pure HTTP helpers — no React Native imports, so everything here is unit-testable in Node.

export const MIME_TYPES = {
  '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
  '.js': 'application/javascript', '.json': 'application/json',
  '.txt': 'text/plain', '.csv': 'text/csv', '.xml': 'application/xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.avi': 'video/x-msvideo',
  '.pdf': 'application/pdf', '.zip': 'application/zip',
  '.gz': 'application/gzip', '.tar': 'application/x-tar',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.apk': 'application/vnd.android.package-archive',
};

export function getMimeType(filePath) {
  const ext = '.' + filePath.split('.').pop().toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

export function getFileName(filePath) {
  return filePath.split('/').pop();
}

// UTF-8 byte length without Buffer (not available in React Native's JS runtime)
export function byteLength(str) {
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.codePointAt(i);
    if (code > 0xffff) i++; // surrogate pair occupies two UTF-16 units
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

// decodeURIComponent that never throws — malformed sequences are returned as-is
export function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseHeaders(rawLines) {
  const headers = {};
  rawLines.forEach((line) => {
    const idx = line.indexOf(':');
    if (idx !== -1) {
      const key = line.slice(0, idx).trim().toLowerCase();
      headers[key] = line.slice(idx + 1).trim();
    }
  });
  return headers;
}

export function parseQuery(queryString) {
  const query = {};
  if (!queryString) return query;
  for (const pair of queryString.split('&')) {
    if (!pair) continue;
    const idx = pair.indexOf('=');
    const k = idx === -1 ? pair : pair.slice(0, idx);
    const v = idx === -1 ? '' : pair.slice(idx + 1);
    query[safeDecode(k.replace(/\+/g, ' '))] = safeDecode(v.replace(/\+/g, ' '));
  }
  return query;
}

// True once `buffer` holds a complete request: headers plus the full body
// declared by Content-Length. Requests without Content-Length are complete
// as soon as the blank line after the headers arrives.
export function isRequestComplete(buffer) {
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd === -1) return false;
  const match = buffer.slice(0, headerEnd).match(/^content-length:[ \t]*(\d+)/im);
  if (!match) return true;
  return byteLength(buffer.slice(headerEnd + 4)) >= parseInt(match[1], 10);
}

// Parse a raw HTTP/1.x request into { method, path, query, headers, body, json, params }.
// Returns null if the text is not a parseable request.
export function parseHttpRequest(text) {
  const headerEnd = text.indexOf('\r\n\r\n');
  if (headerEnd === -1) return null;

  const headerSection = text.slice(0, headerEnd);
  const [requestLine, ...headerLines] = headerSection.split('\r\n');
  const [method, fullPath] = requestLine.split(' ');
  if (!method || !fullPath || !fullPath.startsWith('/')) return null;

  const queryIdx = fullPath.indexOf('?');
  const path = queryIdx !== -1 ? fullPath.slice(0, queryIdx) : fullPath;
  const queryString = queryIdx !== -1 ? fullPath.slice(queryIdx + 1) : '';

  const headers = parseHeaders(headerLines);
  const body = text.slice(headerEnd + 4);

  let json;
  if (headers['content-type']?.includes('application/json')) {
    try { json = JSON.parse(body); } catch {}
  }

  return {
    method: method.toUpperCase(),
    path,
    query: parseQuery(queryString),
    headers,
    body,
    json,
    params: {},
  };
}

// Match route patterns like /users/:id against request paths.
// Returns the captured params, or null if the path does not match.
export function matchPath(pattern, reqPath) {
  const patternParts = pattern.split('/');
  const pathParts = reqPath.split('/');

  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = safeDecode(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

// Run a chain of middleware/handler functions in order (supports async handlers).
// A handler stops the chain by not calling next(); errors (thrown, passed to
// next(err), or from a rejected promise) short-circuit to done(err).
export function runStack(stack, req, res, done) {
  let i = 0;
  const next = (err) => {
    if (err) return done(err);
    if (i >= stack.length) return done();
    const fn = stack[i++];
    try {
      const result = fn(req, res, next);
      if (result && typeof result.catch === 'function') {
        result.catch((e) => done(e));
      }
    } catch (e) {
      done(e);
    }
  };
  next();
}
