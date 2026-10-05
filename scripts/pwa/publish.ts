import { ProxyAgent, setGlobalDispatcher } from "undici";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { client, list, read, write, head, remove, verifyRemote, pool } from "./cloudflare";
import { releaseConfig as config } from "./release-config";
import { digest } from "./package";
import { verifyRelease } from "./verify";
import { SCHEMA, RUNTIME, SHELL, type ReleaseManifest, type ReleaseState } from "../../apps/core/pwa/protocol";
if (process.env.HTTPS_PROXY) setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY));
const args = process.argv.slice(2).filter(a => a !== "--");
if (args.some(a => !["--ci", "--plan", "--resume", "--no-verify"].includes(a))) throw new Error("Unknown publication argument");
const ci = args.includes("--ci"),
	planOnly = args.includes("--plan");
const verifyContent = !args.includes("--no-verify");
const m: ReleaseManifest = verifyContent ? await verifyRelease() : JSON.parse(await fs.readFile("output/pwa/manifest.json", "utf8"));
if (execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== m.commit) throw new Error("Build the current committed source before publication");
if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) throw new Error("Commit source changes before publication");
if (!ci && execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim() !== config.branch) throw new Error("Unexpected local publication branch");
const manifestBytes = await fs.readFile("output/pwa/manifest.json");
const manifestHash = digest(manifestBytes);
if (ci) {
	if (process.env.GITHUB_REPOSITORY !== config.repository || process.env.GITHUB_REF !== `refs/heads/${config.branch}` || process.env.GITHUB_SHA !== m.commit) throw new Error("Invalid CI publication source");
	const branch = await fetch(`https://api.github.com/repos/${config.repository}/git/ref/heads/${config.branch}`, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, "User-Agent": "noname-pwa-publisher", Accept: "application/vnd.github+json" } }).then(async r => {
		if (!r.ok) throw new Error("Cannot verify branch HEAD");
		return r.json() as Promise<any>;
	});
	if (branch.object.sha !== m.commit) {
		console.log("Skip outdated build: branch has a newer commit");
		process.exit(0);
	}
}
const s3 = client();
const resources = new Map<string, { local: string; hash: string; size: number }>();
for (const f of Object.values(m.files)) resources.set(`${config.prefix}objects/${f.sha256}`, { local: `output/pwa/objects/${f.sha256}`, hash: f.sha256, size: f.size });
for (const p of Object.values(m.packs)) resources.set(`${config.prefix}packs/${p.sha256}.zip`, { local: `output/pwa/packs/${p.sha256}.zip`, hash: p.sha256, size: p.size });
const allowed = new Set([...resources.keys(), config.prefix + "control/state.json", config.prefix + "current/manifest.json"]);
const existing = await list(s3);
const obsolete = [...existing.keys()].filter(k => !allowed.has(k));
const missing = [...resources].filter(([key, object]) => existing.get(key) !== object.size);
console.log(JSON.stringify({ stage: "plan", account: config.account, bucket: config.bucket, prefix: config.prefix, commit: m.commit, fileCount: m.fileCount, totalBytes: m.totalBytes, releaseId: m.releaseId, objects: resources.size, uploadCandidates: missing.length, uploadBytes: missing.reduce((n, [, o]) => n + o.size, 0), deleteObjects: obsolete.length, deleteBytes: obsolete.reduce((n, k) => n + existing.get(k)!, 0) }));
if (planOnly) process.exit(0);
const origin = process.env.PWA_PUBLIC_ORIGIN;
if (!origin || !/^https:\/\/[^/]+$/.test(origin)) throw new Error("PWA_PUBLIC_ORIGIN must be the final HTTPS origin");
const stateKey = config.prefix + "control/state.json";
const previous = await read(s3, stateKey);
const old = previous ? (JSON.parse(new TextDecoder().decode(previous.bytes)) as ReleaseState & { verifiedManifestSha256?: string }) : undefined;
if (old?.state === "maintenance") {
	const previousRunner = /^github-(\d+)-/.exec(old.publicationId);
	if (ci && previousRunner) {
		const r = await fetch(`https://api.github.com/repos/${config.repository}/actions/runs/${previousRunner[1]}`, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, "User-Agent": "noname-pwa-publisher" } });
		if (!r.ok || ((await r.json()) as any).status !== "completed") throw new Error("Previous publication runner has not finished");
	} else if (!args.includes("--resume")) throw new Error("Previous publication is in maintenance. Confirm its runner ended, then use --resume.");
}
const previousManifest = await read(s3, config.prefix + "current/manifest.json");
const trusted = new Set<string>();
if (previousManifest && digest(previousManifest.bytes) === (old?.state === "ready" ? old.manifestSha256 : old?.verifiedManifestSha256)) {
	const verified: ReleaseManifest = JSON.parse(new TextDecoder().decode(previousManifest.bytes));
	for (const f of Object.values(verified.files)) trusted.add(`${config.prefix}objects/${f.sha256}`);
	for (const p of Object.values(verified.packs)) trusted.add(`${config.prefix}packs/${p.sha256}.zip`);
}
const publicationId = ci ? `github-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}` : `local-${randomUUID()}`;
let stateEtag = previous?.etag;
async function changeState(state: ReleaseState & { verifiedManifestSha256?: string }) {
	const bytes = Buffer.from(JSON.stringify(state));
	const result = await write(s3, stateKey, bytes, digest(bytes), stateEtag, !stateEtag);
	stateEtag = result.ETag;
	const confirmation = await read(s3, stateKey);
	if (!confirmation || confirmation.etag !== stateEtag || digest(confirmation.bytes) !== digest(bytes)) throw new Error("Publication state CAS/readback failed");
}
const base: ReleaseState = { schemaVersion: SCHEMA, state: "maintenance", publicationId, releaseId: m.releaseId, manifestSha256: manifestHash, commit: m.commit, runtimeProtocol: RUNTIME, shellProtocol: SHELL, updatedAt: new Date().toISOString(), message: "游戏正在更新，请稍后继续。完整离线安装仍可在断网时游玩。" };
await changeState({ ...base, verifiedManifestSha256: old?.state === "ready" ? old.manifestSha256 : old?.verifiedManifestSha256 });
console.log(JSON.stringify({ stage: "maintenance", publicationId }));
await remove(s3, obsolete);
let uploaded = 0,
	verified = 0,
	reused = 0;
const verifyJobs: [string, { hash: string; size: number }][] = [];
await pool([...resources], 4, async ([key, object]) => {
	const oldObject = existing.has(key) ? await head(s3, key) : undefined;
	const matches = oldObject?.ContentLength === object.size && oldObject.Metadata?.sha256 === object.hash;
	if (!matches) {
		const bytes = await fs.readFile(object.local);
		if (verifyContent && (digest(bytes) !== object.hash || bytes.length !== object.size)) throw new Error("Local publication object changed");
		await write(s3, key, bytes, object.hash);
		uploaded++;
		verifyJobs.push([key, object]);
	} else if (trusted.has(key)) reused++;
	else verifyJobs.push([key, object]);
	if ((uploaded + reused + verifyJobs.length) % 500 === 0) console.log(JSON.stringify({ stage: "upload", uploaded, reused, scheduledVerification: verifyJobs.length }));
});
if (verifyContent)
	await pool(verifyJobs, 2, async ([key, object]) => {
		await verifyRemote(s3, key, object.hash, object.size);
		verified++;
		if (verified % 500 === 0) console.log(JSON.stringify({ stage: "remote-verify", verified, total: verifyJobs.length }));
	});
const wranglerEnv = { ...process.env };
if (!wranglerEnv.CLOUDFLARE_API_TOKEN) delete wranglerEnv.CLOUDFLARE_API_TOKEN;
execFileSync("wrangler", ["deploy", "--config", "packages/pwa-host/wrangler.jsonc"], { stdio: "inherit", env: wranglerEnv });
await write(s3, config.prefix + "current/manifest.json", manifestBytes, manifestHash);
if (verifyContent) await verifyRemote(s3, config.prefix + "current/manifest.json", manifestHash, manifestBytes.length);
const final = await list(s3);
if (final.size !== allowed.size || [...final.keys()].some(k => !allowed.has(k))) throw new Error("Final R2 object set differs from current release");
for (const [key, object] of resources) if (final.get(key) !== object.size) throw new Error("Final R2 object size mismatch");
// Confirm the shell is actually reachable while maintenance is still authoritative.
for (const route of ["/launcher.html", "/service-worker.js", "/manifest.webmanifest"]) {
	const response = await fetch(origin + route, { cache: "no-store" });
	if (!response.ok) throw new Error(`Deployed shell unavailable: ${route}`);
	if (verifyContent) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		const expected = await fs.readFile("output/pwa/shell" + route);
		if (digest(bytes) !== digest(expected)) throw new Error(`Deployed shell mismatch: ${route}`);
	} else await response.body?.cancel();
}
const ownership = await read(s3, stateKey);
if (!ownership || ownership.etag !== stateEtag || JSON.parse(new TextDecoder().decode(ownership.bytes)).publicationId !== publicationId) throw new Error("Lost publication ownership");
await changeState({ ...base, state: "ready", updatedAt: new Date().toISOString(), message: undefined });
try {
	const response = await fetch(origin + "/__pwa/status", { cache: "no-store" });
	const publicState = (await response.json()) as ReleaseState;
	if (!response.ok || publicState.state !== "ready" || publicState.releaseId !== m.releaseId || publicState.manifestSha256 !== manifestHash) throw new Error("Public ready state verification failed");
} catch (error) {
	// A failed final public check must not leave this publication advertised as ready.
	// The conditional write refuses to overwrite a newer publisher's state.
	await changeState({ ...base, updatedAt: new Date().toISOString(), verifiedManifestSha256: manifestHash });
	throw error;
}
console.log(JSON.stringify({ stage: "ready", publicationId, releaseId: m.releaseId, commit: m.commit, fileCount: m.fileCount, totalBytes: m.totalBytes, uploaded, verified, reused, storedBytes: [...final.values()].reduce((a, b) => a + b, 0), origin }));
