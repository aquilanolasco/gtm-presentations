#!/bin/bash
cd "$(dirname "$0")"
set -a; source ./relay.env; set +a
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
exec node relay.mjs
