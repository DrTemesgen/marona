// Small helpers for the hosted API (the online demo on Vercel). Kept apart from server/vercel.ts
// so the tests can check them without a database.
import type { Context } from 'hono';

// The query parameter that carries the rest of an /api path through Vercel's route to the one
// API function (see tools/buildVercel.ts). It never reaches the app.
export const PATH_PARAM = '__path';

// The request URL as the app must see it. Vercel may hand the function either the original
// URL (/api/boards?scope=class) or the routed one (/api?__path=boards&scope=class); both give
// /api/boards?scope=class. The routing parameter is always removed.
export function originalUrl(url: string): string {
  const u = new URL(url, 'http://localhost');
  const rest = u.searchParams.get(PATH_PARAM);
  u.searchParams.delete(PATH_PARAM);
  const path = u.pathname === '/api' && rest ? `/api/${rest.replace(/^\/+/, '')}` : u.pathname;
  const query = u.searchParams.toString();
  return query ? `${path}?${query}` : path;
}

// Vercel sets x-real-ip (and x-forwarded-for) itself and overwrites any value a client sends,
// so behind Vercel it is the client's address. Not trusted anywhere else (see server/index.ts).
export function forwardedClientIp(c: Context): string {
  const real = c.req.header('x-real-ip')?.trim();
  if (real) return real;
  const first = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return first || 'unknown';
}
