import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
test("core and extension failures stop the merge and preserve the previous dist", async () => {
	const temp = await fs.mkdtemp("/tmp/noname-build-failure-");
	const root = process.cwd();
	await fs.mkdir(join(temp, "dist"));
	const sentinel = join(temp, "dist/index.html");
	await fs.writeFile(sentinel, "previous release");
	const stat = await fs.stat(sentinel);
	try {
		for (const phase of ["core", "extension"]) {
			const executable = join(temp, "pnpm");
			const counter = join(temp, "counter");
			await fs.rm(counter, { force: true });
			await fs.writeFile(executable, `#!/bin/sh\nif [ -f '${counter}' ]; then exit 17; fi\ntouch '${counter}'\n${phase === "core" ? "exit 23" : "exit 0"}\n`, { mode: 0o755 });
			const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), join(root, "scripts/build.ts")], { cwd: temp, env: { ...process.env, PATH: `${temp}:${process.env.PATH}` }, encoding: "utf8" });
			assert.notEqual(result.status, 0);
			assert.ok(result.stderr.includes("Build failed"), result.stderr);
			assert.equal((await fs.stat(sentinel)).mtimeMs, stat.mtimeMs);
			assert.equal(await fs.readFile(sentinel, "utf8"), "previous release");
		}
	} finally {
		await fs.rm(temp, { recursive: true, force: true });
	}
});
test("ZIP metadata stays identical across build timezones", async () => {
	const source = `import {zipSync} from 'fflate'; import {createHash} from 'node:crypto'; const bytes=zipSync({'中文/a.txt':[new Uint8Array([1,2,3]),{level:0,mtime:new Date(1980,0,1,0,0,0)}]},{level:0}); console.log(createHash('sha256').update(bytes).digest('hex'));`;
	const hashes = ["UTC", "Asia/Shanghai", "America/Los_Angeles"].map(TZ => execFileSync(process.execPath, ["--input-type=module", "-e", source], { env: { ...process.env, TZ }, encoding: "utf8" }).trim());
	assert.equal(new Set(hashes).size, 1);
});
