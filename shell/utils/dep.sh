#!/bin/bash

# 去掉字符串末尾的斜杠（用于 URL 参数格式化）
function _strip_trailing_slash() {
    echo "${1%/}"
}

# ─── 软件源读取函数 ────────────────────────────────────────────────

# 返回当前 npm registry
function dep_get_npm_registry() {
    command -v npm >/dev/null 2>&1 || return 0
    npm config get registry 2>/dev/null | tr -d '\n' | sed 's|/$||'
}

# 返回当前 pip index-url
function dep_get_pip_index_url() {
    local url
    for cmd in "pip config get global.index-url" "pip3 config get global.index-url"; do
        url="$(${cmd} 2>/dev/null | tr -d '\n')"
        if [ -n "${url}" ] && [[ "${url}" != *"WARNING"* ]] && [[ "${url}" != *"undefined"* ]]; then
            echo "${url%/}"
            return 0
        fi
    done
}

# 返回当前 APT 镜像源 URL
function dep_get_apt_mirror_url() {
    local sources_file="/etc/apt/sources.list.d/debian.sources"
    [ -f "${sources_file}" ] || return 0
    local uri
    uri="$(grep -i '^[[:space:]]*URIs:' "${sources_file}" | head -1 | sed -E 's/^[[:space:]]*URIs:[[:space:]]*//' | awk '{print $1}' | sed -E 's/^"|"$//g' | sed 's|/$||')"
    [ -n "${uri}" ] && echo "${uri}"
}

# ─── 软件源配置函数 ────────────────────────────────────────────────

function npm_dep_set_source() {
    local registry
    registry="$(_strip_trailing_slash "${1}")"
    command -v npm >/dev/null 2>&1 || {
        echo "[dep.sh] ERROR: npm is not installed" >&2
        return 1
    }
    if [ -z "${registry}" ]; then
        npm config delete registry
        echo "[dep.sh] npm registry 已重置为默认"
    else
        npm config set registry "${registry}"
        echo "[dep.sh] npm registry 已设置为: ${registry}"
    fi
}

function pip_dep_set_source() {
    local index_url
    index_url="$(_strip_trailing_slash "${1}")"
    command -v pip3 >/dev/null 2>&1 || {
        echo "[dep.sh] ERROR: pip3 is not installed" >&2
        return 1
    }
    if [ -z "${index_url}" ]; then
        pip3 config unset global.index-url 2>/dev/null || true
        echo "[dep.sh] pip index-url 已重置为默认"
    else
        pip3 config set global.index-url "${index_url}"
        echo "[dep.sh] pip index-url 已设置为: ${index_url}"
    fi
}

# apt 软件源配置：覆盖 /etc/apt/sources.list.d/debian.sources
function apt_dep_set_source() {
    local mirror_url
    mirror_url="$(_strip_trailing_slash "${1}")"
    local sources_file="/etc/apt/sources.list.d/debian.sources"
    [ -z "${mirror_url}" ] && return 0
    if [ ! -w "$(dirname "${sources_file}")" ]; then
        echo "[dep.sh] ERROR: 无权限写入 ${sources_file}，请以 root 运行" >&2
        return 1
    fi
    local security_url
    if [[ "${mirror_url}" == */debian ]]; then
        security_url="${mirror_url%/debian}/debian-security"
    else
        security_url="${mirror_url}-security"
    fi
    local tmpfile
    tmpfile="$(mktemp "${sources_file}.tmp.XXXXXX")" || {
        echo "[dep.sh] ERROR: 无法创建临时文件" >&2
        return 1
    }
    local codename="$(grep -E "^VERSION_CODENAME=" /etc/os-release | cut -d= -f2- | sed "s/[\'\"]//g")"
    cat >"${tmpfile}" <<EOF
Types: deb
URIs: ${mirror_url}
Suites: ${codename} ${codename}-updates
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.pgp

Types: deb
URIs: ${security_url}
Suites: ${codename}-security
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.pgp
EOF
    mv "${tmpfile}" "${sources_file}"
    echo "[dep.sh] apt sources 已配置为: ${mirror_url}"
}

# 统一软件源配置分发
function dep_set_source() {
    local ecosystem="$1"
    local source_url="$2"
    case "${ecosystem}" in
    npm)
        npm_dep_set_source "${source_url}"
        ;;
    pip)
        pip_dep_set_source "${source_url}"
        ;;
    apt)
        apt_dep_set_source "${source_url}"
        ;;
    *)
        echo "[dep.sh] ERROR: unsupported ecosystem: ${ecosystem}" >&2
        return 1
        ;;
    esac
}

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
#   bash dep.sh install    <ecosystem> <pkg>
#   bash dep.sh uninstall  <ecosystem> <base_pkg>
#   bash dep.sh version    <ecosystem> <base_pkg>
#   bash dep.sh list       <ecosystem>
#   bash dep.sh get-source <ecosystem>         # 输出当前软件源 URL（无则输出空）
#   bash dep.sh set-source <ecosystem> [url]   # 设置软件源（url 为空则重置为默认）

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
get-source)
    case "${1}" in
    npm) dep_get_npm_registry ;;
    pip) dep_get_pip_index_url ;;
    apt) dep_get_apt_mirror_url ;;
    *)
        echo "[dep.sh] ERROR: unsupported ecosystem: ${1}" >&2
        exit 1
        ;;
    esac
    ;;
set-source)
    dep_set_source "$@"
    ;;
*) ;;
esac
