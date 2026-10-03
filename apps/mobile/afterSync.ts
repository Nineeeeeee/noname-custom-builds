import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { spawnSync } from "child_process";
import { build } from "vite";

const root = import.meta.dirname;
const workspaceRoot = resolve(root, "../..");
const distDir = resolve(workspaceRoot, "dist");
const preloadOutDir = resolve(root, ".mobile-preload");
const androidAssetsPublic = resolve(root, "android/app/src/main/assets/public");
const androidAssetsNodeModules = resolve(androidAssetsPublic, "node_modules");
const manifestName = "noname-asset-manifest.json";

type DirectoryEntry = {
	folders: string[];
	files: string[];
};

function cleanOldPreloadArtifacts() {
	if (!existsSync(distDir)) return;

	for (const name of readdirSync(distDir)) {
		if (/^(preload(?:-.+)?|web-.+|index\.esm-.+)\.js$/.test(name)) {
			rmSync(resolve(distDir, name), { force: true });
		}
	}
}

async function buildPreload() {
	rmSync(preloadOutDir, { recursive: true, force: true });
	cleanOldPreloadArtifacts();

	await build({
		root,
		configFile: false,
		build: {
			outDir: preloadOutDir,
			emptyOutDir: true,
			target: ["chrome91", "safari16.4"],
			sourcemap: false,
			minify: false,
			lib: {
				entry: resolve(root, "src/preload.ts"),
				formats: ["es"],
				fileName: () => "preload.js",
			},
			rollupOptions: {
				output: {
					inlineDynamicImports: true,
					assetFileNames: "preload-[name][extname]",
				},
			},
		},
	});

	mkdirSync(distDir, { recursive: true });
	copyFileSync(resolve(preloadOutDir, "preload.js"), resolve(distDir, "preload.js"));
	rmSync(preloadOutDir, { recursive: true, force: true });
}

function capSync() {
	const command = process.platform === "win32" ? "cmd" : "cap";
	const args = process.platform === "win32" ? ["/c", "cap", "sync"] : ["sync"];
	const result = spawnSync(command, args, {
		cwd: root,
		stdio: "inherit",
	});

	if (result.status !== 0) {
		throw new Error(
			`cap sync failed with exit code ${result.status ?? "unknown"}${result.error ? `: ${result.error.message}` : ""}`
		);
	}
}

function writeAssetManifest() {
	const manifest: Record<string, DirectoryEntry> = {};

	function collectDirectory(relativeDir = "") {
		const directory = resolve(androidAssetsPublic, relativeDir);
		const entries = readdirSync(directory, { withFileTypes: true })
			.filter(entry => entry.name !== manifestName)
			.sort((a, b) => a.name.localeCompare(b.name));
		const folders = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
		const files = entries.filter(entry => entry.isFile()).map(entry => entry.name);

		manifest[relativeDir.replaceAll("\\", "/").replace(/\/+$/, "")] = {
			folders,
			files,
		};

		for (const folder of folders) {
			collectDirectory(join(relativeDir, folder));
		}
	}

	collectDirectory();
	writeFileSync(resolve(androidAssetsPublic, manifestName), JSON.stringify(manifest));
}

function patchAndroidAssets() {
	const pnpmDir = resolve(androidAssetsNodeModules, ".pnpm");
	const androidSafePnpmDir = resolve(androidAssetsNodeModules, "_pnpm");

	if (!existsSync(pnpmDir)) return;

	if (existsSync(androidSafePnpmDir)) {
		rmSync(androidSafePnpmDir, { recursive: true, force: true });
	}

	renameSync(pnpmDir, androidSafePnpmDir);
}

await buildPreload();
capSync();
writeAssetManifest();
patchAndroidAssets();
