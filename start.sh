#!/bin/sh
# 义乌小老板开单对账系统 · 一键启动（零依赖，自动寻找本机 Node 运行时）
cd "$(dirname "$0")"

if command -v node >/dev/null 2>&1; then
  NODE_BIN=node
else
  NODE_BIN=""
  for c in \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    "$HOME/Library/Application Support/Doubao/sandbox_runtime/bases/98670218a5f0d8bc9b9ebf3f70881304/bin/node" \
    "$HOME/.nvm/versions/node"/*/bin/node \
    "$HOME/.volta/bin/node" \
    "$HOME/.fnm/aliases/default/bin/node"
  do
    if [ -x "$c" ]; then NODE_BIN="$c"; break; fi
  done
fi

if [ -z "$NODE_BIN" ]; then
  echo "未找到 Node.js 运行时。请安装 Node 18+（https://nodejs.org）后重试。"
  exit 1
fi

echo "使用 Node: $NODE_BIN ($("$NODE_BIN" --version))"
exec "$NODE_BIN" server.js