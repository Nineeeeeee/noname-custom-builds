/// <reference lib="WebWorker" />
import { SHELL, RUNTIME, COMPILER, contentType, normalizePath, sha256, type ReleaseManifest } from "./protocol";
import { CONTENT_CACHE, COMPILED_CACHE, activeManifest, get, put, entries, readLocal, acquireLease, renewLease, releaseLease, withLease } from "./storage";
import { localResponse } from "./range";
import * as strategies from "../../../packages/jit/src/service-worker/compile-strategy";
declare const __SHELL_FILES__: string[];
declare const __SHELL_ID__: string;
const sw = globalThis as unknown as ServiceWorkerGlobalScope;
const shellCache = `noname-pwa-shell-${__SHELL_ID__}`;
const shellFiles = new Set(__SHELL_FILES__.map(p => "/" + p));
const manifests = new Map<string, ReleaseManifest>();
const compilerStrategies = [new strategies.RawResourceStrategy(), new strategies.WorkerResourceStrategy(), new strategies.UrlResourceStrategy(), new strategies.JSONStrategy(), new strategies.TSStrategy({ allowJs: false }), new strategies.CSSStrategy(), new strategies.VueSFCStrategy()];
sw.addEventListener("install", event => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(shellCache);
			for (const path of shellFiles) {
				const response = await fetch(path, { cache: "reload" });
				if (!response.ok) throw new Error(`Shell missing: ${path}`);
				await cache.put(path, response);
			}
			// An update stays waiting until the launcher confirms all game sessions have exited.
		})()
	);
});
sw.addEventListener("activate", event => {
	event.waitUntil(sw.clients.claim());
});
async function manifest(id: string): Promise<ReleaseManifest | undefined> {
	let m = manifests.get(id);
	if (!m) {
		m = await get<ReleaseManifest>("releases", id);
		if (m) manifests.set(id, m);
	}
	return m;
}
async function pinned(id: string): Promise<string | undefined> {
	return id ? get<string>("clients", id) : undefined;
}
async function gc() {
	const lease = await acquireLease("sw-" + crypto.randomUUID());
	try {
		const active = await get<string>("meta", "activeRelease"),
			target = await get<string>("meta", "installTarget");
		const refs = new Set([active, target]);
		const liveClients = await sw.clients.matchAll({ includeUncontrolled: true });
		const live = new Set(liveClients.map(c => c.id));
		const clients = await entries<string>("clients");
		for (const [id, release] of clients) if (live.has(id)) refs.add(release);
		const hashes = new Set<string>();
		for (const id of refs)
			if (id) {
				const m = await manifest(id);
				if (m) for (const f of Object.values(m.files)) hashes.add(f.sha256);
			}
		const cache = await caches.open(CONTENT_CACHE);
		let renewedAt = Date.now();
		for (const key of await cache.keys()) {
			if (Date.now() - renewedAt > 10000) {
				await renewLease(lease);
				renewedAt = Date.now();
			}
			if (!hashes.has(new URL(key.url).pathname.split("/").pop()!)) {
				await withLease<void>(lease, [], () => {});
				await cache.delete(key);
			}
		}
		await renewLease(lease);
		await withLease<void>(lease, ["clients", "releases", "downloads"], tx => {
			for (const [id] of clients) if (!live.has(id)) tx.objectStore("clients").delete(id);
			const cursor = tx.objectStore("releases").openCursor();
			cursor.onsuccess = () => {
				const c = cursor.result;
				if (c) {
					if (!refs.has(String(c.key))) c.delete();
					c.continue();
				}
			};
			const downloads = tx.objectStore("downloads").openCursor();
			downloads.onsuccess = () => {
				const c = downloads.result;
				if (c) {
					if (!refs.has(String((c.key as string[])[0]))) c.delete();
					c.continue();
				}
			};
		});
		for (const name of await caches.keys()) if (name.startsWith("noname-pwa-shell-") && name !== shellCache) await caches.delete(name);
		if (!liveClients.some(c => !["/", "/launcher.html"].includes(new URL(c.url).pathname))) await caches.delete(COMPILED_CACHE);
	} finally {
		await releaseLease(lease);
	}
}
sw.addEventListener("message", event => {
	event.waitUntil(
		(async () => {
			try {
				let result: unknown = {};
				if (event.data.type === "handshake") result = { runtime: RUNTIME, shell: SHELL };
				if (event.data.type === "pin") {
					const m = await manifest(event.data.releaseId);
					if (!m || m.runtimeProtocol !== RUNTIME) throw new Error("发行版未就绪");
					await put("clients", (event.source as Client).id, m.releaseId);
					result = { releaseId: m.releaseId };
				}
				if (event.data.type === "activate") {
					const games = (await sw.clients.matchAll({ includeUncontrolled: true })).filter(c => new URL(c.url).pathname !== "/launcher.html" && new URL(c.url).pathname !== "/");
					if (games.length === 0) {
						await sw.skipWaiting();
						result = { activated: true };
					} else result = { activated: false };
				}
				if (event.data.type === "gc") {
					await gc();
					result = { complete: true };
				}
				event.ports[0]?.postMessage(result);
			} catch (error) {
				event.ports[0]?.postMessage({ error: String(error instanceof Error ? error.message : error) });
			}
		})()
	);
});
function revisions(code: string, url: URL, revision: string) {
	// Only module specifiers. Preserve relative URL bases and all defined query controls.
	const append = (spec: string) => {
		if (!spec.startsWith(".") && !spec.startsWith("/")) return spec;
		const mapped = new URL(spec, url);
		if (mapped.origin !== url.origin) return spec;
		mapped.searchParams.set("pwa_rev", revision);
		return mapped.href;
	};
	return code.replace(/(\b(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?)(["'])([^"']+)\2/g, (_m, prefix, quote, spec) => prefix + quote + append(spec) + quote).replace(/(\bimport\s*\(\s*)(["'])([^"']+)\2/g, (_m, prefix, quote, spec) => prefix + quote + append(spec) + quote);
}
async function route(event: FetchEvent): Promise<Response> {
	const request = event.request,
		url = new URL(request.url);
	if (url.origin !== sw.location.origin) return fetch(request);
	if (url.pathname.startsWith("/__pwa/")) {
		if (url.pathname.startsWith("/__pwa/cache/")) return new Response("Not public", { status: 404 });
		return fetch(request, { cache: "no-store" });
	}
	if (url.pathname === "/service-worker.js") return fetch(request, { cache: "no-store" });
	if (url.pathname === "/") return Response.redirect(new URL("/launcher.html", url), 302);
	if (shellFiles.has(url.pathname)) return (await (await caches.open(shellCache)).match(url.pathname)) || new Response("Launcher missing", { status: 503 });
	if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
	let releaseId = await pinned(event.clientId);
	if (request.mode === "navigate") {
		const explicit = url.searchParams.get("release");
		if (explicit && ["/index.html", "/pwa/realm.html"].includes(url.pathname)) releaseId = explicit;
		if (!releaseId && url.pathname === "/index.html") releaseId = (await activeManifest())?.releaseId;
		if (releaseId && event.resultingClientId) await put("clients", event.resultingClientId, releaseId);
	}
	// Requests from Blob-based workers/iframes may carry a same-origin referrer.
	if (!releaseId && request.referrer) {
		const ref = new URL(request.referrer);
		for (const c of await sw.clients.matchAll())
			if (c.url === ref.href) {
				releaseId = await pinned(c.id);
				if (releaseId && event.clientId) await put("clients", event.clientId, releaseId);
				break;
			}
	}
	const m = releaseId ? await manifest(releaseId) : undefined;
	if (!m || m.runtimeProtocol !== RUNTIME) return request.mode === "navigate" ? Response.redirect(new URL("/launcher.html", url), 302) : new Response("Open launcher first", { status: 409 });
	let path: string;
	try {
		path = normalizePath(decodeURIComponent(url.pathname));
	} catch {
		return new Response("Invalid path", { status: 400 });
	}
	const local = await readLocal(path, m);
	if (!local) {
		if (m.files[path]) {
			const c = event.clientId ? await sw.clients.get(event.clientId) : undefined;
			c?.postMessage({ type: "repair", path });
		}
		return new Response("Local file unavailable; use launcher repair", { status: 404, headers: { "Content-Type": "text/plain" } });
	}
	const vuePath = Object.keys(m.files).find(p => p.endsWith("/vue/dist/vue.esm-browser.js"));
	const importMap = { noname: "/noname.js", vue: vuePath ? "/" + vuePath : "/vue/dist/vue.esm-browser.js" };
	const ctx: strategies.RequestContext = {
		event,
		request,
		url,
		importMap,
		readSource: async source => {
			const sourcePath = normalizePath(decodeURIComponent(new URL(source).pathname));
			const sourceFile = await readLocal(sourcePath, m);
			return sourceFile?.response || new Response("Local compilation source missing", { status: 404 });
		},
	};
	const strategy = compilerStrategies.find(s => s.match(ctx));
	const extensionModule = path.startsWith("extension/") && /\.(js|mjs|ts|vue)$/.test(path) && !url.searchParams.has("raw");
	if (strategy || extensionModule) {
		const revision = url.searchParams.get("pwa_rev") || (await get<string>("meta", "userRevision")) || "0";
		if (path.endsWith(".vue")) url.searchParams.set("pwa_rev", revision);
		const keyHash = await sha256(new TextEncoder().encode(JSON.stringify([COMPILER, local.hash, path, url.search, request.destination, request.headers.get("accept"), revision])));
		const key = new URL(`/__pwa/compiled/${keyHash}`, url).href,
			cache = await caches.open(COMPILED_CACHE);
		let compiled = await cache.match(key);
		if (!compiled) {
			let transformed = strategy ? await strategy.process({ ...ctx, request: path.endsWith(".vue") ? new Request(url) : request }) : local.response;
			if (!transformed.ok) return transformed;
			let code = await transformed.text();
			if (extensionModule) code = revisions(code, url, revision);
			compiled = new Response(code, { headers: { "Content-Type": "text/javascript", "Content-Length": String(new TextEncoder().encode(code).length) } });
			await cache.put(key, compiled.clone());
		}
		return request.method === "HEAD" ? new Response(null, { headers: compiled.headers }) : compiled;
	}
	return localResponse(local.response, request, m.files[path]?.contentType || contentType(path), local.size);
}
sw.addEventListener("fetch", event => {
	event.respondWith(
		route(event).catch(error => {
			// Preserve a failed network request as a network failure. Synthesizing HTTP 500
			// here would make the launcher mistake a disconnected device for maintenance.
			if (new URL(event.request.url).pathname.startsWith("/__pwa/")) return Response.error();
			console.error(error);
			return new Response("Local runtime error; open launcher repair", { status: 500, headers: { "Content-Type": "text/plain" } });
		})
	);
});
