#!/usr/bin/env bash
# Run interactively over SSH. Secrets never appear in command arguments or output.
set -euo pipefail
if [[ ${EUID} -ne 0 ]]; then
  echo '请使用 sudo bash scripts/pwa/prepare-credentials.sh，以便与 Wrangler 的 root 登录环境一致。' >&2
  exit 1
fi
umask 077
credential_file=/tmp/noname-pwa-deploy.env
credential_tmp=$(mktemp /tmp/noname-pwa-credentials.XXXXXX)
trap 'unset pwa_worker_token pwa_r2_access pwa_r2_secret; rm -f "$credential_tmp"' EXIT
printf 'Workers 部署 API Token（仅 CI 需要；输入不显示）：' >/dev/tty
IFS= read -r -s pwa_worker_token </dev/tty
printf '\nR2 Access Key ID（输入不显示）：' >/dev/tty
IFS= read -r -s pwa_r2_access </dev/tty
printf '\nR2 Secret Access Key（输入不显示）：' >/dev/tty
IFS= read -r -s pwa_r2_secret </dev/tty
printf '\n' >/dev/tty
if [[ -z "$pwa_r2_access" || -z "$pwa_r2_secret" ]]; then echo '两项 R2 凭据不能为空。' >&2; exit 1; fi
printf 'export CLOUDFLARE_API_TOKEN=%q\nexport R2_ACCESS_KEY_ID=%q\nexport R2_SECRET_ACCESS_KEY=%q\n' "$pwa_worker_token" "$pwa_r2_access" "$pwa_r2_secret" >"$credential_tmp"
chmod 600 "$credential_tmp"
mv "$credential_tmp" "$credential_file"
echo '凭据已安全准备；未显示密钥。请回复“已准备”。'
