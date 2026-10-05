/** GitHub increments this workflow counter automatically; reruns keep the number. */
export function pwaBuildNumber(): number | undefined {
	const value = process.env.NONAME_PWA_BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER;
	if (!value) return undefined;
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 1) throw new Error("PWA build number must be a positive integer");
	return number;
}
