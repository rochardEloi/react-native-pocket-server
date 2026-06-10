export interface PocketRequest {
  /** HTTP method, uppercased: 'GET', 'POST', ... */
  method: string;
  /** Path without the query string, e.g. '/users/42' */
  path: string;
  /** Parsed query string, e.g. { q: 'hello', limit: '10' } */
  query: Record<string, string>;
  /** Request headers with lowercased keys */
  headers: Record<string, string>;
  /** Raw request body as text */
  body: string;
  /** Parsed body when Content-Type is application/json, otherwise undefined */
  json?: any;
  /** Route params, e.g. { id: '42' } for pattern '/users/:id' */
  params: Record<string, string>;
  /** Remote address of the client, when available */
  ip?: string;
  /** Middleware may attach extra fields (req.user, ...) */
  [key: string]: any;
}

/**
 * Any object exposing { exists, size, base64() }.
 * expo-file-system's File matches this shape exactly; for other file systems
 * (e.g. react-native-fs) pass a small adapter object.
 */
export interface FileLike {
  uri?: string;
  name?: string;
  exists: boolean;
  size?: number | null;
  base64(): string | Promise<string>;
}

export interface SendFileOptions {
  /** Override the MIME type detected from the file extension */
  contentType?: string;
  /** Override the file name sent in Content-Disposition */
  fileName?: string;
  /** Send as a download (Content-Disposition: attachment) */
  download?: boolean;
  disposition?: 'inline' | 'attachment';
}

export declare class Response {
  /** True once a response has been written to the socket */
  readonly sent: boolean;
  status(code: number): this;
  header(key: string, value: string | number): this;
  /** Alias of header() */
  set(key: string, value: string | number): this;
  json(data: unknown): this;
  /** Sends text; objects are forwarded to json() */
  send(body: unknown): this;
  html(body: string): this;
  redirect(url: string): this;
  redirect(code: number, url: string): this;
  end(): this;
  sendFile(file: FileLike, options?: SendFileOptions): Promise<this>;
  download(file: FileLike, fileName?: string): Promise<this>;
}

export type NextFunction = (err?: unknown) => void;
export type Handler = (req: PocketRequest, res: Response, next: NextFunction) => unknown;
export type ErrorHandler = (err: unknown, req: PocketRequest, res: Response) => unknown;

export declare class Router {
  get(path: string, ...handlers: Handler[]): this;
  post(path: string, ...handlers: Handler[]): this;
  put(path: string, ...handlers: Handler[]): this;
  delete(path: string, ...handlers: Handler[]): this;
  patch(path: string, ...handlers: Handler[]): this;
  /** Matches every HTTP method */
  all(path: string, ...handlers: Handler[]): this;
}

export interface ServerOptions {
  /**
   * Milliseconds to wait for a complete request before dropping the
   * connection. Default: 10000.
   */
  requestTimeout?: number;
}

export declare class Server {
  /** Receive log lines: requests, socket errors, unhandled route errors */
  onLog(callback: (message: string) => void): this;
  use(middleware: Handler): this;
  use(router: Router): this;
  use(prefix: string, router: Router): this;
  use(prefix: string, middleware: Handler): this;
  /** Custom error handler for errors thrown in middleware/handlers */
  error(handler: ErrorHandler): this;
  get(path: string, ...handlers: Handler[]): this;
  post(path: string, ...handlers: Handler[]): this;
  put(path: string, ...handlers: Handler[]): this;
  delete(path: string, ...handlers: Handler[]): this;
  patch(path: string, ...handlers: Handler[]): this;
  all(path: string, ...handlers: Handler[]): this;
  listen(port: number, callback?: () => void): this;
  listen(port: number, host: string, callback?: () => void): this;
  close(): void;
}

export interface CorsOptions {
  /** Access-Control-Allow-Origin. Default: '*' */
  origin?: string;
  /** Default: 'GET,POST,PUT,DELETE,PATCH,OPTIONS' */
  methods?: string | string[];
  /** Default: 'Content-Type,Authorization' */
  headers?: string | string[];
  credentials?: boolean;
  maxAge?: number;
  /** Answer OPTIONS preflights with 204 automatically. Default: true */
  preflight?: boolean;
}

/** CORS middleware with automatic OPTIONS preflight handling */
export declare function cors(options?: CorsOptions): Handler;

export default function createServer(options?: ServerOptions): Server;
