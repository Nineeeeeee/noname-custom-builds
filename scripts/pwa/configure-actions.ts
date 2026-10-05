/** Configure only the authorized personal fork. Secret values travel through stdin. */
import { execFileSync } from "node:child_process";
import { releaseConfig as config } from "./release-config";

const environment = "pwa-production";
const origin = process.env.PWA_PUBLIC_ORIGIN;
if (!origin || !/^https:\/\/[^/]+$/.test(origin)) throw new Error("Set the verified PWA_PUBLIC_ORIGIN");
const secrets = ["CLOUDFLARE_API_TOKEN", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
if (secrets.some(name => !process.env[name])) throw new Error("Prepare all three deployment secrets first");
const repo = execFileSync("gh", ["api", `repos/${config.repository}`, "--jq", ".full_name"], { encoding: "utf8" }).trim();
if (repo !== config.repository) throw new Error("Unexpected repository");
execFileSync("gh", ["api", "--method", "PUT", `repos/${config.repository}/environments/${environment}`], { stdio: ["ignore", "ignore", "pipe"] });
for (const name of secrets) {
	execFileSync("gh", ["secret", "set", name, "--repo", config.repository, "--env", environment], { input: process.env[name]!, stdio: ["pipe", "ignore", "pipe"] });
}
execFileSync("gh", ["variable", "set", "PWA_PUBLIC_ORIGIN", "--repo", config.repository, "--env", environment, "--body", origin], { stdio: ["ignore", "ignore", "pipe"] });
console.log(`Configured deployment environment ${config.repository}/${environment}; no secret values displayed`);
