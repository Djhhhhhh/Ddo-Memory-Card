#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { indexPath, validTime, readIndex, registerCard, refreshCard } = require('./index-store');

function validate(card) {
  const errors = [];
  const string = (value, name) => {
    if (typeof value !== 'string' || !value.trim()) errors.push(`${name}: 必须是非空文本`);
  };
  const fields = ['title', 'summary', 'context', 'sections', 'outcome', 'followUps', 'tags', 'source', 'createdAt'];
  if (!card || typeof card !== 'object' || Array.isArray(card)) return ['card: 必须是对象'];
  for (const key of Object.keys(card)) if (!fields.includes(key)) errors.push(`${key}: 未知字段`);
  for (const key of ['title', 'summary', 'createdAt']) string(card[key], key);
  for (const key of ['context', 'outcome', 'source']) {
    if (key in card) string(card[key], key);
  }
  if (typeof card.createdAt === 'string' && !validTime(card.createdAt)) errors.push('createdAt: 必须是 ISO 8601 时间');
  if (!Array.isArray(card.sections) || !card.sections.length) {
    errors.push('sections: 至少需要一个内容章节');
  } else {
    card.sections.forEach((section, i) => {
      const at = `sections[${i}]`;
      if (!section || typeof section !== 'object' || Array.isArray(section)) {
        errors.push(`${at}: 必须是对象`);
        return;
      }
      for (const key of Object.keys(section)) if (!['heading', 'body', 'points'].includes(key)) errors.push(`${at}.${key}: 未知字段`);
      string(section.heading, `${at}.heading`);
      if ('body' in section) string(section.body, `${at}.body`);
      if ('points' in section && !Array.isArray(section.points)) errors.push(`${at}.points: 必须是文本数组`);
      if (Array.isArray(section.points)) section.points.forEach((item, j) => string(item, `${at}.points[${j}]`));
      if (!('body' in section) && (!Array.isArray(section.points) || !section.points.length)) {
        errors.push(`${at}: 需要 body 或非空 points`);
      }
    });
  }
  for (const key of ['followUps', 'tags']) {
    if (key in card) {
      if (!Array.isArray(card[key])) errors.push(`${key}: 必须是文本数组`);
      else card[key].forEach((item, i) => string(item, `${key}[${i}]`));
    }
  }
  return errors;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function escapeMd(value) {
  return value.replace(/\s*\r?\n\s*/g, ' ').replace(/([\\`*_{}\[\]()#+.!|<>~-])/g, '\\$1');
}

function escapeMdBlock(value) {
  return value.replace(/\r\n/g, '\n').split('\n').map(escapeMd).join('\n');
}

function renderMarkdown(card) {
  const lines = [`# ${escapeMd(card.title)}`, '', escapeMdBlock(card.summary), '',
    `> 记录时间：${escapeMd(card.createdAt)}${card.source ? ` · 来源：${escapeMd(card.source)}` : ''}`, ''];
  if (card.context) lines.push('## 背景', '', escapeMdBlock(card.context), '');
  for (const section of card.sections) {
    lines.push(`## ${escapeMd(section.heading)}`, '');
    if (section.body) lines.push(escapeMdBlock(section.body), '');
    for (const point of section.points || []) lines.push(`- ${escapeMd(point)}`);
    if (section.points?.length) lines.push('');
  }
  if (card.outcome) lines.push('## 结果', '', escapeMdBlock(card.outcome), '');
  if (card.followUps?.length) {
    lines.push('## 待办', '');
    for (const item of card.followUps) lines.push(`- ${escapeMd(item)}`);
    lines.push('');
  }
  if (card.tags?.length) lines.push(`标签：${card.tags.map(escapeMd).join('、')}`, '');
  return lines.join('\n');
}

function renderHtml(card) {
  const items = values => values?.length ? `<ul>${values.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : '';
  const section = (name, body) => body ? `<section><h2>${escapeHtml(name)}</h2>${body}</section>` : '';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escapeHtml(card.title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Manrope:wght@400;500;600&display=swap">
<style>
:root{--canvas:#0A0A0B;--surface-1:#121214;--surface-2:#1B1B1F;--text-primary:#EDEDEF;--text-secondary:#A1A1AA;--text-tertiary:#71717A;--border:#27272A;--border-subtle:#1F1F23;--accent:#10B981;--shadow-card:0 2px 4px rgba(0,0,0,.45),0 1px 2px rgba(0,0,0,.3)}
@media (prefers-color-scheme:light){:root:not([data-theme="dark"]){--canvas:#FAFAFA;--surface-1:#FFFFFF;--surface-2:#F4F4F5;--text-primary:#18181B;--text-secondary:#52525B;--text-tertiary:#8E8E93;--border:#E4E4E7;--border-subtle:#ECECEF;--accent:#059669;--shadow-card:0 2px 4px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04)}}
:root[data-theme="light"]{--canvas:#FAFAFA;--surface-1:#FFFFFF;--surface-2:#F4F4F5;--text-primary:#18181B;--text-secondary:#52525B;--text-tertiary:#8E8E93;--border:#E4E4E7;--border-subtle:#ECECEF;--accent:#059669;--shadow-card:0 2px 4px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04)}
*{box-sizing:border-box;scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--text-tertiary) 30%,transparent) transparent}
::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--text-tertiary) 30%,transparent);border:2px solid transparent;border-radius:99px;background-clip:padding-box}::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--text-tertiary) 50%,transparent)}::-webkit-scrollbar-corner{background:transparent}
body{margin:0;padding-inline:16px;padding-block:80px;background:var(--canvas);color:var(--text-primary);font:400 14px/1.55 'Manrope',system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}
main{max-width:720px;margin:auto;padding:24px;background:var(--surface-1);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow-card);min-width:0}
header{padding-bottom:24px;border-bottom:1px solid var(--border-subtle)}h1{margin:0 0 12px;font-size:24px;font-weight:600;line-height:1.25;letter-spacing:-.01em;overflow-wrap:anywhere}
.lead{margin:0 0 16px;color:var(--text-secondary);white-space:pre-wrap;overflow-wrap:anywhere}.meta{color:var(--text-tertiary);font:400 12px/1.55 'Fira Code',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
section{padding-top:24px}h2{margin:0 0 12px;font-size:15px;font-weight:600;line-height:1.4}p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}ul{margin:0;padding-left:20px}p+ul{margin-top:12px}li{overflow-wrap:anywhere}li+li{margin-top:8px}
footer{margin-top:32px;padding-top:12px;border-top:1px solid var(--border-subtle);color:var(--text-tertiary);font:400 12px/1.45 'Fira Code',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere}
@media (max-width:639px){body{padding-block:24px}main{padding:16px}header{padding-bottom:16px}section{padding-top:16px}h1{font-size:18px}}
</style></head><body><main>
<header><h1>${escapeHtml(card.title)}</h1><p class="lead">${escapeHtml(card.summary)}</p><div class="meta">${escapeHtml(card.createdAt)}${card.source ? ` · ${escapeHtml(card.source)}` : ''}</div></header>
${card.context ? section('背景', `<p>${escapeHtml(card.context)}</p>`) : ''}
${card.sections.map(item => section(item.heading, `${item.body ? `<p>${escapeHtml(item.body)}</p>` : ''}${items(item.points)}`)).join('\n')}
${card.outcome ? section('结果', `<p>${escapeHtml(card.outcome)}</p>`) : ''}
${card.followUps?.length ? section('待办', items(card.followUps)) : ''}
${card.tags?.length ? `<footer>标签：${card.tags.map(escapeHtml).join(' · ')}</footer>` : ''}
</main></body></html>\n`;
}

function timestamp(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function parseArgs(args) {
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--input', '--format', '--out', '--refresh-id'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || flags[args[i]]) {
      throw new Error('用法：node scripts/render-card.js --input card.json [--format md|html|both] [--out 输出目录] 或 --input card.json --refresh-id <卡片 UUID>');
    }
    flags[args[i]] = args[i + 1];
  }
  if (!flags['--input'] || !['md', 'html', 'both'].includes(flags['--format'] || 'md') ||
      (flags['--refresh-id'] && (flags['--out'] || flags['--format']))) {
    throw new Error('用法：node scripts/render-card.js --input card.json [--format md|html|both] [--out 输出目录] 或 --input card.json --refresh-id <卡片 UUID>');
  }
  return flags;
}

function run(args, options = {}) {
  const flags = parseArgs(args);
  const card = JSON.parse(fs.readFileSync(flags['--input'], 'utf8'));
  const errors = validate(card);
  if (errors.length) throw new Error(`卡片数据不符合 SKILL.md 中的结构：\n${errors.join('\n')}`);
  const indexFile = options.indexFile || indexPath();
  const index = readIndex(indexFile);
  const savedAt = options.now || new Date();
  if (flags['--refresh-id']) {
    const existing = index.cards.find(item => item.id.toLowerCase() === flags['--refresh-id'].toLowerCase());
    if (!existing) throw new Error(`未找到卡片 ID：${flags['--refresh-id']}`);
    const content = Object.fromEntries(Object.keys(existing.files).map(format => [format, format === 'html' ? renderHtml(card) : renderMarkdown(card)]));
    const refreshed = refreshCard(existing.id, content, card, indexFile, savedAt);
    return { id: refreshed.id, files: refreshed.files, refreshed: true };
  }
  const rawOutput = flags['--out'] || path.join(os.homedir(), '.ddo', 'memory-card');
  const expandedOutput = rawOutput === '~' ? os.homedir() :
    /^[~][\\/]/.test(rawOutput) ? path.join(os.homedir(), rawOutput.slice(2)) : rawOutput;
  if (['.md', '.html'].includes(path.extname(expandedOutput).toLowerCase())) throw new Error('--out 必须是目录，不能指定文件名');
  const outputDir = path.resolve(expandedOutput);
  if (fs.existsSync(outputDir) && !fs.statSync(outputDir).isDirectory()) throw new Error('--out 必须是目录');
  fs.mkdirSync(outputDir, { recursive: true });
  const formats = flags['--format'] === 'both' ? ['md', 'html'] : [flags['--format'] || 'md'];
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = (options.makeId || randomUUID)();
    const basename = `${timestamp(savedAt)}-${id}`;
    const files = Object.fromEntries(formats.map(format => [format, path.join(outputDir, `${basename}.${format}`)]));
    if (Object.values(files).some(file => fs.existsSync(file))) continue;
    const created = [];
    try {
      for (const format of formats) {
        fs.writeFileSync(files[format], format === 'html' ? renderHtml(card) : renderMarkdown(card), { encoding: 'utf8', flag: 'wx' });
        created.push(files[format]);
      }
      registerCard({ id, title: card.title, summary: card.summary, ...(card.tags?.length ? { tags: card.tags } : {}), ...(card.source ? { source: card.source } : {}), files, createTime: savedAt.toISOString(), updataTime: savedAt.toISOString(), enable: true }, indexFile);
      return { id, files };
    } catch (error) {
      for (const file of created) fs.rmSync(file, { force: true });
      if (error.code === 'EEXIST') continue;
      throw error;
    }
  }
  throw new Error('无法生成不重复的卡片文件名，请重试');
}

if (require.main === module) {
  try { process.stdout.write(JSON.stringify(run(process.argv.slice(2)), null, 2) + '\n'); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { validate, renderMarkdown, renderHtml, run, timestamp };
