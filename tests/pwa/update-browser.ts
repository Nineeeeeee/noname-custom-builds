/** Small real-browser fixture for updates, missing files and suspended installers. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { chromium, webkit, type BrowserContext } from "@playwright/test";
import { buildShell } from "../../scripts/pwa/shell.ts";
import { digest } from "../../scripts/pwa/package.ts";
import { COMPILER, contentType, type ReleaseManifest } from "../../apps/core/pwa/protocol.ts";

const engine = process.env.NONAME_TEST_BROWSER === "webkit" ? webkit : chromium;
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "noname-update-"));
const objects = new Map<string, string>();
const requests: string[] = [];
let context: BrowserContext | undefined;
function release(id: string, text: string): ReleaseManifest {
	const source = { "index.html": "<!doctype html><title>Local game</title>", "probe.txt": text };
	const files = Object.fromEntries(Object.entries(source).map(([name, body]) => {
		const sha256 = digest(body); objects.set(sha256, body);
		return [name, { sha256, size: Buffer.byteLength(body), contentType: contentType(name) }];
	}));
	return { schemaVersion: 1, releaseId: id, commit: "fixture", gameVersion: "fixture", runtimeProtocol: 1, compilerVersion: COMPILER, entry: "index.html", fileCount: 2, totalBytes: Object.values(files).reduce((n, f) => n + f.size, 0), files, directories: [""], packs: {} };
}
let manifest = release("first", "first version");
let held: http.ServerResponse | undefined;
let arrived!: () => void;
const waiting = new Promise<void>(resolve => { arrived = resolve; });
const holdHash = manifest.files["probe.txt"].sha256;
const server = http.createServer(async (request, response) => {
	const url = new URL(request.url!, "http://localhost");
	requests.push(url.pathname);
	if (url.pathname === "/__pwa/status") {
		response.setHeader("Content-Type", "application/json");
		response.end(JSON.stringify({ schemaVersion: 1, state: "ready", runtimeProtocol: 1, shellProtocol: 1, releaseId: manifest.releaseId }));
		return;
	}
	if (url.pathname === "/__pwa/manifest") {
		response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(manifest)); return;
	}
	if (url.pathname.startsWith("/__pwa/objects/")) {
		const hash = url.pathname.split("/").pop()!;
		if (hash === holdHash && !held) { held = response; arrived(); return; }
		response.end(objects.get(hash)); return;
	}
	try {
		const name = url.pathname.slice(1) || "launcher.html";
		let bytes = await fs.readFile(path.join(temporary, "shell", name));
		if (name === "pwa/download-worker.js") bytes = Buffer.concat([Buffer.from('const originalMatch = Cache.prototype.match; Cache.prototype.match = function(...args) { postMessage({type:"cache-read"}); return originalMatch.apply(this,args); };\n'), bytes]);
		response.writeHead(200, { "Content-Type": contentType(name), "Cache-Control": "no-store", "Service-Worker-Allowed": "/" });
		response.end(bytes);
	} catch { response.writeHead(404); response.end(); }
});
try {
	await buildShell(path.join(temporary, "shell"));
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
	context = await engine.launchPersistentContext(path.join(temporary, "profile"), { headless: true, ...(engine === chromium ? { args: ["--no-sandbox", "--disable-dev-shm-usage"] } : {}) });
	await context.addInitScript(() => {
		(window as any).__completed = 0; (window as any).__cacheReads = 0; (window as any).__errors = [];
		const OriginalWorker = Worker;
		window.Worker = class extends OriginalWorker {
			constructor(url: string | URL, options?: WorkerOptions) {
				super(url, options); this.addEventListener("message", event => {
					if (event.data.type === "complete") (window as any).__completed++;
					if (event.data.type === "cache-read") (window as any).__cacheReads++;
					if (event.data.type === "error") (window as any).__errors.push(event.data.message);
				});
			}
		};
	});
	const page = context.pages()[0];
	await page.goto(origin + "/launcher.html");
	await page.waitForFunction(() => !(document.querySelector("#install") as HTMLButtonElement)?.disabled);
	await page.locator("#install").click();
	await waiting;
	// Simulate >60s background suspension while a download waits on the network.
	await page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("noname-pwa-v1", 1); r.onsuccess = () => resolve(r.result); });
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction("locks", "readwrite"), store = tx.objectStore("locks"), r = store.get("install");
			r.onsuccess = () => { r.result.expires = Date.now() - 120000; store.put(r.result, "install"); };
			tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
		}); db.close();
	});
	held!.end(objects.get(holdHash));
	await page.waitForFunction(() => (window as any).__completed === 1, undefined, { timeout: 30000 });
	await page.evaluate(async () => {
		localStorage.setItem("update-sentinel", "keep");
		const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("noname-pwa-v1", 1); r.onsuccess = () => resolve(r.result); });
		await new Promise<void>((resolve, reject) => { const tx = db.transaction("userFiles", "readwrite"); tx.objectStore("userFiles").put({ blob: new Blob(["keep-extension"]), revision: "fixture", modified: Date.now() }, "extension/custom.txt"); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); db.close();
	});
	manifest = release("second", "second version");
	// Wait only for this fixture's two-file cleanup to release ownership.
	await page.waitForFunction(async () => {
		const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("noname-pwa-v1", 1); r.onsuccess = () => resolve(r.result); });
		const idle = await new Promise<boolean>(resolve => { const r = db.transaction("locks").objectStore("locks").get("install"); r.onsuccess = () => resolve(!r.result); }); db.close(); return idle;
	});
	const beforeUpdate = requests.length;
	await page.locator("#install").click();
	await page.waitForFunction(() => (window as any).__completed === 2);
	assert.equal(requests.slice(beforeUpdate).filter(p => p.startsWith("/__pwa/objects/")).length, 1);
	await page.waitForFunction(async () => {
		const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("noname-pwa-v1", 1); r.onsuccess = () => resolve(r.result); });
		const idle = await new Promise<boolean>(resolve => { const r = db.transaction("locks").objectStore("locks").get("install"); r.onsuccess = () => resolve(!r.result); }); db.close(); return idle;
	});
	await page.evaluate(async hash => { await (await caches.open("noname-pwa-content-v1")).delete("/__pwa/cache/sha256/" + hash); }, manifest.files["probe.txt"].sha256);
	const beforeRepair = requests.length;
	await page.locator("#repair").click();
	await page.waitForFunction(() => (window as any).__completed === 3);
	assert.equal(requests.slice(beforeRepair).filter(p => p.startsWith("/__pwa/objects/")).length, 1);
	assert.equal(await page.evaluate(() => (window as any).__cacheReads), 0, "installer must not read existing file bodies for full verification");
	assert.deepEqual(await page.evaluate(() => (window as any).__errors), []);
	assert.equal(await page.evaluate(() => localStorage.getItem("update-sentinel")), "keep");
	assert.equal(await page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("noname-pwa-v1", 1); r.onsuccess = () => resolve(r.result); });
		const file = await new Promise<any>(resolve => { const r = db.transaction("userFiles").objectStore("userFiles").get("extension/custom.txt"); r.onsuccess = () => resolve(r.result); }); db.close(); return file.blob.text();
	}), "keep-extension");
	console.log(JSON.stringify({ engine: engine.name(), expiredOwnerResumed: true, deltaObjects: 1, repairedObjects: 1, existingFileBodiesRead: 0, userDataPreserved: true }));
} finally {
	held?.end(); await context?.close();
	await new Promise<void>(resolve => server.close(() => resolve()));
	await fs.rm(temporary, { recursive: true, force: true });
}
