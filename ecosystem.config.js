/** PM2 process file for a VPS:  pm2 start ecosystem.config.js && pm2 save */
module.exports = {
  apps: [
    {
      name: 'portohr',
      script: 'src/server.js',
      // One process keeps in-memory rate limits accurate. Raise it only after
      // moving rate limiting to a shared store.
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '500M',
      env: { NODE_ENV: 'production' },
      time: true,
      kill_timeout: 12000,
    },
  ],
};
