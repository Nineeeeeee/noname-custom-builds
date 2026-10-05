/** Actual SW lifecycle: waiting shell survives GC, cache loss and legacy recovery. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { chromium, webkit, type BrowserContext, type Page } from "@playwright/test";
import { buildShell } from "../../scripts/pwa/shell.ts";
import { COMPILER, contentType, type ReleaseManifest } from "../../apps/core/pwa/protocol.ts";
import { digest } from "../../scripts/pwa/package.ts";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "noname-shell-recovery-"));
let context: BrowserContext | undefined;
let served = "first";
let networkUnavailable = false;
const server = http.createServer(async (request, response) => {
	if (networkUnavailable) {
		response.destroy();
		return;
	}
	const url = new URL(request.url!, "http://localhost");
	try {
		if (url.pathname === "/__pwa/status") {
			response.writeHead(200, { "Content-Type": "application/json" });
			response.end(JSON.stringify({ schemaVersion: 1, state: "maintenance", shellProtocol: 1, runtimeProtocol: 1 }));
			return;
		}
		const name = url.pathname === "/__pwa/recover" ? "pwa/recover.html" : url.pathname.slice(1);
		const bytes = await fs.readFile(path.join(temporary, served, name));
		response.writeHead(200, { "Content-Type": contentType(name), "Cache-Control": "no-store", "Service-Worker-Allowed": "/" });
		response.end(bytes);
	} catch {
		response.writeHead(404);
		response.end();
	}
});
const file = { sha256: digest("installed"), size: 9, contentType: "text/html" };
const manifest: ReleaseManifest = { schemaVersion: 1, releaseId: "installed", commit: "fixture", gameVersion: "fixture", runtimeProtocol: 1, compilerVersion: COMPILER, entry: "index.html", fileCount: 1, totalBytes: 9, files: { "index.html": file }, directories: [""], packs: {} };
async function seed(page: Page) {
	await page.evaluate(async manifest => {
		localStorage.setItem("noname_config_sentinel", "keep");
		const cache = await caches.open("noname-pwa-content-v1");
		await cache.put(`/__pwa/cache/sha256/${manifest.files["index.html"].sha256}`, new Response("installed"));
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const r = indexedDB.open("noname-pwa-v1", 1);
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(["meta", "releases", "userFiles"], "readwrite");
			tx.objectStore("meta").put(manifest.releaseId, "activeRelease");
			tx.objectStore("releases").put(manifest, manifest.releaseId);
			tx.objectStore("userFiles").put({ marker: "keep" }, "extension/private/sentinel.txt");
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
		db.close();
	}, manifest);
}
async function retained(page: Page) {
	assert.equal(
		await page.evaluate(async hash => {
			const db = await new Promise<IDBDatabase>(resolve => {
				const r = indexedDB.open("noname-pwa-v1", 1);
				r.onsuccess = () => resolve(r.result);
			});
			const user = await new Promise<any>(resolve => {
				const r = db.transaction("userFiles").objectStore("userFiles").get("extension/private/sentinel.txt");
				r.onsuccess = () => resolve(r.result);
			});
			db.close();
			const content = await (await caches.open("noname-pwa-content-v1")).match(`/__pwa/cache/sha256/${hash}`);
			return localStorage.getItem("noname_config_sentinel") === "keep" && user.marker === "keep" && (await content?.text()) === "installed";
		}, file.sha256),
		true
	);
}
async function deleteShell(page: Page) {
	await page.evaluate(async () => {
		for (const name of await caches.keys()) if (name.startsWith("noname-pwa-shell-")) await caches.delete(name);
	});
}
try {
	for (const [name, number] of [
		["first", "901"],
		["second", "902"],
		["legacy", "903"],
	]) {
		process.env.NONAME_PWA_BUILD_NUMBER = number;
		await buildShell(path.join(temporary, name));
	}
	// Reproduce the released pre-fix worker without depending on repository HEAD.
	const legacySource = execFileSync("git", ["show", "ef31ed9e06ebb2ba8b9512b9921da4a80adf60ab:apps/core/pwa/service-worker.ts"], { encoding: "utf8" });
	const shellFiles = JSON.parse(await fs.readFile(path.join(temporary, "legacy", "pwa-shell.json"), "utf8")).filter((name: string) => !["service-worker.js", "pwa/recover.html"].includes(name));
	await build({ stdin: { contents: legacySource, resolveDir: path.resolve("apps/core/pwa"), sourcefile: "legacy-sw.ts", loader: "ts" }, outfile: path.join(temporary, "legacy", "service-worker.js"), bundle: true, format: "iife", minify: true, target: ["chrome91", "safari16.4"], define: { __SHELL_FILES__: JSON.stringify(shellFiles), __SHELL_ID__: JSON.stringify("legacy") } });
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
	const browser = process.env.NONAME_TEST_BROWSER === "webkit" ? webkit : chromium;
	const open = async (profile: string) => {
		context = await browser.launchPersistentContext(path.join(temporary, profile), { headless: true });
		return context.pages()[0];
	};
	let page = await open("fixed-profile");
	await page.goto(origin + "/launcher.html");
	await page.waitForFunction(() => !!navigator.serviceWorker.controller);
	await page.waitForFunction(() => document.querySelector("#status")?.textContent === "服务器正在维护，请稍后再打开");
	await seed(page);
	served = "second";
	await page.evaluate(async () => {
		await (await navigator.serviceWorker.getRegistration("/"))!.update();
	});
	await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration("/"))?.waiting);
	const before = await page.evaluate(() => caches.keys());
	assert.equal(before.filter(name => name.startsWith("noname-pwa-shell-")).length, 2, JSON.stringify(before));
	const result = await page.evaluate(
		() =>
			new Promise(resolve => {
				const c = new MessageChannel();
				c.port1.onmessage = e => {
					c.port1.close();
					resolve(e.data);
				};
				navigator.serviceWorker.controller!.postMessage({ type: "gc" }, [c.port2]);
			})
	);
	assert.deepEqual(result, { complete: true });
	assert.deepEqual(await page.evaluate(() => caches.keys()), before, "GC must preserve the waiting worker's shell");
	await page.goto(origin + "/__pwa/recover");
	await page.waitForURL(origin + "/launcher.html");
	assert.match(await page.locator("#shell-version").innerText(), /v902/);
	await deleteShell(page);
	await page.reload();
	await page.waitForFunction(() => !(document.querySelector("#play") as HTMLButtonElement).disabled);
	assert.match(await page.locator("#shell-version").innerText(), /v902/);
	await retained(page);
	networkUnavailable = true;
	await page.reload();
	await page.waitForFunction(() => !(document.querySelector("#play") as HTMLButtonElement).disabled);
	await retained(page);
	await context!.close();
	context = undefined;
	networkUnavailable = false;
	served = "legacy";
	page = await open("legacy-profile");
	await page.goto(origin + "/launcher.html");
	await page.waitForFunction(() => !!navigator.serviceWorker.controller);
	await page.waitForFunction(() => document.querySelector("#status")?.textContent === "服务器正在维护，请稍后再打开");
	await seed(page);
	await deleteShell(page);
	const missing = await page.reload();
	assert.equal(missing!.status(), 503);
	assert.equal(await page.locator("body").innerText(), "Launcher missing");
	served = "second";
	await page.goto(origin + "/__pwa/recover");
	await page.waitForURL(origin + "/launcher.html");
	await page.waitForFunction(() => !(document.querySelector("#play") as HTMLButtonElement).disabled);
	assert.match(await page.locator("#shell-version").innerText(), /v902/);
	await retained(page);
	console.log(JSON.stringify({ browser: browser.name(), waitingShellSurvivesGC: true, missingShellRecovered: true, offlineAfterRecovery: true, legacy503Recovered: true, installedFilesAndUserDataRetained: true }));
} finally {
	await context?.close();
	await new Promise<void>(resolve => server.close(() => resolve()));
	await fs.rm(temporary, { recursive: true, force: true });
}
