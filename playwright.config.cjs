const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
 testDir:'./tests/browser',fullyParallel:false,workers:1,
 use:{baseURL:'http://127.0.0.1:3100',headless:true,screenshot:'only-on-failure'},
 webServer:{command:'DEMO_MODE=true PORT=3100 node server/index.js',url:'http://127.0.0.1:3100/api/health',reuseExistingServer:false},
 reporter:'list'
});
