/** Shared by the build, browser and resource Worker. No deployment credentials. */
export const SCHEMA = 1;
export const RUNTIME = 1;
export const SHELL = 1;
export const COMPILER = "typescript-5.9.3_vue-3.5.28_pwa-1";
export interface FileRecord {
	sha256: string;
	size: number;
	contentType: string;
	packId?: string;
}
export interface PackRecord {
	sha256: string;
	size: number;
	format: "zip-store-v1";
	files: string[];
}
export interface ReleaseManifest {
	schemaVersion: number;
	releaseId: string;
	commit: string;
	gameVersion: string;
	buildNumber?: number;
	runtimeProtocol: number;
	compilerVersion: string;
	entry: "index.html";
	fileCount: number;
	totalBytes: number;
	files: Record<string, FileRecord>;
	directories: string[];
	packs: Record<string, PackRecord>;
}
export interface ReleaseState {
	schemaVersion: number;
	state: "ready" | "maintenance";
	publicationId: string;
	releaseId: string;
	manifestSha256: string;
	commit: string;
	shellProtocol: number;
	runtimeProtocol: number;
	updatedAt: string;
	message?: string;
	invitationRequired?: boolean;
}
export function normalizePath(input: string): string {
	if (typeof input !== "string" || /[\0?#]/.test(input)) throw new Error("Invalid file path");
	const parts: string[] = [];
	for (const part of input.replace(/\\/g, "/").split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") {
			if (!parts.length) throw new Error("Path escapes root");
			parts.pop();
		} else parts.push(part);
	}
	return parts.join("/");
}
export function safeArchivePath(input: string): string {
	if (input.startsWith("/") || input.includes("\\") || input.split("/").includes("..")) throw new Error("Unsafe archive path");
	const path = normalizePath(input);
	if (path !== input.replace(/\/$/, "") || !path) throw new Error("Noncanonical archive path");
	return path;
}
export const validHash = (hash: string) => /^[a-f0-9]{64}$/.test(hash);
export function validateManifest(m: ReleaseManifest): void {
	if (m.schemaVersion !== SCHEMA || m.runtimeProtocol !== RUNTIME || m.entry !== "index.html" || !m.releaseId || m.compilerVersion !== COMPILER) throw new Error("发行版协议不兼容，请更新启动器");
	const files = Object.entries(m.files);
	if (!files.length || m.fileCount !== files.length || !m.files["index.html"]) throw new Error("Incomplete manifest");
	let bytes = 0;
	for (const [path, f] of files) {
		if (safeArchivePath(path) !== path || !validHash(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0 || typeof f.contentType !== "string") throw new Error("Invalid file record");
		if (f.packId && !m.packs[f.packId]?.files.includes(path)) throw new Error("Invalid pack reference");
		bytes += f.size;
	}
	if (bytes !== m.totalBytes || !m.directories.includes("")) throw new Error("Invalid release totals");
	for (const dir of m.directories) if (dir && safeArchivePath(dir) !== dir) throw new Error("Invalid directory");
	const assigned = new Set<string>();
	for (const [id, p] of Object.entries(m.packs)) {
		if (id !== p.sha256 || !validHash(id) || p.format !== "zip-store-v1" || p.size > 16 * 1024 * 1024 || !p.files.length) throw new Error("Invalid pack");
		for (const path of p.files) {
			if (!m.files[path] || m.files[path].packId !== id || assigned.has(path)) throw new Error("Invalid pack contents");
			assigned.add(path);
		}
	}
}
export async function sha256(bytes: BufferSource): Promise<string> {
	return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
}
export function contentType(path: string): string {
	const ext = path.split(".").pop()!.toLowerCase();
	return ({ js: "text/javascript", mjs: "text/javascript", ts: "text/plain", vue: "text/plain", css: "text/css", html: "text/html", json: "application/json", webmanifest: "application/manifest+json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", mp4: "video/mp4", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", zip: "application/zip", md: "text/plain", txt: "text/plain" } as Record<string, string>)[ext] || "application/octet-stream";
}
