/** Real Chromium test. Uses only this process's ephemeral HTTP server. */
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
import { digest } from "../../scripts/pwa/package.ts";
import { contentType, validateManifest, type ReleaseManifest } from "../../apps/core/pwa/protocol.ts";
import { parseRange } from "../../apps/core/pwa/range.ts";
const root = path.resolve("output/pwa"),
	profile = path.resolve(process.env.NONAME_TEST_PROFILE || "output/pwa-browser-profile");
const results: Record<string, unknown> = {};
let m: ReleaseManifest = JSON.parse(await fs.readFile(`${root}/manifest.json`, "utf8"));
const first = m;
let maintenance = false;
const extra = new Map<string, Buffer>();
const requests: { pathname: string; status: number }[] = [];
const server = http.createServer(async (req, res) => {
	try {
		const url = new URL(req.url!, "http://localhost");
		let file: string | undefined,
			bytes: Buffer | undefined,
			type = "application/octet-stream";
		const finish = (status: number, body: string, kind = "application/json") => {
			requests.push({ pathname: url.pathname, status });
			res.writeHead(status, { "Content-Type": kind, "Cache-Control": "no-store" });
			res.end(req.method === "HEAD" ? undefined : body);
		};
		if (url.pathname === "/" || url.pathname === "/index.html") {
			res.writeHead(302, { Location: "/launcher.html" });
			res.end();
			return;
		}
		if (url.pathname === "/__pwa/status") return finish(200, JSON.stringify({ schemaVersion: 1, state: maintenance ? "maintenance" : "ready", releaseId: m.releaseId, manifestSha256: digest(JSON.stringify(m)), publicationId: "browser-fixture", commit: m.commit, runtimeProtocol: 1, shellProtocol: 1, message: maintenance ? "测试维护" : undefined }));
		if (url.pathname.startsWith("/__pwa/")) {
			if (maintenance) return finish(503, "{}");
			if (url.searchParams.get("releaseId") !== m.releaseId) return finish(410, "{}");
			if (url.pathname === "/__pwa/manifest") return finish(200, JSON.stringify(m));
			const match = /^\/__pwa\/(objects|packs)\/([a-f0-9]{64})$/.exec(url.pathname);
			if (!match) return finish(404, "{}");
			const [, category, hash] = match;
			if (category === "objects") {
				if (!Object.values(m.files).some(f => f.sha256 === hash)) return finish(404, "{}");
				bytes = extra.get(hash);
				file = `${root}/objects/${hash}`;
			} else {
				if (!m.packs[hash]) return finish(404, "{}");
				file = `${root}/packs/${hash}.zip`;
				type = "application/zip";
			}
		} else {
			const shell = JSON.parse(await fs.readFile(`${root}/shell/pwa-shell.json`, "utf8"));
			const relative = url.pathname.slice(1);
			if (!shell.includes(relative)) return finish(404, "Not found", "text/plain");
			file = `${root}/shell/${relative}`;
			type = contentType(relative);
		}
		const size = bytes?.length ?? (await fs.stat(file!)).size;
		const range = parseRange(req.headers.range || null, size);
		const headers: Record<string, string> = { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes", "Cache-Control": "no-store", "Service-Worker-Allowed": "/" };
		if (range === false) {
			res.writeHead(416, { ...headers, "Content-Length": "0", "Content-Range": `bytes */${size}` });
			res.end();
			return;
		}
		const status = range ? 206 : 200;
		if (range) {
			headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
			headers["Content-Length"] = String(range.end - range.start + 1);
		}
		requests.push({ pathname: url.pathname, status });
		res.writeHead(status, headers);
		if (req.method === "HEAD") res.end();
		else if (bytes) res.end(range ? bytes.subarray(range.start, range.end + 1) : bytes);
		else createReadStream(file!, range ? { start: range.start, end: range.end } : undefined).pipe(res);
	} catch (error) {
		res.writeHead(500);
		res.end(String(error));
	}
});
await new Promise<void>(resolve => server.listen(Number(process.env.NONAME_TEST_PORT) || 0, "127.0.0.1", resolve));
const port = (server.address() as any).port,
	origin = `http://127.0.0.1:${port}`;
let context: BrowserContext | undefined;
const errors: string[] = [];
const executablePath = process.env.NONAME_TEST_CHROME;
async function open(offline = false) {
	context = await chromium.launchPersistentContext(profile, { executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"], viewport: { width: 1280, height: 800 } });
	await context.setOffline(offline);
	await context.addInitScript(() => {
		try {
			localStorage.setItem("gplv3_noname_alerted", "true");
		} catch {}
		const NativeWorker = window.Worker;
		(window as any).__pwaTestCompleted = 0;
		window.Worker = class extends NativeWorker {
			constructor(url: string | URL, options?: WorkerOptions) {
				super(url, options);
				this.addEventListener("message", event => {
					if (event.data?.type === "complete") (window as any).__pwaTestCompleted++;
				});
			}
		};
	});
	context.setDefaultTimeout(30000);
	context.on("page", page => observe(page));
	console.log("Context ready");
	const page = context.pages()[0] || (await context.newPage());
	observe(page);
	console.log("Page ready");
	return page;
}
function observe(page: Page) {
	page.on("framenavigated", frame => {
		if (frame === page.mainFrame()) console.log("NAVIGATED", frame.url());
	});
	page.on("worker", worker => worker.evaluate(() => self.addEventListener("message", event => console.log("WORKER COMMAND", event.data.type))).catch(() => {}));
	page.on("console", msg => {
		if (msg.type() === "error" || msg.type() === "warning" || msg.text().startsWith("WORKER COMMAND")) console.log("CONSOLE", msg.type(), msg.text());
	});
	page.on("response", response => {
		if (response.status() >= 400) console.log("HTTP ERROR", response.status(), response.url());
	});
	page.on("pageerror", error => {
		errors.push(String(error));
		console.log("BROWSER ERROR", String(error));
	});
	page.on("dialog", dialog => dialog.accept());
}
async function ready(page: Page) {
	await page.waitForFunction(() => !(document.querySelector("#install") as HTMLButtonElement)?.disabled, { timeout: 60000 });
}
async function install(page: Page, deep = false) {
	const completed = await page.evaluate(() => (window as any).__pwaTestCompleted);
	console.log("INSTALL CLICK", deep, await page.locator("#status").textContent());
	await page.locator(deep ? "#repair" : "#install").click();
	await page.waitForFunction(previous => (window as any).__pwaTestCompleted > previous && (document.querySelector("#status")?.textContent || "").includes("完整安装已就绪") && !(document.querySelector("#play") as HTMLButtonElement)?.disabled, completed, { timeout: 1200000 });
}
async function game(page: Page) {
	console.log("PLAY CLICK");
	await page.locator("#play").click();
	await page.waitForURL("**/index.html?*");
	console.log("GAME URL", page.url());
	await page.waitForSelector("#splash, #arena", { timeout: 30000 });
}
const timer = setInterval(async () => {
	try {
		const page = context?.pages().find(p => p.url().includes("launcher"));
		if (page) console.log("DOWNLOAD", await page.locator("#status").textContent(), await page.locator("#detail").textContent());
	} catch {}
}, 30000);
try {
	console.log("Test server", origin);
	let page = await open();
	await page.goto(origin + "/launcher.html");
	await ready(page);
	const existingCacheCount = await page.evaluate(async () => (await (await caches.open("noname-pwa-content-v1")).keys()).length);
	console.log("Existing cache", existingCacheCount, "play disabled", await page.locator("#play").isDisabled());
	if ((await page.locator("#play").isDisabled()) && existingCacheCount === 0) {
		await page.locator("#install").click();
		let cached = 0;
		const downloadDeadline = Date.now() + 120000;
		while (cached <= 10 && Date.now() < downloadDeadline) {
			cached = await page.evaluate(async () => (await (await caches.open("noname-pwa-content-v1")).keys()).length);
			await new Promise(resolve => setTimeout(resolve, 250));
		}
		assert.ok(cached > 10, "Download did not write verified files");
		await page.locator("#pause").click();
		await page.waitForFunction(() => !(document.querySelector("#install") as HTMLButtonElement).disabled, { timeout: 60000 });
		const cachedBeforeResume = await page.evaluate(async () => (await (await caches.open("noname-pwa-content-v1")).keys()).length);
		assert.ok(cachedBeforeResume > 0);
		await page.reload();
		await ready(page);
		await install(page);
		results.resumedFiles = cachedBeforeResume;
	} else {
		console.log("Reusing test cache");
		if (await page.locator("#play").isDisabled()) await install(page);
	}
	console.log("Full installation finished");
	await page.screenshot({ path: "output/pwa-browser-installed.png" });
	await page.evaluate(() => localStorage.setItem("pwa-preserve-sentinel", "keep"));
	await game(page);
	console.log("Game entry loaded", page.url());
	// Game engine globals are exposed by its noname module, without test-only production hooks.
	const runtime = await page.evaluate(async () => {
		const { lib, game } = await import("/noname.js");
		await game.promises.saveConfig("show_splash", "always");
		await game.promises.saveConfig("new_tutorial", true);
		const { get } = await import("/noname.js");
		const zip = await get.promises.zip();
		zip.file("info.json", JSON.stringify({ name: "PWA导入测试", version: "1.0.0" }));
		zip.file("extension.ts", 'export const type = "extension"; export default () => ({name:"PWA导入测试",config:{},content(){},precontent(){},package:{intro:"offline import fixture"},files:{character:[],card:[],skill:[],audio:[]}})');
		await game.importExtension(zip.generate({ type: "arraybuffer" }));
		if (!lib.config.extensions.includes("PWA导入测试")) throw new Error("Actual ZIP import failed");
		await lib.fs.writeText("extension/PWA导入测试/edited.txt", "keep-extension-edit");
		await lib.fs.createDir("extension/PWA测试", { recursive: true });
		await lib.fs.writeText("extension/PWA测试/dep.ts", "export const number: number = 7");
		await lib.fs.writeText("extension/PWA测试/main.ts", 'import {number} from "./dep.ts"; export default number');
		await lib.fs.writeText("extension/PWA测试/raw.txt", '中文 ` ${原始内容}\n"文字"');
		const module = await import("/extension/PWA测试/main.ts?pwa_rev=first");
		const raw = await import("/extension/PWA测试/raw.txt?raw");
		await lib.fs.writeText("extension/PWA测试/dep.ts", "export const number: number = 8");
		const changed = await import("/extension/PWA测试/main.ts?pwa_rev=second");
		await lib.fs.writeText("extension/PWA测试/test.vue", '<script setup lang="ts">const count: number = 1</script><template><b>{{count}}</b></template><style scoped>b{color:red}</style>');
		const vue = await import("/extension/PWA测试/test.vue");
		await game.putDB("config", "pwa_preserve_config", "keep-config");
		await new Promise<void>((resolve, reject) => {
			const tx = lib.db.transaction(["video"], "readwrite");
			tx.objectStore("video").put({ time: 123456789, name: ["PWA test"], video: ["keep-recording"] });
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
		await game.putDB("image", "pwa-preserve-image", new Blob(["keep-image"]));
		await game.putDB("audio", "pwa-preserve-audio", new Blob(["keep-audio"]));
		await lib.fs.writeText("extension/PWA测试/worker.ts", "self.onmessage = (event: MessageEvent) => self.postMessage(event.data + 1)");
		const { default: OfflineWorker } = await import("/extension/PWA测试/worker.ts?worker&module");
		const offlineWorker = new OfflineWorker();
		const workerResult = await new Promise((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("Offline worker failed")), 10000);
			offlineWorker.onmessage = event => {
				clearTimeout(timeout);
				resolve(event.data);
			};
			offlineWorker.onerror = reject;
			offlineWorker.postMessage(41);
		});
		offlineWorker.terminate();
		return { pwa: lib.pwa, fs: !!lib.fs, extensionZipImport: true, first: module.default, second: changed.default, raw: raw.default, vue: !!vue.default, workerResult, download: typeof game.download };
	});
	assert.equal(runtime.first, 7);
	assert.equal(runtime.second, 8);
	assert.equal(runtime.pwa, true);
	assert.ok(runtime.vue);
	assert.equal(runtime.workerResult, 42);
	assert.equal(runtime.raw, '中文 ` ${原始内容}\n"文字"');
	results.runtime = runtime;
	const audioPath = Object.keys(m.files).find(p => p.endsWith(".mp3"))!;
	const range = await page.evaluate(async (path: string) => {
		const r = await fetch("/" + path, { headers: { Range: "bytes=2-8" } });
		return { status: r.status, size: (await r.arrayBuffer()).byteLength, range: r.headers.get("content-range") };
	}, audioPath);
	assert.equal(range.status, 206);
	assert.equal(range.size, 7);
	results.mediaRange = range;
	// Keep this game page alive during installation of a two-file delta.
	const iconPath = "image/app-icon.svg",
		skillPath = "extension/my-wudi/extension.js";
	const oldIcon = await page.evaluate(async p => await (await fetch("/" + p)).text(), iconPath);
	const next = structuredClone(m);
	next.packs = {};
	for (const f of Object.values(next.files)) delete f.packId;
	let changedBytes = 0;
	for (const p of [iconPath, skillPath]) {
		const original = await fs.readFile(`dist/${p}`);
		const bytes = Buffer.from(original.toString() + (p.endsWith(".svg") ? "\n<!-- difference fixture -->" : "\n// skill difference fixture\n"));
		const hash = digest(bytes);
		extra.set(hash, bytes);
		next.files[p] = { ...next.files[p], sha256: hash, size: bytes.length };
		next.totalBytes += bytes.length - original.length;
		changedBytes += bytes.length;
	}
	next.releaseId += "-delta";
	validateManifest(next);
	m = next;
	const launcher = await context!.newPage();
	await launcher.goto(origin + "/launcher.html");
	await ready(launcher);
	const beforeDelta = requests.length;
	await install(launcher);
	const deltaRequests = requests.slice(beforeDelta).filter(r => /^\/__pwa\/(objects|packs)\//.test(r.pathname));
	assert.equal(deltaRequests.length, 2);
	assert.ok(deltaRequests.every(r => r.pathname.includes("/objects/")));
	assert.equal(await page.evaluate(async p => await (await fetch("/" + p)).text(), iconPath), oldIcon);
	results.pinnedOldSession = true;
	results.delta = { files: deltaRequests.length, bytes: changedBytes };
	assert.equal(await launcher.evaluate(() => localStorage.getItem("pwa-preserve-sentinel")), "keep");
	await page.close();
	await game(launcher);
	assert.ok((await launcher.evaluate(async p => await (await fetch("/" + p)).text(), iconPath)).includes("difference fixture"));
	const kept = await launcher.evaluate(async () => {
		const { lib } = await import("/noname.js");
		return await lib.fs.readText("extension/PWA测试/dep.ts");
	});
	assert.ok(kept.includes("8"));
	results.userFilesPreserved = true;
	const preservedData = await launcher.evaluate(async () => {
		const { game } = await import("/noname.js");
		return { config: await game.getDB("config", "pwa_preserve_config"), video: (await game.getDB("video", 123456789)).video[0], image: await (await game.getDB("image", "pwa-preserve-image")).text(), audio: await (await game.getDB("audio", "pwa-preserve-audio")).text() };
	});
	assert.deepEqual(preservedData, { config: "keep-config", video: "keep-recording", image: "keep-image", audio: "keep-audio" });
	results.gameDataPreserved = preservedData;
	await launcher.close();
	page = await context!.newPage();
	await page.goto(origin + "/launcher.html");
	await ready(page);
	const damagedPath = "image/app-icon.svg",
		damaged = m.files[damagedPath];
	await page.evaluate(async record => {
		const cache = await caches.open("noname-pwa-content-v1");
		await cache.delete("/__pwa/cache/sha256/" + record.sha256);
	}, damaged);
	const beforeRepair = requests.length;
	await install(page, true);
	const repairRequests = requests.slice(beforeRepair).filter(r => r.pathname.startsWith("/__pwa/objects/"));
	assert.equal(repairRequests.length, 1);
	results.repair = { files: 1 };
	maintenance = true;
	await page.reload();
	await ready(page);
	await page.locator("#install").click();
	await page.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("维护"));
	assert.equal(await page.locator("#play").isDisabled(), false);
	results.localPlayDuringMaintenance = true;
	await context!.close();
	context = undefined;
	// Entire browser process closes; a new process starts with network disabled before navigation.
	// Also remove the origin server: Chromium's offline emulation may not cover a
	// restarted Service Worker network target in a persistent browser profile.
	await new Promise<void>(resolve => {
		server.close(() => resolve());
		server.closeAllConnections();
	});
	const requestsBeforeCold = requests.length;
	page = await open(true);
	await page.goto(origin + "/launcher.html");
	await page.waitForFunction(() => !(document.querySelector("#play") as HTMLButtonElement)?.disabled, undefined, { timeout: 120000 });
	await game(page);
	assert.equal(requests.length, requestsBeforeCold);
	results.offlineColdStart = true;
	const offlineFiles = await page.evaluate(async () => {
		const { lib } = await import("/noname.js");
		return { user: await lib.fs.readText("extension/PWA测试/dep.ts"), modes: (await lib.fs.list("mode")).length, extensions: (await lib.fs.list("extension")).map(e => e.name) };
	});
	assert.ok(offlineFiles.user.includes("8"));
	results.offlineFiles = offlineFiles;
	await page.screenshot({ path: "output/pwa-browser-offline.png" });
	// Load every mode/card/character entry and extension file from the actual offline store.
	const inventory = Object.keys(m.files).filter(p => /^(mode|character|card|extension)\//.test(p) && /\.(js|ts|vue)$/.test(p));
	const inventoryResult = await page.evaluate(async paths => {
		let ok = 0;
		for (const p of paths) {
			const r = await fetch("/" + p);
			if (!r.ok) throw new Error("Missing " + p);
			await r.arrayBuffer();
			ok++;
		}
		return ok;
	}, inventory);
	assert.equal(inventoryResult, inventory.length);
	results.offlineCodeInventory = inventoryResult;
	// Start a real two-player identity game entirely offline and let the game's AI play.
	await page.evaluate(async () => {
		const { lib } = await import("/noname.js");
		lib.config.mode_config.identity.player_number = "2";
		lib.config.game_speed = "vvfast";
		lib.config.duration = 0;
	});
	await page.locator('#splash [link="identity"]').click();
	const autoDeadline = Date.now() + 60000;
	while (
		!(await page.evaluate(async () => {
			const { ui } = await import("/noname.js");
			return !!ui.auto;
		}))
	) {
		assert.ok(Date.now() < autoDeadline, "Identity mode did not initialize");
		await new Promise(resolve => setTimeout(resolve, 250));
	}
	await page.evaluate(async () => {
		const { ui, _status } = await import("/noname.js");
		if (!_status.auto) ui.click.auto("forced");
	});
	const gameDeadline = Date.now() + 180000;
	let over = false;
	while (!over && Date.now() < gameDeadline) {
		over = await page.evaluate(async () => {
			const { _status } = await import("/noname.js");
			return !!_status.over;
		});
		await new Promise(resolve => setTimeout(resolve, 1000));
	}
	results.offlineIdentityGame = await page.evaluate(async () => {
		const { game, _status } = await import("/noname.js");
		return { complete: !!_status.over, rounds: game.roundNumber, players: game.players.length + game.dead.length };
	});
	assert.ok(over, "Offline identity game did not finish");
	results.pageErrors = errors;
	assert.equal(errors.length, 0);
	console.log(JSON.stringify(results, null, 2));
} catch (error) {
	console.error("TEST FAILED", error);
	for (const page of context?.pages() || []) {
		try {
			console.log("FAILED PAGE", page.url(), await page.locator("body").innerText());
			await page.screenshot({ path: "output/pwa-browser-failed.png" });
		} catch {}
	}
	throw error;
} finally {
	clearInterval(timer);
	await context?.close();
	if (server.listening)
		await new Promise<void>(resolve => {
			server.close(() => resolve());
			server.closeAllConnections();
		});
	await fs.writeFile("output/pwa-browser-results.json", JSON.stringify(results, null, 2));
}
