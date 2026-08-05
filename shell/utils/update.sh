#!/bin/bash

# ─── 版本信息 ─────────────────────────────────────────────────

# 获取当前跟踪分支；仓库处于游离（detached HEAD）状态时返回非零退出码
function update_current_branch() {
    local repo_dir="$1"
    cd "${repo_dir}"
    local branch
    branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
    if [[ -z "${branch}" || "${branch}" == "HEAD" ]]; then
        echo "[update.sh] ERROR: detached HEAD, cannot resolve tracked branch" >&2
        return 1
    fi
    echo "${branch}"
}

# 输出当前版本号：dev 分支固定返回 Dev，生产分支取最近 tag，其余分支不输出并以非零退出码表达
function update_current_version() {
    local repo_dir="$1"
    cd "${repo_dir}"
    local branch
    branch="$(update_current_branch "${repo_dir}")"
    case "${branch}" in
    dev)
        echo "Dev"
        ;;
    main)
        git describe --tags --abbrev=0 HEAD 2>/dev/null
        ;;
    *)
        return 1
        ;;
    esac
}

# 解析修订版本对应的完整提交 SHA
function update_resolve_commit() {
    local repo_dir="$1"
    local revision="$2"
    cd "${repo_dir}"
    git rev-parse "${revision}" 2>/dev/null
}

# 判断 commit 是否已包含在 revision 的历史中（含相同）；无输出，只用退出码表达
function update_is_ancestor() {
    local repo_dir="$1"
    local ancestor="$2"
    local revision="$3"
    cd "${repo_dir}"
    git merge-base --is-ancestor "${ancestor}" "${revision}" 2>/dev/null
}

# ─── 网络与更新执行 ───────────────────────────────────────────

# 拉取远程分支与标签（唯一会产生网络请求的子命令）
function update_fetch() {
    local repo_dir="$1"
    local branch="$2"
    cd "${repo_dir}"
    git fetch --tags origin "${branch}"
}

# 执行现有升级命令（更新项目源码）
function update_upgrade() {
    local root_dir="$1"
    local src_dir="$2"
    cd "${root_dir}"
    bash "${src_dir}/shell/main.sh" upgrade
}

# 用法：
#   bash update.sh current-branch  <repo_dir>
#   bash update.sh current-version <repo_dir>
#   bash update.sh resolve-commit  <repo_dir> <revision>
#   bash update.sh is-ancestor     <repo_dir> <ancestor> <revision>
#   bash update.sh fetch           <repo_dir> <branch>
#   bash update.sh upgrade         <root_dir> <src_dir>

CMD="${1}"
shift 2>/dev/null

case "${CMD}" in
current-branch)
    update_current_branch "$@"
    ;;
current-version)
    update_current_version "$@"
    ;;
resolve-commit)
    update_resolve_commit "$@"
    ;;
is-ancestor)
    update_is_ancestor "$@"
    ;;
fetch)
    update_fetch "$@"
    ;;
upgrade)
    update_upgrade "$@"
    ;;
*)
    echo "[update.sh] ERROR: unsupported command: ${CMD}" >&2
    exit 1
    ;;
esac
