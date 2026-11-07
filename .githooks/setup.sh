#!/bin/sh
set -e
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push .githooks/setup.sh 2>/dev/null || true
echo "✅ Git hooks configured to use .githooks/"
