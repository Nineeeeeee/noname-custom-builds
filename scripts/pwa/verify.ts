import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { unzipSync } from "fflate";
import { digest, scan } from "./package.ts";
import { validateManifest, type ReleaseManifest } from "../../apps/core/pwa/protocol.ts";
export async function verifyRelease(root = "dist", out = "output/pwa") {
	const m: ReleaseManifest = JSON.parse(await fs.readFile(`${out}/manifest.json`, "utf8"));
	validateManifest(m);
	const disk = await scan(root);
	if (JSON.stringify(disk.files.sort()) !== JSON.stringify(Object.keys(m.files).sort()) || JSON.stringify(disk.directories.sort()) !== JSON.stringify([...m.directories].sort())) throw new Error("Manifest differs from complete dist tree");
	const checked = new Set();
	for (const [name, record] of Object.entries(m.files)) {
		const data = await fs.readFile(`${root}/${name}`);
		if (data.length !== record.size || digest(data) !== record.sha256) throw new Error(`dist mismatch: ${name}`);
		if (!checked.has(record.sha256)) {
			const object = await fs.readFile(`${out}/objects/${record.sha256}`);
			if (object.length !== record.size || digest(object) !== record.sha256) throw new Error(`Object mismatch: ${name}`);
			checked.add(record.sha256);
		}
	}
	for (const p of Object.values(m.packs)) {
		const bytes = await fs.readFile(`${out}/packs/${p.sha256}.zip`);
		if (bytes.length !== p.size || digest(bytes) !== p.sha256) throw new Error("Pack checksum mismatch");
		const unpacked = unzipSync(bytes);
		if (JSON.stringify(Object.keys(unpacked).sort()) !== JSON.stringify([...p.files].sort())) throw new Error("Pack path set mismatch");
		for (const name of p.files) if (unpacked[name].length !== m.files[name].size || digest(unpacked[name]) !== m.files[name].sha256) throw new Error(`Pack file mismatch: ${name}`);
	}
	console.log(`Verified complete release ${m.releaseId}: ${m.fileCount} files, ${m.totalBytes} bytes`);
	return m;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await verifyRelease();
