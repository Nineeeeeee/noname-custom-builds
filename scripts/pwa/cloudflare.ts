import { S3Client, ListObjectsV2Command, DeleteObjectsCommand, HeadObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { HttpsProxyAgent } from "https-proxy-agent";
import { releaseConfig as config } from "./release-config";
import { createHash } from "node:crypto";
export function client() {
	const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
	const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
	if (!accessKeyId || !secretAccessKey) throw new Error("Missing R2 S3 credentials");
	return new S3Client({ region: "auto", endpoint: `https://${config.account}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", maxAttempts: 5, requestHandler: { httpsAgent: process.env.HTTPS_PROXY ? new HttpsProxyAgent(process.env.HTTPS_PROXY) : undefined, requestTimeout: 120000, connectionTimeout: 30000 } });
}
export function assertKey(key: string) {
	if (!key.startsWith(config.prefix) || key.includes("..") || config.bucket !== "noname-pwa" || config.prefix !== "noname-pwa/") throw new Error("Unsafe R2 target");
}
export async function list(s3: S3Client) {
	const objects = new Map<string, number>();
	let token: string | undefined;
	do {
		const page = await s3.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: config.prefix, ContinuationToken: token, MaxKeys: 1000 }));
		for (const obj of page.Contents || []) {
			if (!obj.Key) continue;
			assertKey(obj.Key);
			objects.set(obj.Key, obj.Size || 0);
		}
		if (page.IsTruncated && !page.NextContinuationToken) throw new Error("Invalid R2 pagination");
		token = page.NextContinuationToken;
	} while (token);
	return objects;
}
export async function remove(s3: S3Client, keys: string[]) {
	for (let i = 0; i < keys.length; i += 1000) {
		const batch = keys.slice(i, i + 1000);
		batch.forEach(assertKey);
		const result = await s3.send(new DeleteObjectsCommand({ Bucket: config.bucket, Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true } }));
		if (result.Errors?.length) throw new Error(`R2 deletion failed for ${result.Errors.length} objects`);
	}
}
export async function read(s3: S3Client, key: string) {
	assertKey(key);
	try {
		const object = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
		return { bytes: await object.Body!.transformToByteArray(), etag: object.ETag! };
	} catch (error: any) {
		if (error.$metadata?.httpStatusCode === 404) return undefined;
		throw error;
	}
}
export async function head(s3: S3Client, key: string) {
	assertKey(key);
	try {
		return await s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
	} catch (error: any) {
		if (error.$metadata?.httpStatusCode === 404) return undefined;
		throw error;
	}
}
export async function write(s3: S3Client, key: string, bytes: Uint8Array, hash: string, etag?: string, absent = false) {
	assertKey(key);
	return s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: bytes, ContentLength: bytes.byteLength, ContentMD5: createHash("md5").update(bytes).digest("base64"), Metadata: { sha256: hash }, IfMatch: etag, IfNoneMatch: absent ? "*" : undefined }));
}
export async function verifyRemote(s3: S3Client, key: string, hash: string, size: number) {
	assertKey(key);
	const object = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
	const digest = createHash("sha256");
	let bytes = 0;
	for await (const chunk of object.Body as any as AsyncIterable<Uint8Array>) {
		bytes += chunk.length;
		digest.update(chunk);
	}
	if (bytes !== size || digest.digest("hex") !== hash) throw new Error(`R2 content verification failed: ${key}`);
}
export async function pool<T>(items: T[], concurrency: number, action: (item: T, index: number) => Promise<void>) {
	let index = 0,
		failure: unknown;
	await Promise.all(
		Array.from({ length: concurrency }, async () => {
			while (!failure && index < items.length) {
				const i = index++;
				try {
					await action(items[i], i);
				} catch (error) {
					failure = error;
				}
			}
		})
	);
	if (failure) throw failure;
}
