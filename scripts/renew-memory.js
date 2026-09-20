#!/usr/bin/env node
'use strict';

const { indexPath, renewCard, readIndex, expiration } = require('./index-store');

function renew(id, file = indexPath(), now = new Date()) {
  const card = renewCard(id, file, now);
  const { ttlDays } = readIndex(file);
  return { id: card.id, createTime: card.createTime, updataTime: card.updataTime, ...expiration(card, ttlDays, now) };
}

if (require.main === module) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--id') throw new Error('用法：node scripts/renew-memory.js --id <卡片 UUID>');
    process.stdout.write(JSON.stringify(renew(process.argv[3]), null, 2) + '\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { renew };
