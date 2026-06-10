import { parseHttpRequest, isRequestComplete, matchPath, runStack } from './http.js';
import { Response } from './response.js';
import { Router } from './router.js';

const DEFAULT_REQUEST_TIMEOUT = 10000;

export class Server {
  // `tcp` is the react-native-tcp-socket module (injected so the server can be
  // tested in Node with a fake implementation).
  constructor(tcp, options = {}) {
    this._tcp = tcp;
    this._requestTimeout = options.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT;
    this._routes = [];
    this._globalMiddleware = [];
    this._server = null;
    this._onLog = null;
    this._errorHandler = null;
  }

  onLog(callback) {
    this._onLog = callback;
    return this;
  }

  _log(msg) {
    if (this._onLog) this._onLog(msg);
  }

  // app.use(fn) — global middleware
  // app.use(router) — mount a router at the root
  // app.use('/prefix', router) — mount a router under a prefix
  // app.use('/prefix', fn) — middleware limited to a path prefix
  use(...args) {
    if (args.length === 1 && args[0] instanceof Router) {
      this._mountRouter('', args[0]);
    } else if (args.length === 1 && typeof args[0] === 'function') {
      this._globalMiddleware.push({ prefix: null, fn: args[0] });
    } else if (typeof args[0] === 'string' && args[1] instanceof Router) {
      this._mountRouter(args[0], args[1]);
    } else if (typeof args[0] === 'string' && typeof args[1] === 'function') {
      const prefix = args[0].endsWith('/') ? args[0].slice(0, -1) : args[0];
      this._globalMiddleware.push({ prefix, fn: args[1] });
    } else {
      throw new Error('Invalid arguments to app.use()');
    }
    return this;
  }

  _mountRouter(prefix, router) {
    const clean = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    for (const route of router._routes) {
      this._routes.push({ ...route, path: clean + route.path });
    }
  }

  // app.error((err, req, res) => { ... }) — custom error handler
  error(handler) {
    this._errorHandler = handler;
    return this;
  }

  _addRoute(method, path, ...handlers) {
    const handler = handlers.pop();
    const middleware = handlers;
    this._routes.push({ method, path, middleware, handler });
    return this;
  }

  // app.get('/path', handler)
  // app.get('/path', middleware1, middleware2, handler)
  get(path, ...args) { return this._addRoute('GET', path, ...args); }
  post(path, ...args) { return this._addRoute('POST', path, ...args); }
  put(path, ...args) { return this._addRoute('PUT', path, ...args); }
  delete(path, ...args) { return this._addRoute('DELETE', path, ...args); }
  patch(path, ...args) { return this._addRoute('PATCH', path, ...args); }
  all(path, ...args) { return this._addRoute('*', path, ...args); }

  _matchRoute(method, reqPath) {
    for (const route of this._routes) {
      if (route.method !== '*' && route.method !== method) continue;
      const params = matchPath(route.path, reqPath);
      if (params !== null) return { route, params };
    }
    return null;
  }

  _handleError(err, req, res) {
    if (res.sent) return;
    if (this._errorHandler) {
      try {
        this._errorHandler(err, req, res);
      } catch (e) {
        this._log(`Error handler threw: ${e.message}`);
        if (!res.sent) res.status(500).json({ error: 'Internal Server Error' });
      }
    } else {
      this._log(`Unhandled error: ${err && err.message ? err.message : err}`);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  _prefixMatches(prefix, reqPath) {
    if (prefix === null || prefix === '') return true;
    return reqPath === prefix || reqPath.startsWith(prefix + '/');
  }

  _dispatch(req, res) {
    try {
      const globalStack = this._globalMiddleware
        .filter((m) => this._prefixMatches(m.prefix, req.path))
        .map((m) => m.fn);

      const match = this._matchRoute(req.method, req.path);

      if (match) {
        req.params = match.params;
        const fullStack = [...globalStack, ...match.route.middleware, match.route.handler];
        runStack(fullStack, req, res, (err) => {
          if (err) this._handleError(err, req, res);
        });
      } else {
        // Run global middleware (so CORS headers etc. still apply), then 404
        runStack(globalStack, req, res, (err) => {
          if (err) return this._handleError(err, req, res);
          if (!res.sent) res.status(404).json({ error: 'Not Found' });
        });
      }
    } catch (err) {
      this._handleError(err, req, res);
    }
  }

  _handleConnection(socket) {
    let buffer = '';
    let handled = false;

    // Drop connections that never send a complete request
    const timeout = setTimeout(() => {
      if (!handled) {
        handled = true;
        socket.destroy();
      }
    }, this._requestTimeout);

    socket.on('data', (data) => {
      if (handled) return;
      buffer += typeof data === 'string' ? data : data.toString();

      // Wait for headers AND the full body declared by Content-Length —
      // bodies regularly arrive in a separate TCP packet from the headers.
      if (!isRequestComplete(buffer)) return;

      handled = true;
      clearTimeout(timeout);
      const res = new Response(socket);

      let req = null;
      try {
        req = parseHttpRequest(buffer);
      } catch {
        req = null;
      }
      if (!req) {
        res.status(400).json({ error: 'Bad Request' });
        return;
      }

      req.ip = socket.remoteAddress;
      this._log(`${req.method} ${req.path}`);
      this._dispatch(req, res);
    });

    socket.on('error', (err) => {
      this._log(`Socket error: ${err.message}`);
    });
  }

  // app.listen(8080)
  // app.listen(8080, () => console.log('up'))
  // app.listen(8080, '127.0.0.1', () => console.log('up'))
  listen(port, host, callback) {
    if (typeof host === 'function') {
      callback = host;
      host = undefined;
    }

    this._server = this._tcp.createServer((socket) => this._handleConnection(socket));
    this._server.listen({ port, host: host || '0.0.0.0' }, callback);
    this._server.on('error', (err) => {
      this._log(`Server error: ${err.message}`);
    });
    return this;
  }

  close() {
    if (this._server) {
      this._server.close();
      this._server = null;
    }
  }
}
