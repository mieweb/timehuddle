module.exports = {
  apps: [
    {
      name: 'timehuddle-frontend',
      script: 'npm',
      args: 'start',
      cwd: '/Users/mieloaner/mieprojects/timehuddle',
      watch: false,
      env: {
        NODE_ENV: 'development',
      },
    },
    {
      name: 'timehuddle-backend',
      script: '/Users/mieloaner/mieprojects/timehuddle/backend/node_modules/.bin/tsx',
      args: 'watch src/server.ts',
      cwd: '/Users/mieloaner/mieprojects/timehuddle/backend',
      watch: false,
      env: {
        NODE_ENV: 'development',
      },
    },
  ],
};
