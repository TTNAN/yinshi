#!/bin/sh
# 发版前运行：把 site/index.html 里所有 ?v=xxxx 换成新的版本号（默认今天的日期+时分）
set -e
V="${1:-$(date +%Y%m%d%H%M)}"
cd "$(dirname "$0")/../site"
sed -i -E "s/\?v=[0-9A-Za-z._-]+/?v=$V/g" index.html
echo "version -> $V"
