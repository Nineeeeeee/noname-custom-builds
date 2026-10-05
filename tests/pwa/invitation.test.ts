import { test } from "node:test";
import assert from "node:assert/strict";
import host from "../../packages/pwa-host/src/index.ts";
test("invitation rejects strangers, forged/expired/rotated sessions and throttled traffic without any R2 access", async () => {
	let reads = 0,
		allowLogin = true,
		allowDownload = true;
	const env: any = {
		PWA_PREFIX: "noname-pwa/",
		PWA_INVITE_CODE: "test-only-random-invitation",
		INVITE_LOGIN_LIMIT: { limit: async () => ({ success: allowLogin }) },
		INVITE_DOWNLOAD_LIMIT: { limit: async () => ({ success: allowDownload }) },
		PWA_BUCKET: {
			get: async () => {
				reads++;
				return null;
			},
			head: async () => {
				reads++;
				return null;
			},
		},
		ASSETS: { fetch: async () => new Response("public shell") },
	};
	const ctx: any = { waitUntil() {} };
	const fetch = (path: string, init?: RequestInit, origin = "https://invite.invalid") => host.fetch(new Request(origin + path, init) as any, env, ctx) as unknown as Promise<Response>;
	const auth = (code: string, extra: Record<string, string> = {}) => fetch("/__pwa/auth", { method: "POST", headers: { "Content-Type": "application/json", ...extra }, body: JSON.stringify({ code }) });
	const resource = "/__pwa/objects/" + "a".repeat(64) + "?releaseId=test";
	for (const path of ["/__pwa/status", "/__pwa/manifest?releaseId=test", resource, resource.replace("objects", "packs")]) {
		assert.equal((await fetch(path)).status, 401);
		assert.equal((await fetch(path, { headers: { Cookie: "__Host-noname_invite=forged" } })).status, 401);
	}
	assert.equal((await auth("incorrect")).status, 401);
	assert.equal((await auth(env.PWA_INVITE_CODE, { Origin: "https://attacker.invalid" })).status, 403);
	assert.equal((await fetch("/__pwa/auth")).status, 200);
	assert.equal((await fetch("/launcher.html")).status, 200);
	assert.equal(reads, 0);
	allowLogin = false;
	assert.equal((await auth(env.PWA_INVITE_CODE)).status, 429);
	allowLogin = true;
	const login = await auth(env.PWA_INVITE_CODE);
	assert.equal(login.status, 200);
	const setCookie = login.headers.get("Set-Cookie")!;
	assert.match(setCookie, /Secure; HttpOnly; SameSite=Strict/);
	assert.ok(!setCookie.includes(env.PWA_INVITE_CODE));
	const cookie = setCookie.split(";")[0];
	assert.equal((await (await fetch("/__pwa/auth", { headers: { Cookie: cookie } })).json()).authenticated, true);
	assert.equal((await fetch(resource, { headers: { Cookie: cookie } }, "https://other.invalid")).status, 401);
	assert.equal((await fetch(resource, { headers: { Cookie: cookie.replace(/=\d+/, "=1000000000") } })).status, 401);
	const tampered = cookie.slice(0, -1) + (cookie.endsWith("a") ? "b" : "a");
	assert.equal((await fetch(resource, { headers: { Cookie: tampered } })).status, 401);
	allowDownload = false;
	const limited = await fetch(resource, { headers: { Cookie: cookie } });
	assert.equal(limited.status, 429);
	assert.equal(limited.headers.get("Retry-After"), "60");
	allowDownload = true;
	env.PWA_INVITE_CODE = "test-only-rotated-invitation";
	assert.equal((await fetch(resource, { headers: { Cookie: cookie } })).status, 401);
	env.PWA_INVITE_CODE = undefined;
	assert.equal((await fetch(resource, { headers: { Cookie: cookie } })).status, 503);
	assert.equal(reads, 0);
	env.PWA_INVITE_CODE = "test-only-random-invitation";
	assert.equal((await fetch("/__pwa/status", { headers: { Cookie: cookie } })).status, 200);
	assert.equal(reads, 1);
});
