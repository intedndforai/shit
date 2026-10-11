import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext configuration for the Cloudflare adapter.
 *
 * The empty overrides are deliberate. Leaving the incremental cache, tag cache
 * and queue at their defaults keeps the Worker free of R2, KV and Durable
 * Object bindings, so a deploy needs nothing more than the Worker itself.
 * Conduit is a dynamic app, so those caches would buy little here.
 */
export default defineCloudflareConfig({});
