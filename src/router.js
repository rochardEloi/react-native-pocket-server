// Group routes for mounting under a prefix with app.use('/prefix', router).
// Routes are copied into the server at mount time, so add all routes to the
// router before calling app.use().
export class Router {
  constructor() {
    this._routes = [];
  }

  _addRoute(method, path, ...handlers) {
    const handler = handlers.pop();
    const middleware = handlers;
    this._routes.push({ method, path, middleware, handler });
    return this;
  }

  get(path, ...args) { return this._addRoute('GET', path, ...args); }
  post(path, ...args) { return this._addRoute('POST', path, ...args); }
  put(path, ...args) { return this._addRoute('PUT', path, ...args); }
  delete(path, ...args) { return this._addRoute('DELETE', path, ...args); }
  patch(path, ...args) { return this._addRoute('PATCH', path, ...args); }
  all(path, ...args) { return this._addRoute('*', path, ...args); }
}
