#!/bin/sh
set -eu

cd -- "$(dirname -- "$0")"
: "${PORT:=8082}"
export PORT

exec node dist/cli.cjs "$@"
