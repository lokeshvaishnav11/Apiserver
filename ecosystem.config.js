module.exports = {
  apps: [{
    name: 'odds-api-3088',
    script: './server.js',
    instances: 8,
    exec_mode: 'cluster',
    autorestart: true,
    max_memory_restart: '750M',
    env: { NODE_ENV: 'production', PORT: 3088 }
  }]
};
