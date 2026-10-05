import { test } from "node:test";
import assert from "node:assert/strict";
import host from "../../packages/pwa-host/src/index.ts";
import { COMPILER, sha256, type ReleaseManifest } from "../../apps/core/pwa/protocol.ts";
import { assertKey, pool } from "../../scripts/pwa/cloudflare.ts";
test("resource Worker checks maintenance before cache, validates versions and handles Range/HEAD/unknown paths", async () => {
	const bytes = new TextEncoder().encode("0123456789"),
		hash = await sha256(bytes);
	const m: ReleaseManifest = { schemaVersion: 1, releaseId: "host-fixture", commit: "test", gameVersion: "test", runtimeProtocol: 1, compilerVersion: COMPILER, entry: "index.html", fileCount: 2, totalBytes: 20, files: { "index.html": { sha256: hash, size: 10, contentType: "text/html" }, "audio/a.mp3": { sha256: hash, size: 10, contentType: "audio/mpeg" } }, directories: ["", "audio"], packs: {} };
	const manifestBytes = new TextEncoder().encode(JSON.stringify(m)),
		manifestHash = await sha256(manifestBytes);
	let state = { schemaVersion: 1, state: "ready", releaseId: m.releaseId, manifestSha256: manifestHash, publicationId: "test", commit: "test", shellProtocol: 1, runtimeProtocol: 1, updatedAt: "test" };
	let stateReads = 0,
		edgeReads = 0;
	const pending: Promise<unknown>[] = [];
	const edge = new Map<string, Response>();
	(globalThis as any).caches.default = {
		match: async (r: Request) => {
			edgeReads++;
			return edge.get(r.url)?.clone();
		},
		put: async (r: Request, value: Response) => edge.set(r.url, value.clone()),
	};
	const object = (data: Uint8Array) => ({ size: data.length, body: new Response(data).body, arrayBuffer: async () => data.buffer, json: async () => JSON.parse(new TextDecoder().decode(data)) });
	const env: any = {
		PWA_PREFIX: "noname-pwa/",
		PWA_BUCKET: {
			get: async (key: string, options?: any) => {
				if (key.endsWith("control/state.json")) {
					stateReads++;
					return object(new TextEncoder().encode(JSON.stringify(state)));
				}
				if (key.endsWith("current/manifest.json")) return object(manifestBytes);
				if (key.endsWith("objects/" + hash)) return object(options?.range ? bytes.slice(options.range.offset, options.range.offset + options.range.length) : bytes);
				return null;
			},
			head: async (key: string) => (key.endsWith(hash) ? { size: 10 } : null),
		},
		ASSETS: { fetch: async () => new Response("shell") },
	};
	const ctx: any = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) };
	const fetch = (path: string, init?: RequestInit) => host.fetch(new Request("https://game.invalid" + path, init) as any, env, ctx) as unknown as Promise<Response>;
	const route = `/__pwa/objects/${hash}?releaseId=${m.releaseId}`;
	assert.equal((await fetch(route)).status, 200);
	await Promise.all(pending);
	assert.equal(await (await fetch(route)).text(), "0123456789");
	const range = await fetch(route, { headers: { Range: "bytes=-3" } });
	assert.equal(range.status, 206);
	assert.equal(await range.text(), "789");
	assert.equal(range.headers.get("content-range"), "bytes 7-9/10");
	const head = await fetch(route, { method: "HEAD" });
	assert.equal(head.status, 200);
	assert.equal(await head.text(), "");
	assert.equal(head.headers.get("content-length"), "10");
	assert.equal(head.headers.get("cache-control"), "no-store");
	assert.equal((await fetch(route, { headers: { Range: "bytes=90-" } })).status, 416);
	assert.equal((await fetch(`/__pwa/objects/${hash}?releaseId=old`)).status, 410);
	assert.equal((await fetch(`/__pwa/objects/${"a".repeat(64)}?releaseId=${m.releaseId}`)).status, 404);
	assert.equal((await fetch(`/__pwa/objects/not-a-hash?releaseId=${m.releaseId}`)).status, 400);
	assert.equal((await fetch("/unknown.js")).status, 404);
	assert.equal((await fetch("/index.html")).status, 302);
	const reads = edgeReads;
	state = { ...state, state: "maintenance" };
	assert.equal((await fetch(route)).status, 503);
	assert.equal(edgeReads, reads);
	assert.ok(stateReads >= 8);
	assert.equal((await fetch("/launcher.html")).status, 200);
	assert.equal((await fetch("/__pwa/status")).status, 200);
	state = { ...state, schemaVersion: 999 };
	assert.equal((await (await fetch("/__pwa/status")).json()).state, "maintenance");
});
test("publisher rejects prefix escapes and drains concurrent jobs before reporting failure", async () => {
	assert.throws(() => assertKey("kairisei/object"));
	assert.throws(() => assertKey("noname-pwa/../escape"));
	assertKey("noname-pwa/objects/" + "a".repeat(64));
	let active = 0,
		completed = 0,
		peak = 0;
	await assert.rejects(
		pool([1, 2, 3, 4, 5], 2, async n => {
			active++;
			peak = Math.max(peak, active);
			try {
				await new Promise(resolve => setTimeout(resolve, n === 1 ? 1 : 10));
				if (n === 1) throw new Error("fixture");
				completed++;
			} finally {
				active--;
			}
		})
	);
	assert.equal(active, 0);
	assert.equal(peak, 2);
	assert.equal(completed, 1);
});
