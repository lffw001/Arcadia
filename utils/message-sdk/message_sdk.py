import json
import urllib.request
from urllib.error import HTTPError, URLError

_VALID_TYPES = ('info', 'warn', 'error', 'success')
_API_URL = 'http://127.0.0.1:5678/api/inner/message/push'


def push(title: str, content: str, type: str = 'info') -> bool:
    """
    推送消息

    :param title: 消息标题（必填）
    :param content: 消息内容（必填）
    :param type: 消息类型，可选值：info（默认）/ warn / error / success
    :return: 推送成功返回 True
    :raises ValueError: type 不在允许范围内时抛出
    :raises Exception: 网络错误或服务端返回错误时抛出
    """
    if type not in _VALID_TYPES:
        raise ValueError('type must be one of: info, warn, error, success')

    body = {'title': title, 'content': content, 'type': type}

    data = json.dumps(body).encode('utf-8')
    req = urllib.request.Request(
        _API_URL,
        data=data,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )

    try:
        with urllib.request.urlopen(req) as resp:
            response_data = json.loads(resp.read().decode('utf-8'))
    except HTTPError as e:
        body_text = e.read().decode('utf-8', errors='replace')
        try:
            response_data = json.loads(body_text)
        except json.JSONDecodeError:
            raise Exception(f'推送失败：{e.code} {e.reason}')
    except URLError as e:
        raise Exception(f'网络连接失败：{e.reason}')

    if response_data.get('code') != 1:
        raise Exception(f'推送失败：{response_data.get("message", "未知错误")}')

    return True
