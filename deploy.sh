#!/bin/bash
cd "$(dirname "$0")"
git add .
git commit -m "${1:-deploy}"
git push
echo "✅ Deploy enviado!"
