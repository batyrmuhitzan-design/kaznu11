#!/usr/bin/env bash
# =====================================================================
# NodeBB 试跑的前置：给服务器加 2GB swap（内存安全网）。幂等，可重复执行。
#
# 为什么必须做：这台 VPS 共 842MB 内存、可用仅 ~159MB，而且**一个 swap 都没有**
#   —— 内存一打满，OOM killer 会直接杀进程（很可能杀到生产里的 uvicorn）。
#   swap 让内核先换页、而不是立刻开杀；配合 compose 里的 mem_limit，
#   NodeBB/Redis 超限会死在自己的 cgroup 内，波及不到生产。
#
# 用法（root）：bash deploy/nodebb/server-prep.sh
# 回滚：swapoff /swapfile && sed -i '/swapfile/d' /etc/fstab && rm -f /swapfile
# =====================================================================
set -euo pipefail

SWAPFILE=/swapfile
SIZE_MB="${SWAP_SIZE_MB:-2048}"
SYSCTL_FILE=/etc/sysctl.d/99-kaznu-nodebb.conf

[ "$(id -u)" = "0" ] || { echo "❌ 需要 root：sudo bash $0"; exit 1; }

echo "==> 1) swap"
if swapon --show --noheadings 2>/dev/null | grep -q "$SWAPFILE"; then
  echo "    $SWAPFILE 已启用，跳过"
else
  if [ -e "$SWAPFILE" ]; then
    echo "    $SWAPFILE 文件已存在（未启用），直接 swapon"
  else
    echo "    创建 ${SIZE_MB}MB 交换文件 ..."
    # fallocate 最快；某些文件系统不支持时退回 dd
    fallocate -l "${SIZE_MB}M" "$SWAPFILE" 2>/dev/null \
      || dd if=/dev/zero of="$SWAPFILE" bs=1M count="$SIZE_MB" status=none
    chmod 600 "$SWAPFILE"
    mkswap "$SWAPFILE" >/dev/null
  fi
  swapon "$SWAPFILE"
fi

if grep -q "^${SWAPFILE}[[:space:]]" /etc/fstab; then
  echo "    /etc/fstab 已登记（重启后自动挂载）"
else
  echo "${SWAPFILE} none swap sw 0 0" >> /etc/fstab
  echo "    已写入 /etc/fstab"
fi

echo "==> 2) 内核参数（swap 只当安全网，不主动换出生产热页）"
cat > "$SYSCTL_FILE" <<'EOF'
# KazNU Helper：NodeBB 试跑期的内存策略
# swappiness=10 —— 优先回收 cache，而不是把 uvicorn 的热页换出去
vm.swappiness = 10
vm.vfs_cache_pressure = 50
EOF
sysctl -p "$SYSCTL_FILE" >/dev/null
echo "    vm.swappiness=$(cat /proc/sys/vm/swappiness)"

echo
echo "==> 结果"
free -m
swapon --show
echo "PREP_DONE"
