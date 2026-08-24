import { Request } from "express";
import { ipKeyGenerator } from "express-rate-limit";

/**
 * Rate-limit key generators — kept in-process (no Redis), consistent with
 * the rest of this backend's deliberate single-instance, no-external-store
 * design. The goal isn't a bigger store, it's smarter keys:
 *
 *  - keyByUserOrIp: for general authenticated API traffic. Keys by account
 *    when we know it (req.auth is set post-token-verification), falling
 *    back to IP for guests. This stops multiple users behind a shared/NAT'd
 *    IP (common on mobile networks) from being bucketed together, and stops
 *    a single account from dodging its own limit by rotating IPs.
 *
 *  - keyByIdentifierOrIp: for PRE-auth routes (login) where there's no
 *    req.auth yet to key by. Keys by the account being targeted (email or
 *    phone in the request body) when present, so a distributed brute-force
 *    against one account from many IPs still gets caught — an IP-only
 *    limiter can't see that pattern at all. Falls back to IP when no
 *    identifier is present (e.g. malformed requests).
 */

export function keyByUserOrIp(req: Request): string {
  const userId = req.auth?.id;
  // ipKeyGenerator normalizes IPv6 addresses to their /64 subnet before use —
  // without it, a single IPv6 client can present many distinct-looking
  // addresses and bypass the limit entirely (the library validates for and
  // warns loudly about exactly this if you pass req.ip raw).
  return userId ? `user:${userId}` : ipKeyGenerator(req.ip ?? "");
}

export function keyByIdentifierOrIp(req: Request): string {
  const identifier = (req.body?.email || req.body?.phone) as string | undefined;
  return identifier ? `id:${String(identifier).trim().toLowerCase()}` : ipKeyGenerator(req.ip ?? "");
}
