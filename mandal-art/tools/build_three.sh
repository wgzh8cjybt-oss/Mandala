#!/usr/bin/env bash
# Собирает минимальный бандл three.js (MIT) -> build/three.bundle.js. Нужны: клон https://github.com/mrdoob/three.js и esbuild.
# THREE_DIR — путь к клону (по умолчанию /home/claude/mrdoob/three.js), ESBUILD — путь к esbuild.
set -euo pipefail
cd "$(dirname "$0")/.."
T="${THREE_DIR:-/home/claude/mrdoob/three.js}"
E="${ESBUILD:-/opt/npm-tools/node_modules/esbuild/bin/esbuild}"
mkdir -p build
"$E" src/three/entry.js --bundle --minify --format=iife --target=es2019 --legal-comments=none \
  --alias:three="$T/build/three.module.js" --alias:three/addons="$T/examples/jsm" \
  --banner:js="/* three.js r187 — Copyright 2010-2026 Three.js Authors — MIT (github.com/mrdoob/three.js). Включены GLTFLoader, RoomEnvironment, meshopt_decoder из того же репозитория. */" \
  --outfile=build/three.bundle.js
ls -l build/three.bundle.js
gzip -9 -c build/three.bundle.js | wc -c | awk '{print "gzip:", $1, "bytes"}'
