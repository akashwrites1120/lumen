import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../types.js";
import { RATE_LIMIT_PRESETS, rateLimitHeaders, type RateLimitConfig } from "../ratelimit.js";

export interface LimitOpts {
  scope: string;
  cfg: RateLimitConfig;
  /** Resolves the bucket key for the current request. Falls back to req.ip. */
  keyFor?: (req: FastifyRequest) => string;
}

export function makeRateLimit(ctx: AppContext, opts: LimitOpts) {
  return async function rateLimit(req: FastifyRequest, reply: FastifyReply) {
    const subject = opts.keyFor ? opts.keyFor(req) : req.ip;
    const res = await ctx.redisRateLimit.hit(`${opts.scope}:${subject}`, opts.cfg);
    reply.headers(rateLimitHeaders(res));
    if (!res.allowed) {
      reply.header("Retry-After", String(res.resetSec));
      return reply.code(429).send({ error: "rate_limited", retryAfterSec: res.resetSec });
    }
  };
}

export { RATE_LIMIT_PRESETS };
