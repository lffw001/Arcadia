from telethon import events
from .. import tgbot, chat_id


@tgbot.on(events.NewMessage(from_users=chat_id, pattern='^/help'))
async def bot_help(event):
    '''接收/help命令后执行程序'''
    msg_text = event.raw_text.split(' ')
    if len(msg_text) == 2:
        text = msg_text[-1]
    else:
        text = 'mhelp'
    mhelp = '''
a-自定义快捷按钮
clearboard-删除快捷按钮
cmd-执行cmd命令
edit-编辑文件
env-管理环境变量
dl-下载文件
getfile-获取目录下文件
log-选择日志
set-设置Bot部分功能
setname-设置命令别名
setshort-设置自定义按钮
run-选择脚本后台运行
start-开始使用本程序'''

    cmd = '/cmd用于执行cmd命令，如果命令持续10分钟仍未结束，将强行终止，以保障机器人响应'
    edit = '/edit 进入/arcadia目录选择文件进行编辑，仅限简易编辑\n/edit /xx/config进入config目录选择文件编辑\n/edit /xx/config/config.sh 直接编辑config.sh文件'
    getfile = '/getfile 进入/arcadia目录选择文件进行获取\n/getfile /xx/config进入config目录选择文件获取\n/getfile /xx/config/config.sh 直接获取config.sh文件'
    setshort = '/setshort 用于设置快捷方式，格式如下：\n更新-->jup\nAAA-->BBB这种格式使用/a选择\n/edit /xx/config/config.sh\n以“/”开头的为机器人命令快捷，使用/b选择'
    run = '/run 选择脚本并运行'
    botset = '''/set 
        - run时中英文切换
        - 每列几个按钮
        - 是否开启机器人转发
        - 机器人聊天黑名单
            - 使用，或者空格等符号进行用户id区隔
        - 机器人黑名单垃圾话
            - 加入机器人黑名单后，使用 | 区隔设置垃圾话，会随机挑选垃圾话回复该用户'''
    help_me = {'cmd': cmd, 'edit': edit, 'getfile': getfile, 'setshort': setshort, 'run': run, 'mhelp': mhelp, 'set': botset}
    await tgbot.send_message(chat_id, help_me[text])
