#!/usr/bin/env node
'use strict';

const { install } = require('./index-store');

if (require.main === module) {
  try {
    if (process.argv.length !== 2) throw new Error('用法：node scripts/install.js');
    process.stdout.write(`索引已就绪：${install()}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { install };
