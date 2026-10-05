/** Actual Chromium PWA page + actual Linux Electron, against the deployed DO. */
import { chromium, _electron, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const profile = path.resolve(process.env.NONAME_TEST_PROFILE || "output/pwa-browser-profile");
const browser = await chromium.launchPersistentContext(profile, { executablePath: process.env.NONAME_TEST_CHROME, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
let electron: Awaited<ReturnType<typeof _electron.launch>> | undefined;
async function peer(page: Page, key: string) {
	await page.evaluate(
		({ url, key }) => {
			const state = { id: "", messages: [] as any[][], socket: new WebSocket(url) };
			(window as any).__lobby = state;
			state.socket.onmessage = event => {
				if (event.data === "heartbeat") {
					state.socket.send("heartbeat");
					return;
				}
				const message = JSON.parse(event.data);
				state.messages.push(message);
				if (message[0] === "roomlist") {
					state.id = message[4];
					state.socket.send(JSON.stringify(["server", "key", [key]]));
				}
			};
		},
		{ url: "wss://lobby.491528.xyz", key }
	);
	await page.waitForFunction(() => !!(window as any).__lobby.id);
}
const send = (page: Page, type: string, ...args: unknown[]) => page.evaluate(data => (window as any).__lobby.socket.send(JSON.stringify(data)), ["server", type, ...args]);
async function wait(page: Page, type: string) {
	await page.waitForFunction(type => (window as any).__lobby.messages.some((m: any[]) => m[0] === type), type);
	return page.evaluate(
		type =>
			(window as any).__lobby.messages.splice(
				(window as any).__lobby.messages.findIndex((m: any[]) => m[0] === type),
				1
			)[0],
		type
	);
}
try {
	const pwa = browser.pages()[0];
	pwa.on("dialog", dialog => dialog.accept());
	await pwa.goto("http://127.0.0.1:46137/launcher.html");
	await pwa.waitForFunction(() => !(document.querySelector("#play") as HTMLButtonElement).disabled, undefined, { timeout: 60000 });
	await pwa.locator("#play").click();
	await pwa.waitForSelector("#splash, #arena");
	assert.equal(await pwa.evaluate(async () => (await import("/noname.js")).lib.pwa), true);
	electron = await _electron.launch({ executablePath: path.resolve("apps/electron/node_modules/electron/dist/electron"), args: ["--no-sandbox", path.resolve("tests/pwa/electron-fixture.mjs")], env: { ...process.env } });
	const desktop = await electron.firstWindow();
	const key = "mixed-runtime-" + Date.now();
	await Promise.all([peer(pwa, key), peer(desktop, key + "-electron")]);
	await send(pwa, "create", key, "PWA runtime", "caocao");
	await wait(pwa, "createroom");
	await send(pwa, "config", { number: 2, gameStarted: false });
	await send(desktop, "enter", key, "Electron runtime", "liubei");
	const id = (await wait(pwa, "onconnection"))[1];
	await desktop.evaluate(() => (window as any).__lobby.socket.send('["game",{"runtime":"electron"}]'));
	assert.equal((await wait(pwa, "onmessage"))[2], '["game",{"runtime":"electron"}]');
	await send(pwa, "send", id, '["init",{"runtime":"pwa"}]');
	assert.equal((await wait(desktop, "init"))[1].runtime, "pwa");
	await pwa.evaluate(() => (window as any).__lobby.socket.close());
	await wait(desktop, "selfclose");
	await pwa.locator('#splash [link="connect"]').click();
	const deadline = Date.now() + 60000;
	while (!(await pwa.evaluate(async () => !!(await import("/noname.js")).ui.ipnode))) {
		assert.ok(Date.now() < deadline, "Connect mode did not initialize");
		await new Promise(resolve => setTimeout(resolve, 250));
	}
	await pwa.evaluate(async () => {
		const { game } = await import("/noname.js");
		game.connect("wss://lobby.491528.xyz");
	});
	while (
		!(await pwa.evaluate(async () => {
			const { game, ui } = await import("/noname.js");
			return !!game.onlinehall && !!ui.rooms;
		}))
	) {
		assert.ok(Date.now() < deadline, "Actual game lobby handshake failed");
		await new Promise(resolve => setTimeout(resolve, 250));
	}
	const result = { pwaGameLoaded: true, actualGameLobbyUI: true, electron: await electron.evaluate(({ app }) => app.getVersion()), publicLobby: true, roomAndBidirectionalRelay: true, ownerDisconnect: true, fullMixedGame: "pending Windows device acceptance" };
	await fs.writeFile("output/pwa-mixed-runtime-results.json", JSON.stringify(result, null, 2));
	console.log(result);
} finally {
	await electron?.close();
	await browser.close();
}
