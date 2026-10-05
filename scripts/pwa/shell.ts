import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { digest } from "./package";
export async function buildShell(dest: string) {
	await fs.mkdir(`${dest}/pwa`, { recursive: true });
	const root = path.resolve(import.meta.dirname, "../..");
	const lobby = process.env.NONAME_LOBBY_URL || "wss://lobby.491528.xyz";
	await build({ entryPoints: { launcher: `${root}/apps/core/pwa/launcher.ts`, "download-worker": `${root}/apps/core/pwa/download-worker.ts` }, outdir: `${dest}/pwa`, bundle: true, format: "iife", target: ["chrome91", "safari16.4"], minify: true, define: { __LOBBY_URL__: JSON.stringify(lobby) } });
	await fs.copyFile(`${root}/apps/core/pwa/launcher.html`, `${dest}/launcher.html`);
	await fs.writeFile(`${dest}/pwa/realm.html`, '<!doctype html><html><head><meta charset="utf-8"><title>Noname realm</title></head><body></body></html>');
	for (const size of [180, 192, 512]) await fs.copyFile(`${root}/apps/core/pwa/icon-${size}.png`, `${dest}/pwa/icon-${size}.png`);
	await fs.writeFile(`${dest}/manifest.webmanifest`, JSON.stringify({ id: "/launcher.html", name: "无名杀", short_name: "无名杀", description: "完整离线游戏与联机客户端", start_url: "/launcher.html", scope: "/", display: "standalone", orientation: "landscape", background_color: "#17110b", theme_color: "#17110b", icons: [192, 512].map(size => ({ src: `/pwa/icon-${size}.png`, sizes: `${size}x${size}`, type: "image/png", purpose: "any maskable" })) }));
	const shellFiles = ["launcher.html", "pwa/launcher.js", "pwa/download-worker.js", "manifest.webmanifest", "pwa/icon-180.png", "pwa/icon-192.png", "pwa/icon-512.png"];
	const shellId = digest(Buffer.concat(await Promise.all(shellFiles.map(p => fs.readFile(`${dest}/${p}`))))).slice(0, 16);
	await build({ entryPoints: [`${root}/apps/core/pwa/service-worker.ts`], outfile: `${dest}/service-worker.js`, bundle: true, format: "iife", target: ["chrome91", "safari16.4"], minify: true, define: { __SHELL_FILES__: JSON.stringify(shellFiles), __SHELL_ID__: JSON.stringify(shellId) } });
	await fs.writeFile(`${dest}/pwa-shell.json`, JSON.stringify([...shellFiles, "service-worker.js"]));
}
