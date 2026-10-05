import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { zipSync } from "fflate";
import { COMPILER, RUNTIME, SCHEMA, contentType, safeArchivePath, validateManifest, type ReleaseManifest } from "../../apps/core/pwa/protocol.ts";
import { pwaBuildNumber } from "./version";
export const digest = (data: Uint8Array | string, algorithm = "sha256") => createHash(algorithm).update(data).digest("hex");
export async function scan(root: string) {
	const files: string[] = [],
		directories = [""];
	async function visit(dir: string) {
		for (const entry of (await fs.readdir(path.join(root, dir), { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
			const name = dir ? `${dir}/${entry.name}` : entry.name;
			safeArchivePath(name);
			if (entry.isSymbolicLink()) throw new Error(`Symlink forbidden: ${name}`);
			if (entry.isDirectory()) {
				directories.push(name);
				await visit(name);
			} else if (entry.isFile()) files.push(name);
			else throw new Error(`Nonregular file: ${name}`);
		}
	}
	await visit("");
	return { files, directories };
}
export async function packageRelease(root = "dist", out = "output/pwa") {
	await fs.rm(out, { recursive: true, force: true });
	await fs.mkdir(`${out}/objects`, { recursive: true });
	await fs.mkdir(`${out}/packs`, { recursive: true });
	await fs.mkdir(`${out}/shell`, { recursive: true });
	const listing = await scan(root);
	const commit = process.env.NONAME_BUILD_COMMIT || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
	const gameVersion = JSON.parse(await fs.readFile("apps/core/package.json", "utf8")).version;
	const manifest: ReleaseManifest = { schemaVersion: SCHEMA, releaseId: "", commit, gameVersion, runtimeProtocol: RUNTIME, compilerVersion: COMPILER, entry: "index.html", fileCount: listing.files.length, totalBytes: 0, files: {}, directories: listing.directories, packs: {} };
	manifest.buildNumber = pwaBuildNumber();
	const seen = new Set<string>();
	let pack: Record<string, Uint8Array> = {},
		packBytes = 0;
	async function flush() {
		if (!Object.keys(pack).length) return;
		const data = zipSync(Object.fromEntries(Object.entries(pack).map(([name, data]) => [name, [data, { level: 0, mtime: new Date(1980, 0, 1, 0, 0, 0) }]])), { level: 0 });
		if (data.length > 16 * 1024 * 1024) throw new Error("Pack size exceeds hard limit");
		const hash = digest(data);
		const files = Object.keys(pack);
		manifest.packs[hash] = { sha256: hash, size: data.length, format: "zip-store-v1", files };
		for (const file of files) manifest.files[file].packId = hash;
		await fs.writeFile(`${out}/packs/${hash}.zip`, data);
		pack = {};
		packBytes = 0;
	}
	for (const file of listing.files) {
		const data = await fs.readFile(path.join(root, file));
		const hash = digest(data);
		manifest.files[file] = { sha256: hash, size: data.length, contentType: contentType(file) };
		manifest.totalBytes += data.length;
		if (!seen.has(hash)) {
			await fs.writeFile(`${out}/objects/${hash}`, data);
			seen.add(hash);
		}
		const cost = data.length + Buffer.byteLength(file) * 2 + 128;
		if (packBytes + cost > 8 * 1024 * 1024) await flush();
		if (cost > 16 * 1024 * 1024 - 22) continue;
		pack[file] = data;
		packBytes += cost;
		if (packBytes >= 8 * 1024 * 1024) await flush();
	}
	await flush();
	manifest.releaseId = `${commit.slice(0, 12)}-${digest(JSON.stringify(manifest)).slice(0, 16)}`;
	validateManifest(manifest);
	await fs.writeFile(`${out}/manifest.json`, JSON.stringify(manifest));
	const shellFiles = JSON.parse(await fs.readFile(`${root}/pwa-shell.json`, "utf8")) as string[];
	for (const file of [...shellFiles, "pwa-shell.json"]) {
		await fs.mkdir(path.dirname(`${out}/shell/${file}`), { recursive: true });
		await fs.copyFile(`${root}/${file}`, `${out}/shell/${file}`);
	}
	await fs.writeFile(`${out}/build.json`, JSON.stringify({ commit, node: process.version, pnpm: execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(), manifestSha256: digest(JSON.stringify(manifest)), fileCount: manifest.fileCount, totalBytes: manifest.totalBytes }));
	console.log(`PWA ${manifest.releaseId}: ${manifest.fileCount} files, ${manifest.totalBytes} bytes, ${Object.keys(manifest.packs).length} packs, ${seen.size} unique objects`);
	return manifest;
}
