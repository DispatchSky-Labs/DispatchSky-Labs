export class RateLimiter {
  constructor() {
    this.buckets = new Map();
  }

  check(key, limit, windowMs) {
    const now = Date.now();
    const bucket = this.buckets.get(key) || [];
    const recent = bucket.filter((ts) => now - ts < windowMs);
    recent.push(now);
    this.buckets.set(key, recent);
    return recent.length <= limit;
  }
}
