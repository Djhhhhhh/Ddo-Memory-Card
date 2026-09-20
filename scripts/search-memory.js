#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { indexPath, readIndex, problems, syncStatus } = require('./index-store');

function tokens(text) {
  const value = text.toLowerCase();
  const words = value.match(/[a-z0-9_/-]{2,}/g) || [];
  for (const segment of value.match(/[\p{Script=Han}]{2,}/gu) || []) {
    for (let i = 0; i < segment.length - 1; i++) words.push(segment.slice(i, i + 2));
  }
  return [...new Set(words)];
}

function score(card, query) {
  const q = query.toLowerCase().trim();
  const title = card.title.toLowerCase();
  const summary = card.summary.toLowerCase();
  const tags = (card.tags || []).map(tag => tag.toLowerCase());
  const source = (card.source || '').toLowerCase();
  let total = card.id.toLowerCase() === q ? 150 : 0;
  total += source === q ? 150 : source.includes(q) ? 55 : 0;
  total += title === q ? 120 : title.includes(q) ? 80 : 0;
  total += summary.includes(q) ? 30 : 0;
  total += tags.some(tag => tag === q) ? 60 : tags.some(tag => tag.includes(q)) ? 45 : 0;
  for (const word of tokens(q)) {
    if (title.includes(word)) total += 8;
    if (tags.some(tag => tag.includes(word))) total += 5;
    if (summary.includes(word)) total += 2;
  }
  return total;
}

function parseArgs(args) {
  const flags = {};
  for (let i = 0; i < args.length;) {
    if (args[i] === '--allow-expired' && !flags['--allow-expired']) {
      flags['--allow-expired'] = true;
      i++;
      continue;
    }
    if (!['--query', '--id', '--format'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || flags[args[i]]) {
      throw new Error('用法：node scripts/search-memory.js --query "关键词" 或 --id <卡片 UUID> [--format md|html] [--allow-expired]');
    }
    flags[args[i]] = args[i + 1];
    i += 2;
  }
  if (Boolean(flags['--query']) === Boolean(flags['--id']) || (flags['--format'] && !['md', 'html'].includes(flags['--format']))) {
    throw new Error('需要且只能提供 --query 或 --id；--format 只能是 md 或 html');
  }
  return flags;
}

function search(args, file = indexPath(), now = new Date()) {
  const flags = parseArgs(args);
  const current = readIndex(file);
  const index = current.cards.some(card => {
    if (!card.enable) return false;
    const state = problems(card, current.ttlDays, now);
    return state.expired || state.missingFiles.length;
  }) ? syncStatus(file, now) : current;
  const cards = index.cards;
  let card;
  if (flags['--id']) {
    card = cards.find(item => item.id.toLowerCase() === flags['--id'].toLowerCase());
    if (!card) throw new Error(`未找到卡片 ID：${flags['--id']}`);
  } else {
    const query = flags['--query'].trim();
    if (!query) throw new Error('查询词不能为空');
    const matches = cards.map(item => ({ card: item, score: score(item, query) }))
      .filter(item => item.score > 0).sort((a, b) => b.score - a.score);
    if (!matches.length) throw new Error(`没有匹配的记忆：${query}`);
    const similar = matches.filter(item => item.score >= matches[0].score * 0.75);
    if (similar.length > 1 || matches[0].score < 30) return {
      kind: 'choices',
      matches: similar.map(({ card: item, score: rank }) => ({
        id: item.id, title: item.title, summary: item.summary, formats: Object.keys(item.files), score: rank,
        enable: item.enable, ...problems(item, index.ttlDays, now),
      })),
    };
    card = matches[0].card;
  }
  const state = problems(card, index.ttlDays, now);
  if (state.missingFiles.length) return {
    kind: 'missing', id: card.id, title: card.title, missingFiles: state.missingFiles,
    message: '索引中的文件已缺失，记忆已停用；请提供来源并刷新同一张卡片',
  };
  if (state.expired && !flags['--allow-expired']) return {
    kind: 'expired', id: card.id, title: card.title, summary: card.summary,
    updataTime: card.updataTime, expiresAt: state.expiresAt,
    options: ['续期：确认内容仍有效后运行 renew-memory.js --id <卡片 UUID>', '刷新：重新核查来源并运行 render-card.js --input card.json --refresh-id <卡片 UUID>', '仅查看旧版：添加 --allow-expired'],
  };
  if (!card.enable && !state.expired) return { kind: 'disabled', id: card.id, title: card.title, message: '该记忆已停用；请复核后续期或刷新' };
  const format = flags['--format'] || (card.files.md ? 'md' : 'html');
  const target = card.files[format];
  if (!target) throw new Error(`卡片 ${card.id} 没有 ${format} 格式；可用：${Object.keys(card.files).join(', ')}`);
  try { return { kind: 'content', id: card.id, format, content: fs.readFileSync(target, 'utf8'), ...state }; }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`索引指向的文件不存在：${target}`);
    throw error;
  }
}

if (require.main === module) {
  try {
    const result = search(process.argv.slice(2));
    if (result.kind === 'content' && result.expired) process.stderr.write(`注意：卡片 ${result.id} 已过期（${result.expiresAt}），以下为旧版内容。\n`);
    process.stdout.write(result.kind === 'content' ? result.content : JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { tokens, score, search };
