#!/bin/bash

# ─── npm ──────────────────────────────────────────────────────────

function npm_dep_install() {
    local pkg="$1"
    command -v npm >/dev/null 2>&1 || {
        echo "[dep.sh] ERROR: npm is not installed" >&2
        return 1
    }
    npm install -g "${pkg}"
}

function npm_dep_uninstall() {
    local base_pkg="$1" # 纯包名（不含版本表达式）
    command -v npm >/dev/null 2>&1 || {
        echo "[dep.sh] ERROR: npm is not installed" >&2
        return 1
    }
    npm uninstall -g "${base_pkg}"
}

function npm_dep_version() {
    local base_pkg="$1"
    command -v npm >/dev/null 2>&1 || {
        echo "[dep.sh] ERROR: npm is not installed" >&2
        return 1
    }
    npm list -g "${base_pkg}" --depth=0 --json 2>/dev/null | jq -r --arg pkg "${base_pkg}" '.dependencies[$pkg].version // ""'
}

function npm_dep_list_all() {
    command -v npm >/dev/null 2>&1 || {
        echo "[dep.sh] ERROR: npm is not installed" >&2
        return 1
    }
    # 输出 JSON: { "包名": { "version": "x.y.z" }, ... }
    npm list -g --depth=0 --json 2>/dev/null | jq '.dependencies // {}'
}

# ─── pip (pip3) ──────────────────────────────────────────────────────────

function pip_dep_install() {
    local pkg="$1"
    command -v pip3 >/dev/null 2>&1 || {
        echo "[dep.sh] ERROR: pip3 is not installed" >&2
        return 1
    }
    pip3 install --no-cache-dir --break-system-packages "${pkg}"
}

function pip_dep_uninstall() {
    local base_pkg="$1"
    command -v pip3 >/dev/null 2>&1 || {
        echo "[dep.sh] ERROR: pip3 is not installed" >&2
        return 1
    }
    pip3 uninstall -y --break-system-packages "${base_pkg}"
}

function pip_dep_version() {
    local base_pkg="$1"
    command -v pip3 >/dev/null 2>&1 || {
        echo "[dep.sh] ERROR: pip3 is not installed" >&2
        return 1
    }
    pip3 show "${base_pkg}" 2>/dev/null | awk '/^Version:/{print $2}'
}

function pip_dep_list_all() {
    command -v pip3 >/dev/null 2>&1 || {
        echo "[dep.sh] ERROR: pip3 is not installed" >&2
        return 1
    }
    # 输出 JSON 数组: [{ "name": "requests", "version": "2.31.0" }, ...]
    pip3 list --format=json 2>/dev/null
}

# ─── APT ──────────────────────────────────────────────────────────

function _apt_wait_lock() {
    local i=0
    while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do
        ((i++))
        if [[ $i -ge 60 ]]; then
            echo "[dep.sh] ERROR: apt lock timeout after 60s" >&2
            return 1
        fi
        sleep 1
    done
    return 0
}

function apt_dep_install() {
    local pkg="$1"
    _apt_wait_lock || return 1
    apt-get update -qq && apt-get install -y --no-install-recommends "${pkg}"
}

function apt_dep_uninstall() {
    local base_pkg="$1"
    _apt_wait_lock || return 1
    apt-get remove -y "${base_pkg}"
}

function apt_dep_version() {
    dpkg -s "$1" 2>/dev/null | awk '/^Version:/{print $2}'
}

function apt_dep_list_all() {
    # 输出 TSV: 包名\t版本（每行）
    dpkg-query -W -f='${Package}\t${Version}\n' 2>/dev/null
}

# 通用

function dep_install() {
    local ecosystem="$1"
    local pkg="$2"
    case "${ecosystem}" in
    npm)
        npm_dep_install "${pkg}"
        ;;
    pip)
        pip_dep_install "${pkg}"
        ;;
    apt)
        apt_dep_install "${pkg}"
        ;;
    *)
        echo "[dep.sh] ERROR: unsupported ecosystem: ${ecosystem}" >&2
        return 1
        ;;
    esac
}

function dep_uninstall() {
    local ecosystem="$1"
    local base_pkg="$2"
    case "${ecosystem}" in
    npm)
        npm_dep_uninstall "${base_pkg}"
        ;;
    pip)
        pip_dep_uninstall "${base_pkg}"
        ;;
    apt)
        apt_dep_uninstall "${base_pkg}"
        ;;
    *)
        echo "[dep.sh] ERROR: unsupported ecosystem: ${ecosystem}" >&2
        return 1
        ;;
    esac
}

function dep_version() {
    local ecosystem="$1"
    local base_pkg="$2"
    case "${ecosystem}" in
    npm)
        npm_dep_version "${base_pkg}"
        ;;
    pip)
        pip_dep_version "${base_pkg}"
        ;;
    apt)
        apt_dep_version "${base_pkg}"
        ;;
    *)
        echo "[dep.sh] ERROR: unsupported ecosystem: ${ecosystem}" >&2
        return 1
        ;;
    esac
}

function dep_list_all() {
    local ecosystem="$1"
    case "${ecosystem}" in
    npm)
        npm_dep_list_all
        ;;
    pip)
        pip_dep_list_all
        ;;
    apt)
        apt_dep_list_all
        ;;
    *)
        echo "[dep.sh] ERROR: unsupported ecosystem: ${ecosystem}" >&2
        return 1
        ;;
    esac
}

# 用法：
#   bash dep.sh install   <ecosystem> <pkg>
#   bash dep.sh uninstall <ecosystem> <base_pkg>
#   bash dep.sh version   <ecosystem> <base_pkg>
#   bash dep.sh list      <ecosystem>

CMD="${1}"
shift 2>/dev/null

case "${CMD}" in
install)
    dep_install "$@"
    ;;
uninstall)
    dep_uninstall "$@"
    ;;
version)
    dep_version "$@"
    ;;
list)
    dep_list_all "$@"
    ;;
*) ;;
esac
