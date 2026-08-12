#!/bin/bash

## 推送消息到消息中心
# push_message <title> <content> [type]
function push_message() {
    local title="$1"
    local content="$2"
    local type="${3:-info}"
    [[ -z "${title}" ]] && output_error "push_message 缺少必填参数 ${BLUE}title${PLAIN}"
    [[ -z "${content}" ]] && output_error "push_message 缺少必填参数 ${BLUE}content${PLAIN}"
    case "${type}" in
    info | warn | error | success) ;;
    *)
        output_error "push_message 无效的 type 值 ${BLUE}${type}${PLAIN}，仅允许 info/warn/error/success"
        ;;
    esac

    local data
    data="$(jq -nc --arg t "${title}" --arg c "${content}" --arg tp "${type}" \
        '{title: $t, content: $c, type: $tp}')"
    local res
    res="$(curl -s -X POST -H "Content-Type: application/json" \
        -d "${data}" "http://127.0.0.1:5678/api/inner/message/push")"
    local code
    code="$(echo "${res}" | jq -r '.code' 2>/dev/null)"
    if [[ "${code}" != "1" ]]; then
        output_error "消息推送失败 => $(echo "${res}" | jq -r '.message' 2>/dev/null)"
    fi
}
