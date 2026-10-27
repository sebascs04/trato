const {defineConfig} = require('@playwright/test');
module.exports = defineConfig({
  testDir:'./tests/browser', timeout:20000, workers:1, reporter:'list',
  outputDir:'.local/browser-tests/artifacts',
  use:{baseURL:'http://localhost:5173',viewport:{width:1440,height:1000},screenshot:'only-on-failure'},
});
