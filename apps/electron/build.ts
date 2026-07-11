import { build as buildElectron, Platform, Arch, type PackagerOptions, type Configuration } from "electron-builder";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as buildVite } from "vite";

const electronDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(electronDir, "../..");
const packagerDir = path.join(os.tmpdir(), "noname-electron-packager");
const outputDir = path.join(repoRoot, "output");

async function rewriteWebAssetPaths(root: string) {
	const textExtensions = new Set([".html", ".js", ".mjs", ".css", ".json", ".webmanifest"]);
	const webPathPrefixPattern = String.raw`(?:\.\.\/|\.\/|\/)+`;
	const pnpmStorePathPattern = new RegExp(`(${webPathPrefixPattern})node_modules/\\.pnpm/`, "g");
	const nodeModulesSegmentPattern = /\/node_modules\//g;
	const invalidReferences: string[] = [];
	let renamedDirectoryCount = 0;
	let rewrittenFileCount = 0;

	// Step 1: rename top-level node_modules → vendor
	const nodeModulesDir = path.join(root, "node_modules");
	const vendorDir = path.join(root, "vendor");
	await fs.rm(vendorDir, { recursive: true, force: true });
	try {
		await fs.rename(nodeModulesDir, vendorDir);
	} catch (error: any) {
		if (error?.code !== "ENOENT") throw error;
		return; // nothing to rewrite
	}

	// Step 2: rename vendor/.pnpm → vendor/pnpm (avoids dot-file glob exclusion)
	const dotPnpmDir = path.join(vendorDir, ".pnpm");
	const pnpmDir = path.join(vendorDir, "pnpm");
	await fs.rm(pnpmDir, { recursive: true, force: true });
	try {
		await fs.rename(dotPnpmDir, pnpmDir);
	} catch (error: any) {
		if (error?.code !== "ENOENT") throw error;
		return;
	}

	// Step 3: rename every nested node_modules inside vendor/pnpm/… to modules
	// This sidesteps electron-builder's hardcoded "!**/node_modules/**" exclusion.
	async function renameNestedNodeModules(dir: string) {
		let entries: fs.Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (!entry.isDirectory()) continue;
			if (entry.name === "node_modules") {
				const newPath = path.join(dir, "modules");
				await fs.rm(newPath, { recursive: true, force: true });
				await fs.rename(fullPath, newPath);
				renamedDirectoryCount++;
			} else {
				await renameNestedNodeModules(fullPath);
			}
		}
	}
	await renameNestedNodeModules(pnpmDir);

	// Step 4: rewrite asset references in html/js/css/json files
	async function walk(dir: string) {
		let entries: fs.Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(fullPath);
				continue;
			}

			if (!entry.isFile() || !textExtensions.has(path.extname(entry.name))) continue;

			const content = await fs.readFile(fullPath, "utf8");

			// Replace /node_modules/.pnpm/…, ./node_modules/.pnpm/…, and
			// any depth of ../node_modules/.pnpm/… with the renamed vendor path.
			let rewritten = content.replace(pnpmStorePathPattern, "$1vendor/pnpm/");

			// Every nested node_modules directory above was renamed to modules.
			// Rewrite the matching path segment without assuming a package-name shape.
			rewritten = rewritten.replace(nodeModulesSegmentPattern, "/modules/");

			if (path.extname(entry.name) === ".html") {
				const vueImportPath = rewritten.match(/"vue"\s*:\s*"([^"]+)"/)?.[1];
				if (vueImportPath) {
					rewritten = rewritten.replace(/(<script\b[^>]*\bsrc=)(["'])vue\2/g, `$1$2${vueImportPath}$2`);
				}
			}

			if (rewritten !== content) {
				await fs.writeFile(fullPath, rewritten);
				rewrittenFileCount++;
			}

			if (/\/node_modules\//.test(rewritten) || /<script\b[^>]*\bsrc=["']vue["']/.test(rewritten)) {
				invalidReferences.push(path.relative(root, fullPath));
			}
		}
	}
	await walk(root);

	if (invalidReferences.length > 0) {
		throw new Error(`Electron web assets still contain unpackaged dependency paths:\n${invalidReferences.join("\n")}`);
	}

	const indexHtml = await fs.readFile(path.join(root, "index.html"), "utf8");
	const vueImportPath = indexHtml.match(/"vue"\s*:\s*"([^"]+)"/)?.[1];
	if (!vueImportPath) throw new Error("Electron web assets are missing the Vue import-map entry");
	await fs.access(path.join(root, vueImportPath.replace(/^\/+/, "")));

	console.log(`Electron web assets prepared: ${renamedDirectoryCount} dependency directories renamed, ${rewrittenFileCount} files rewritten`);
}

async function preparePackagerDir() {
	const packageJson = JSON.parse(await fs.readFile(path.join(electronDir, "package.json"), "utf8"));
	const electronVersion = packageJson.devDependencies.electron.replace(/^[^\d]*/, "");
	const publicDir = path.join(packagerDir, "public");

	await fs.rm(packagerDir, { recursive: true, force: true });
	await fs.rm(path.join(electronDir, ".packager"), { recursive: true, force: true });
	await fs.mkdir(packagerDir, { recursive: true });
	await fs.cp(path.join(electronDir, "dist"), packagerDir, { recursive: true, force: true });
	await fs.cp(path.join(repoRoot, "dist"), publicDir, { recursive: true, force: true });
	await rewriteWebAssetPaths(publicDir);
	await fs.copyFile(path.join(electronDir, "noname.ico"), path.join(packagerDir, "noname.ico"));
	await fs.writeFile(
		path.join(packagerDir, "package.json"),
		JSON.stringify(
			{
				name: "noname",
				version: packageJson.version,
				productName: packageJson.productName,
				license: packageJson.license,
				main: "app/main.js",
				type: "module",
			},
			null,
			2
		)
	);

	return electronVersion;
}

async function main(targets: PackagerOptions["targets"], config: Partial<Configuration> = {}) {
	const electronVersion = await preparePackagerDir();
	const appPaths = await buildElectron({
		projectDir: packagerDir,
		config: {
			asar: false,
			appId: "com.libnoname.noname",
			electronVersion,
			productName: "noname",
			directories: {
				output: outputDir,
			},
			files: ["**/*"],
			...config,
		},
		targets,
	});
	await fs.rm(packagerDir, { recursive: true, force: true });
	console.log("打包完成:", appPaths.join(", "));
}

await buildVite();

switch (process.argv[2]) {
	case "win":
		await main(Platform.WINDOWS.createTarget("nsis", Arch.x64), {
			win: {
				verifyUpdateCodeSignature: false,
				signAndEditExecutable: false,
				icon: "noname.ico",
			},
			nsis: {
				oneClick: false,
				allowToChangeInstallationDirectory: true,
			},
		});
		break;
	case "linux":
		await main(Platform.LINUX.createTarget("AppImage", Arch.x64));
		break;
	case "macos":
		await main(Platform.MAC.createTarget("dmg", Arch.arm64, Arch.x64), {
			mac: {
				identity: null,
			},
		});
		break;
	default:
		console.log("未知平台:", process.argv[2]);
}
