module.exports = {
  apps: [
    {
      name: 'arcadia_server',
      cwd: 'backend',
      script: 'node_modules/.bin/tsx',
      args: 'index',
      watch: true,
      watch_delay: 2000,
      ignore_watch: [
        'node_modules',
        'logs',
        'log',
        '*.log',
        '*.md',
        '*.txt',
        '.git',
        'public',
        'sessions',
        '.vscode',
        'db/prisma/generated',
      ],
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      watch_options: {
        followSymlinks: false,
      },
    },
  ],
}
