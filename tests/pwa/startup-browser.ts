/** Installed launcher and actual PWA preload must boot without network checks. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { build } from "esbuild";
import { chromium, type BrowserContext } from "@playwright/test";
import { buildShell } from "../../scripts/pwa/shell.ts";
import { digest } from "../../scripts/pwa/package.ts";
import { COMPILER, contentType, type ReleaseManifest } from "../../apps/core/pwa/protocol.ts";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "noname-startup-"));
let context: BrowserContext | undefined;
let apiRequests = 0;
let state: unknown = { schemaVersion: 1, state: "maintenance", runtimeProtocol: 1, shellProtocol: 1 };
const server = http.createServer(async (request, response) => {
	const url = new URL(request.url!, "http://localhost");
	if (url.pathname.startsWith("/__pwa/")) {
		apiRequests++;
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(JSON.stringify(state));
		return;
	}
	try {
		const name = url.pathname === "/" ? "launcher.html" : url.pathname.slice(1);
		const bytes = await fs.readFile(path.join(temporary, "shell", name));
		response.writeHead(200, { "Content-Type": contentType(name), "Service-Worker-Allowed": "/", "Cache-Control": "no-store" });
		response.end(bytes);
	} catch {
		response.writeHead(404);
		response.end();
	}
});
try {
	await buildShell(path.join(temporary, "shell"));
	const fixture = await build({
		stdin: {
			contents: 'import ready from "./apps/core/noname/init/pwa.ts"; const lib = {}, game = {}; await ready({lib,game}); window.__startupReady = (await lib.fs.read("probe.txt")).length === 5;',
			resolveDir: process.cwd(),
			sourcefile: "startup-fixture.ts",
		},
		bundle: true, format: "esm", target: "chrome91", write: false,
		define: { __LOBBY_URL__: JSON.stringify("wss://lobby.491528.xyz") },
	});
	const files = {
		"index.html": '<!doctype html><script type="module" src="/startup-fixture.js"></script>',
		"startup-fixture.js": fixture.outputFiles[0].text,
		"probe.txt": "local",
	};
	const records = Object.fromEntries(Object.entries(files).map(([name, body]) => [name, { sha256: digest(body), size: Buffer.byteLength(body), contentType: contentType(name) }]));
	const manifest: ReleaseManifest = { schemaVersion: 1, releaseId: "startup-test", commit: "fixture", gameVersion: "fixture", runtimeProtocol: 1, compilerVersion: COMPILER, entry: "index.html", fileCount: 3, totalBytes: Object.values(records).reduce((n, f) => n + f.size, 0), files: records, directories: [""], packs: {} };
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
	const open = async (offline = false) => {
		context = await chromium.launchPersistentContext(path.join(temporary, "profile"), { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
		await context.setOffline(offline);
		await context.addInitScript(() => {
			(window as any).__cacheScans = 0;
			const keys = Cache.prototype.keys;
			Cache.prototype.keys = function (...args) { (window as any).__cacheScans++; return keys.apply(this, args); };
		});
		return context.pages()[0];
	};
	let page = await open();
	await page.goto(origin + "/launcher.html");
	await page.waitForFunction(() => !!navigator.serviceWorker.controller);
	assert.equal(await page.locator("#play").isDisabled(), true);
	await page.evaluate(async ({ manifest, files }) => {
		const cache = await caches.open("noname-pwa-content-v1");
		for (const [name, body] of Object.entries(files)) await cache.put(`/__pwa/cache/sha256/${manifest.files[name].sha256}`, new Response(body, { headers: { "Content-Length": String(manifest.files[name].size) } }));
		const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("noname-pwa-v1", 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(["meta", "releases"], "readwrite");
			tx.objectStore("releases").put(manifest, manifest.releaseId);
			tx.objectStore("meta").put(manifest.releaseId, "activeRelease");
			tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
		});
		db.close();
	}, { manifest, files });
	await context!.close();
	for (const offline of [false, true]) {
		apiRequests = 0;
		page = await open(offline);
		await page.goto(origin + "/launcher.html");
		await page.waitForFunction(() => !(document.querySelector("#play") as HTMLButtonElement)?.disabled);
		assert.equal(apiRequests, 0);
		assert.equal(await page.evaluate(() => (window as any).__cacheScans), 0);
		const started = Date.now();
		await page.locator("#play").click();
		await page.waitForFunction(() => (window as any).__startupReady === true);
		assert.equal(apiRequests, 0);
		assert.equal(await page.evaluate(() => (window as any).__cacheScans), 0);
		console.log(JSON.stringify({ offline, startupMs: Date.now() - started, apiRequests, cacheScans: 0 }));
		await page.clock.install();
		await page.clock.fastForward(61000);
		assert.equal(apiRequests, 0, "game must not poll for updates");
		if (!offline) {
			state = { schemaVersion: 1, state: "ready", runtimeProtocol: 1, shellProtocol: 1, releaseId: manifest.releaseId };
			await page.goto(origin + "/launcher.html");
			await page.waitForFunction(() => !(document.querySelector("#play") as HTMLButtonElement)?.disabled);
			await page.locator("#install").click();
			await page.waitForFunction(() => !(document.querySelector("#install") as HTMLButtonElement)?.disabled);
			assert.equal(apiRequests, 1, "manual update should check status without re-fetching the unchanged manifest");
		}
		await context!.close();
		context = undefined;
	}
} finally {
	await context?.close();
	await new Promise<void>(resolve => server.close(() => resolve()));
	await fs.rm(temporary, { recursive: true, force: true });
}
