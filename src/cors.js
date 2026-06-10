// CORS middleware with automatic preflight handling.
//
//   app.use(cors())
//   app.use(cors({ origin: 'https://myapp.com', credentials: true }))
//
// OPTIONS preflight requests are answered with 204 directly (browsers require
// a 2xx on preflight); pass { preflight: false } to handle OPTIONS yourself.
export function cors(options = {}) {
  const {
    origin = '*',
    methods = 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
    headers = 'Content-Type,Authorization',
    credentials = false,
    maxAge,
    preflight = true,
  } = options;

  const allowMethods = Array.isArray(methods) ? methods.join(',') : methods;
  const allowHeaders = Array.isArray(headers) ? headers.join(',') : headers;

  return (req, res, next) => {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', allowMethods);
    res.header('Access-Control-Allow-Headers', allowHeaders);
    if (credentials) res.header('Access-Control-Allow-Credentials', 'true');
    if (maxAge != null) res.header('Access-Control-Max-Age', String(maxAge));

    if (preflight && req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    next();
  };
}
