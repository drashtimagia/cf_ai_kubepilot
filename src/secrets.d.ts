/** Secrets are not in wrangler.jsonc, so `wrangler types` does not know them. */
declare namespace Cloudflare {
  interface Env {
    /** Signs per-cluster API tokens. Set with `wrangler secret put WEBHOOK_SECRET`. */
    WEBHOOK_SECRET?: string;
  }
}
interface Env {
  WEBHOOK_SECRET?: string;
}
