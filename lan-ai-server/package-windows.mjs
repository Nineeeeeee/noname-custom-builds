import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(here, "output");
const cacheDir = path.join(outputDir, ".cache");
const stagingDir = path.join(outputDir, ".staging", "noname");
const distDir = path.resolve(here, "..", "dist");
const serverFile = path.join(here, "server.mjs");
const packageRootName = "noname";
const localNodeVersion = process.versions.node;
const windowsNodeVersion = process.env.NONAME_NODE_VERSION || localNodeVersion;

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
	let c = i;
	for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	crcTable[i] = c >>> 0;
}

function pad(value) {
	return String(value).padStart(2, "0");
}

function timestamp() {
	const date = new Date();
	return [
		date.getFullYear(),
		pad(date.getMonth() + 1),
		pad(date.getDate()),
		"-",
		pad(date.getHours()),
		pad(date.getMinutes()),
		pad(date.getSeconds()),
	].join("");
}

function dosDateTime(date) {
	const year = Math.max(date.getFullYear(), 1980);
	const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
	const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
	return { dosDate, dosTime };
}

function crc32Update(crc, chunk) {
	let value = crc;
	for (const byte of chunk) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
	return value >>> 0;
}

function writeUInt32(value) {
	const buffer = Buffer.allocUnsafe(4);
	buffer.writeUInt32LE(value >>> 0);
	return buffer;
}

function writeUInt16(value) {
	const buffer = Buffer.allocUnsafe(2);
	buffer.writeUInt16LE(value);
	return buffer;
}

async function writeChunk(stream, chunk) {
	if (!stream.write(chunk)) {
		await new Promise((resolve, reject) => {
			stream.once("drain", resolve);
			stream.once("error", reject);
		});
	}
}

function assertUInt32(value, label) {
	if (value > 0xffffffff) throw new Error(`${label} is too large for this simple ZIP writer`);
}

async function pathExists(filePath) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function removeOldPackages() {
	await fs.mkdir(outputDir, { recursive: true });
	for (const entry of await fs.readdir(outputDir, { withFileTypes: true })) {
		if (entry.isFile() && /^noname-\d{8}-\d{6}\.zip$/.test(entry.name)) {
			await fs.rm(path.join(outputDir, entry.name), { force: true });
		}
	}
}

async function copyRequiredFiles() {
	if (!(await pathExists(distDir))) throw new Error(`Missing ${distDir}. Run pnpm build first.`);
	if (!(await pathExists(serverFile))) throw new Error(`Missing ${serverFile}.`);

	await fs.rm(stagingDir, { recursive: true, force: true });
	await fs.mkdir(stagingDir, { recursive: true });
	await fs.cp(distDir, path.join(stagingDir, "public"), { recursive: true });
	await fs.copyFile(serverFile, path.join(stagingDir, "server.mjs"));
	await writeLauncherFiles();
	await ensureWindowsNode(path.join(stagingDir, "node", "node.exe"));
}

async function writeLauncherFiles() {
	const startBat = `@echo off\r
cd /d "%~dp0"\r
set PORT=8090\r
start "noname-server" /min "%~dp0node\\node.exe" "%~dp0server.mjs"\r
timeout /t 2 /nobreak >nul\r
start "" "http://127.0.0.1:8090/"\r
`;
	const stopBat = `@echo off\r
taskkill /FI "WINDOWTITLE eq noname-server*" /T /F\r
`;
	const readme = `Noname Windows package

How to play:
1. Double click start-noname.bat.
2. Your browser should open http://127.0.0.1:8090/.
3. Use stop-noname.bat if you want to close the background server window.

LAN play:
Other devices in the same LAN can open http://YOUR-LAN-IP:8090/.

Notes:
- Do not double click public/index.html directly.
- This package includes a portable Windows node.exe only for running server.mjs.
- Keep LICENSE and README files in public/ when redistributing this GPL-3.0 project.
`;

	await fs.writeFile(path.join(stagingDir, "start-noname.bat"), startBat);
	await fs.writeFile(path.join(stagingDir, "stop-noname.bat"), stopBat);
	await fs.writeFile(path.join(stagingDir, "README.txt"), readme);
}

async function ensureWindowsNode(targetNodeExe) {
	await fs.mkdir(path.dirname(targetNodeExe), { recursive: true });

	const candidates = [
		process.env.NONAME_WINDOWS_NODE_EXE,
		process.env.NODE_WIN_EXE,
		path.join(here, "node", "node.exe"),
		path.join(here, "runtime", "node.exe"),
		path.join(here, ".runtime", "node.exe"),
	].filter(Boolean);

	for (const candidate of candidates) {
		if (await pathExists(candidate)) {
			await fs.copyFile(candidate, targetNodeExe);
			await copyAdjacentNodeLicense(candidate, path.dirname(targetNodeExe));
			await fs.writeFile(path.join(path.dirname(targetNodeExe), "VERSION.txt"), `node.exe source: ${candidate}\n`);
			console.log(`Using Windows node.exe: ${candidate}`);
			return;
		}
	}

	await downloadAndExtractWindowsNode(targetNodeExe);
}

async function downloadAndExtractWindowsNode(targetNodeExe) {
	await fs.mkdir(cacheDir, { recursive: true });
	const archiveName = `node-v${windowsNodeVersion}-win-x64.zip`;
	const archivePath = path.join(cacheDir, archiveName);
	const url = `https://nodejs.org/dist/v${windowsNodeVersion}/${archiveName}`;

	if (!(await pathExists(archivePath))) {
		console.log(`Downloading ${url}`);
		await downloadFile(url, archivePath);
	}

	console.log(`Extracting node.exe from ${archiveName}`);
	await extractFileFromZip(archivePath, name => /\/node\.exe$/i.test(name), targetNodeExe);
	try {
		await extractFileFromZip(archivePath, name => /\/LICENSE$/i.test(name), path.join(path.dirname(targetNodeExe), "LICENSE"));
	} catch (error) {
		console.warn(`Node LICENSE was not extracted: ${error.message}`);
	}
	await fs.writeFile(path.join(path.dirname(targetNodeExe), "VERSION.txt"), `node.exe source: ${url}\n`);
}

async function copyAdjacentNodeLicense(nodeExe, targetDirectory) {
	for (const name of ["LICENSE", "LICENSE.txt"]) {
		const licensePath = path.join(path.dirname(nodeExe), name);
		if (await pathExists(licensePath)) {
			await fs.copyFile(licensePath, path.join(targetDirectory, name));
			return;
		}
	}
}

async function downloadFile(url, destination) {
	const temp = `${destination}.tmp`;
	await fs.rm(temp, { force: true });
	await downloadToPath(url, temp);
	await fs.rename(temp, destination);
}

async function downloadToPath(url, destination) {
	await new Promise((resolve, reject) => {
		const request = https.get(url, response => {
			if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
				response.resume();
				downloadToPath(new URL(response.headers.location, url).toString(), destination).then(resolve, reject);
				return;
			}

			if (response.statusCode !== 200) {
				response.resume();
				reject(new Error(`Download failed: HTTP ${response.statusCode} ${url}`));
				return;
			}

			const file = createWriteStream(destination);
			response.pipe(file);
			file.on("finish", () => file.close(resolve));
			file.on("error", reject);
		});
		request.on("error", reject);
	});
}

async function extractFileFromZip(zipPath, predicate, destination) {
	const zip = await fs.readFile(zipPath);
	const eocdOffset = findEndOfCentralDirectory(zip);
	const entryCount = zip.readUInt16LE(eocdOffset + 10);
	const centralDirectoryOffset = zip.readUInt32LE(eocdOffset + 16);
	let offset = centralDirectoryOffset;

	for (let i = 0; i < entryCount; i++) {
		if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid ZIP central directory");

		const method = zip.readUInt16LE(offset + 10);
		const compressedSize = zip.readUInt32LE(offset + 20);
		const fileNameLength = zip.readUInt16LE(offset + 28);
		const extraLength = zip.readUInt16LE(offset + 30);
		const commentLength = zip.readUInt16LE(offset + 32);
		const localHeaderOffset = zip.readUInt32LE(offset + 42);
		const name = zip.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");

		if (predicate(name)) {
			const localNameLength = zip.readUInt16LE(localHeaderOffset + 26);
			const localExtraLength = zip.readUInt16LE(localHeaderOffset + 28);
			const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
			const compressed = zip.subarray(dataStart, dataStart + compressedSize);
			const data = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
			if (!data) throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
			await fs.writeFile(destination, data);
			return;
		}

		offset += 46 + fileNameLength + extraLength + commentLength;
	}

	throw new Error(`node.exe was not found in ${zipPath}`);
}

function findEndOfCentralDirectory(zip) {
	const signature = 0x06054b50;
	const minOffset = Math.max(0, zip.length - 22 - 0xffff);
	for (let offset = zip.length - 22; offset >= minOffset; offset--) {
		if (zip.readUInt32LE(offset) === signature) return offset;
	}
	throw new Error("Invalid ZIP: end of central directory was not found");
}

async function collectFiles(directory, baseDirectory = directory) {
	const result = [];
	const entries = await fs.readdir(directory, { withFileTypes: true });
	entries.sort((a, b) => a.name.localeCompare(b.name));

	for (const entry of entries) {
		const absolutePath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			result.push(...(await collectFiles(absolutePath, baseDirectory)));
		} else if (entry.isFile()) {
			const relativePath = path.relative(baseDirectory, absolutePath).split(path.sep).join("/");
			result.push({ absolutePath, relativePath: `${packageRootName}/${relativePath}` });
		}
	}

	return result;
}

async function createZip(sourceDirectory, zipPath) {
	const files = await collectFiles(sourceDirectory);
	if (files.length > 0xffff) throw new Error("Too many files for this simple ZIP writer");

	const output = createWriteStream(zipPath);
	const centralDirectory = [];
	let offset = 0;

	for (const file of files) {
		const info = await fs.stat(file.absolutePath);
		const fileName = Buffer.from(file.relativePath, "utf8");
		const { dosDate, dosTime } = dosDateTime(info.mtime);
		assertUInt32(info.size, file.relativePath);

		const localHeader = Buffer.concat([
			writeUInt32(0x04034b50),
			writeUInt16(20),
			writeUInt16(0x0808),
			writeUInt16(0),
			writeUInt16(dosTime),
			writeUInt16(dosDate),
			writeUInt32(0),
			writeUInt32(0),
			writeUInt32(0),
			writeUInt16(fileName.length),
			writeUInt16(0),
			fileName,
		]);

		const localHeaderOffset = offset;
		await writeChunk(output, localHeader);
		offset += localHeader.length;

		let crc = 0xffffffff;
		for await (const chunk of createReadStream(file.absolutePath)) {
			crc = crc32Update(crc, chunk);
			await writeChunk(output, chunk);
			offset += chunk.length;
		}
		crc = (crc ^ 0xffffffff) >>> 0;

		const dataDescriptor = Buffer.concat([writeUInt32(0x08074b50), writeUInt32(crc), writeUInt32(info.size), writeUInt32(info.size)]);
		await writeChunk(output, dataDescriptor);
		offset += dataDescriptor.length;

		centralDirectory.push({
			crc,
			compressedSize: info.size,
			uncompressedSize: info.size,
			fileName,
			dosDate,
			dosTime,
			localHeaderOffset,
		});

		if (files.length > 100 && centralDirectory.length % 500 === 0) {
			console.log(`Packed ${centralDirectory.length}/${files.length} files`);
		}
	}

	const centralDirectoryOffset = offset;
	for (const entry of centralDirectory) {
		assertUInt32(entry.localHeaderOffset, entry.fileName.toString("utf8"));
		const centralHeader = Buffer.concat([
			writeUInt32(0x02014b50),
			writeUInt16(0x0314),
			writeUInt16(20),
			writeUInt16(0x0808),
			writeUInt16(0),
			writeUInt16(entry.dosTime),
			writeUInt16(entry.dosDate),
			writeUInt32(entry.crc),
			writeUInt32(entry.compressedSize),
			writeUInt32(entry.uncompressedSize),
			writeUInt16(entry.fileName.length),
			writeUInt16(0),
			writeUInt16(0),
			writeUInt16(0),
			writeUInt16(0),
			writeUInt32(0),
			writeUInt32(entry.localHeaderOffset),
			entry.fileName,
		]);
		await writeChunk(output, centralHeader);
		offset += centralHeader.length;
	}

	const centralDirectorySize = offset - centralDirectoryOffset;
	assertUInt32(centralDirectoryOffset, "central directory offset");
	assertUInt32(centralDirectorySize, "central directory size");

	const endRecord = Buffer.concat([
		writeUInt32(0x06054b50),
		writeUInt16(0),
		writeUInt16(0),
		writeUInt16(centralDirectory.length),
		writeUInt16(centralDirectory.length),
		writeUInt32(centralDirectorySize),
		writeUInt32(centralDirectoryOffset),
		writeUInt16(0),
	]);
	await writeChunk(output, endRecord);

	await new Promise((resolve, reject) => {
		output.end(resolve);
		output.on("error", reject);
	});
}

async function main() {
	const zipName = `noname-${timestamp()}.zip`;
	const zipPath = path.join(outputDir, zipName);

	console.log("Preparing Windows package");
	await removeOldPackages();
	await copyRequiredFiles();
	console.log(`Creating ${zipPath}`);
	await createZip(stagingDir, zipPath);
	await fs.rm(path.join(outputDir, ".staging"), { recursive: true, force: true });

	const info = await fs.stat(zipPath);
	console.log(`Done: ${zipPath}`);
	console.log(`Size: ${(info.size / 1024 / 1024).toFixed(1)} MB`);
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
