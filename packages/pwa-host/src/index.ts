import { SCHEMA, RUNTIME, SHELL, validHash, validateManifest, sha256, type ReleaseManifest, type ReleaseState } from "../../../apps/core/pwa/protocol";
import { parseRange } from "../../../apps/core/pwa/range";
interface Env {
	PWA_BUCKET: R2Bucket;
	ASSETS: Fetcher;
	PWA_PREFIX: string;
}
const shell = new Set(["/launcher.html", "/manifest.webmanifest", "/service-worker.js", "/pwa/launcher.js", "/pwa/download-worker.js", "/pwa/icon-180.png", "/pwa/icon-192.png", "/pwa/icon-512.png"]);
let current: { id: string; hash: string; bytes: ArrayBuffer; manifest: ReleaseManifest; objects: Map<string, number> } | undefined;
const error = (message: string, status: number) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
async function state(env: Env): Promise<ReleaseState> {
	try {
		const object = await env.PWA_BUCKET.get(env.PWA_PREFIX + "control/state.json");
		if (!object) throw new Error("No release");
		const data = await object.json<ReleaseState>();
		if (data.schemaVersion !== SCHEMA || data.runtimeProtocol !== RUNTIME || data.shellProtocol !== SHELL || !["maintenance", "ready"].includes(data.state) || (data.state === "ready" && (!data.releaseId || !validHash(data.manifestSha256)))) throw new Error("Invalid state");
		return data;
	} catch {
		return { schemaVersion: SCHEMA, state: "maintenance", publicationId: "", releaseId: "", manifestSha256: "", commit: "", runtimeProtocol: RUNTIME, shellProtocol: SHELL, updatedAt: new Date().toISOString(), message: "正在准备发行内容，请稍后再试" };
	}
}
async function loadManifest(env: Env, s: ReleaseState) {
	if (current?.id === s.releaseId && current.hash === s.manifestSha256) return current;
	const object = await env.PWA_BUCKET.get(env.PWA_PREFIX + "current/manifest.json");
	if (!object) throw new Error("Manifest missing");
	const bytes = await object.arrayBuffer();
	if ((await sha256(bytes)) !== s.manifestSha256) throw new Error("Manifest checksum mismatch");
	const manifest: ReleaseManifest = JSON.parse(new TextDecoder().decode(bytes));
	validateManifest(manifest);
	if (manifest.releaseId !== s.releaseId) throw new Error("Manifest release mismatch");
	current = { id: s.releaseId, hash: s.manifestSha256, bytes, manifest, objects: new Map(Object.values(manifest.files).map(f => [f.sha256, f.size])) };
	return current;
}
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (env.PWA_PREFIX !== "noname-pwa/") return error("Invalid resource prefix", 503);
		const url = new URL(request.url);
		if (!["GET", "HEAD"].includes(request.method)) return error("Method not allowed", 405);
		if (url.pathname === "/" || url.pathname === "/index.html") return Response.redirect(new URL("/launcher.html", url).toString(), 302);
		if (shell.has(url.pathname)) {
			const asset = await env.ASSETS.fetch(request);
			const headers = new Headers(asset.headers);
			headers.set("Cache-Control", "no-cache, no-transform");
			if (url.pathname === "/service-worker.js") {
				headers.set("Content-Type", "text/javascript");
				headers.set("Service-Worker-Allowed", "/");
			}
			return new Response(request.method === "HEAD" ? null : asset.body, { status: asset.status, headers });
		}
		if (!url.pathname.startsWith("/__pwa/")) return error("Not found", 404);
		// Always read authoritative maintenance state before the manifest or edge cache.
		const release = await state(env);
		if (url.pathname === "/__pwa/status") return Response.json(release, { headers: { "Cache-Control": "no-store" } });
		if (release.state !== "ready") return error(release.message || "Maintenance", 503);
		if (url.searchParams.get("releaseId") !== release.releaseId) return error("Update to the current release", 410);
		try {
			const info = await loadManifest(env, release);
			if (url.pathname === "/__pwa/manifest") return new Response(request.method === "HEAD" ? null : info.bytes, { headers: { "Content-Type": "application/json", "Content-Length": String(info.bytes.byteLength), "Cache-Control": "no-store" } });
			const match = /^\/__pwa\/(objects|packs)\/([^/]+)$/.exec(url.pathname);
			if (!match) return error("Not found", 404);
			const [, category, hash] = match;
			if (!validHash(hash)) return error("Invalid hash", 400);
			const size = category === "objects" ? info.objects.get(hash) : info.manifest.packs[hash]?.size;
			if (size === undefined) return error("Object not in current release", 404);
			const range = parseRange(request.headers.get("range"), size);
			const headers = new Headers({ "Content-Type": category === "packs" ? "application/zip" : "application/octet-stream", "Cache-Control": "no-store", "Content-Length": String(size), "Accept-Ranges": "bytes", ETag: `"${hash}"` });
			if (range === false) {
				headers.set("Content-Range", `bytes */${size}`);
				headers.set("Content-Length", "0");
				return new Response(null, { status: 416, headers });
			}
			const key = `${env.PWA_PREFIX}${category}/${hash}${category === "packs" ? ".zip" : ""}`;
			if (range) {
				headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
				headers.set("Content-Length", String(range.end - range.start + 1));
				if (request.method === "HEAD") return new Response(null, { status: 206, headers });
				const object = await env.PWA_BUCKET.get(key, { range: { offset: range.start, length: range.end - range.start + 1 } });
				if (!object) return error("Release object missing", 503);
				return new Response(object.body, { status: 206, headers });
			}
			if (request.method === "HEAD") {
				if (!(await env.PWA_BUCKET.head(key))) return error("Release object missing", 503);
				return new Response(null, { headers });
			}
			const cacheKey = new Request(new URL(`/__edge/${release.releaseId}/${category}/${hash}`, url));
			const cached = await caches.default.match(cacheKey);
			if (cached) return new Response(cached.body, { headers });
			const object = await env.PWA_BUCKET.get(key);
			if (!object || object.size !== size) return error("Release object missing", 503);
			const response = new Response(object.body, { headers });
			const cachedHeaders = new Headers(headers);
			cachedHeaders.set("Cache-Control", "public, max-age=86400");
			ctx.waitUntil(caches.default.put(cacheKey, new Response(response.clone().body, { headers: cachedHeaders })).catch(() => {}));
			return response;
		} catch (cause) {
			console.error("Release unavailable", String(cause));
			return error("Release temporarily unavailable", 503);
		}
	},
} satisfies ExportedHandler<Env>;
