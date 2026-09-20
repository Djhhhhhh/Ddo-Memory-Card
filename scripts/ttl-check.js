#!/usr/bin/env node
'use strict';

const { indexPath, readIndex, problems, syncStatus } = require('./index-store');

function checkExpired(file = indexPath(), now = new Date()) {
  readIndex(file);
  const index = syncStatus(file, now);
  const expired = [];
  const missing = [];
  for (const card of index.cards) {
    const state = problems(card, index.ttlDays, now);
    const item = {
      id: card.id, title: card.title, summary: card.summary, enable: card.enable,
      updataTime: card.updataTime, expiresAt: state.expiresAt, files: card.files,
    };
    if (state.expired) expired.push({ ...item, ...(state.unknownTime ? { unknownTime: true } : {}) });
    if (state.missingFiles.length) missing.push({ ...item, missingFiles: state.missingFiles });
  }
  return { ttlDays: index.ttlDays, checkedAt: now.toISOString(), expired, missing };
}

if (require.main === module) {
  try {
    if (process.argv.length !== 2) throw new Error('用法：node scripts/ttl-check.js');
    process.stdout.write(JSON.stringify(checkExpired(), null, 2) + '\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { checkExpired };
