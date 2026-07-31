import fs from "fs";
import path from "path";

const publicDir = "android/app/src/main/assets/public";
const manifestName = "noname-asset-manifest.json";

type DirectoryEntry = {
	folders: string[];
	files: string[];
};

const manifest: Record<string, DirectoryEntry> = {};

function collectDirectory(relativeDir = "") {
	const directory = path.join(publicDir, relativeDir);
	const entries = fs
		.readdirSync(directory, { withFileTypes: true })
		.filter(entry => entry.name !== manifestName)
		.sort((a, b) => a.name.localeCompare(b.name));
	const folders = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
	const files = entries.filter(entry => entry.isFile()).map(entry => entry.name);

	manifest[relativeDir.replaceAll("\\", "/").replace(/\/+$/, "")] = {
		folders,
		files,
	};

	for (const folder of folders) {
		collectDirectory(path.join(relativeDir, folder));
	}
}

collectDirectory();
fs.writeFileSync(path.join(publicDir, manifestName), JSON.stringify(manifest));

fs.renameSync(path.join(publicDir, "node_modules/.pnpm"), path.join(publicDir, "node_modules/_pnpm"));
