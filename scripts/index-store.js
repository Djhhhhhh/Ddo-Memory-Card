'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULT_TTL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function indexPath() {
  return path.join(os.homedir(), '.ddo', 'memory', 'index.json');
}

function validTime(value) {
  if (typeof value !== 'string') return false;
  const parts = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(Z|[+-]\d\d:\d\d)$/.exec(value);
  if (!parts) return false;
  const [, year, month, day, hour, minute, second, zone] = parts;
  const maxDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > maxDay ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return false;
  return !Number.isNaN(Date.parse(value));
}

function fileExists(file) {
  try { return fs.statSync(file).isFile(); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false; throw error; }
}

function validateIndex(index) {
  if (!index || index.version !== 1 || !Array.isArray(index.cards)) throw new Error('索引格式无效：需要 version: 1 和 cards 数组');
  if (!Number.isSafeInteger(index.ttlDays) || index.ttlDays < 1 || index.ttlDays > 36500) throw new Error('ttlDays: 必须是 1–36500 的整数天数');
  const ids = new Set();
  for (const [i, card] of index.cards.entries()) {
    const label = `cards[${i}]`;
    if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error(`${label}: 必须是对象`);
    if (typeof card.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(card.id)) throw new Error(`${label}.id: 必须是 UUID`);
    if (ids.has(card.id.toLowerCase())) throw new Error(`${label}.id: 重复`);
    ids.add(card.id.toLowerCase());
    for (const key of ['title', 'summary']) {
      if (typeof card[key] !== 'string' || !card[key].trim()) throw new Error(`${label}.${key}: 必须是非空文本`);
    }
    for (const key of ['source']) {
      if (card[key] !== undefined && (typeof card[key] !== 'string' || !card[key].trim())) throw new Error(`${label}.${key}: 必须是非空文本`);
    }
    if (card.tags !== undefined && (!Array.isArray(card.tags) || card.tags.some(tag => typeof tag !== 'string' || !tag.trim()))) throw new Error(`${label}.tags: 必须是非空文本数组`);
    if (!card.files || typeof card.files !== 'object' || Array.isArray(card.files) || !Object.keys(card.files).length) throw new Error(`${label}.files: 必须是非空格式映射`);
    for (const [format, file] of Object.entries(card.files)) {
      const name = typeof file === 'string' ? path.basename(file) : '';
      const expected = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-\\d{6}-${card.id}\\.${format}$`, 'i');
      if (!['md', 'html'].includes(format) || typeof file !== 'string' || !path.isAbsolute(file) || !expected.test(name)) {
        throw new Error(`${label}.files.${format}: 必须是与卡片 ID/格式匹配的绝对文件路径`);
      }
    }
    if (card.createTime !== undefined && !validTime(card.createTime)) throw new Error(`${label}.createTime: 必须是有效 ISO 8601 时间`);
    if (card.updataTime !== null && !validTime(card.updataTime)) throw new Error(`${label}.updataTime: 必须是有效 ISO 8601 时间或 null`);
    if (card.createTime && card.updataTime && Date.parse(card.updataTime) < Date.parse(card.createTime)) throw new Error(`${label}: updataTime 不得早于 createTime`);
    if (typeof card.enable !== 'boolean' || (card.updataTime === null && card.enable)) throw new Error(`${label}.enable: 必须是布尔值；未知更新时间不能启用`);
  }
  return index;
}

function readRaw(file) {
  let content;
  try { content = fs.readFileSync(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`索引不存在：${file}；请先运行 node scripts/install.js`);
    throw error;
  }
  try { return JSON.parse(content); }
  catch (error) { throw new Error(`索引 ${file} 无效：${error.message}`); }
}

function readIndex(file = indexPath()) {
  try { return validateIndex(readRaw(file)); }
  catch (error) {
    if (error.message.startsWith('索引不存在') || error.message.startsWith('索引 ')) throw error;
    throw new Error(`索引 ${file} 无效：${error.message}；旧索引请运行 install.js 升级`);
  }
}

function withIndexLock(file, update) {
  const lock = `${file}.lock`;
  let handle;
  try { handle = fs.openSync(lock, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`索引正在写入（${lock}）；请稍后重试`);
    throw error;
  }
  let temp;
  let rollback;
  try {
    const current = readRaw(file);
    const next = update(current, fn => { rollback = fn; });
    validateIndex(next);
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' });
      fs.renameSync(temp, file);
      temp = undefined;
    }
    return next;
  } catch (error) {
    if (rollback) {
      try { rollback(); }
      catch (restoreError) { error.message += `；恢复卡片文件失败：${restoreError.message}`; }
    }
    throw error;
  } finally {
    if (temp) fs.rmSync(temp, { force: true });
    fs.closeSync(handle);
    fs.rmSync(lock, { force: true });
  }
}

function expiration(card, ttlDays, now = new Date()) {
  if (card.updataTime === null) return { expiresAt: null, expired: true, unknownTime: true };
  const expiresAt = new Date(Date.parse(card.updataTime) + ttlDays * DAY_MS).toISOString();
  return { expiresAt, expired: now.getTime() >= Date.parse(expiresAt) };
}

function problems(card, ttlDays, now = new Date()) {
  return { ...expiration(card, ttlDays, now), missingFiles: Object.values(card.files).filter(file => !fileExists(file)) };
}

function upgradeIndex(index, now = new Date()) {
  if (!index || index.version !== 1 || !Array.isArray(index.cards)) throw new Error('索引格式无效：需要 version: 1 和 cards 数组');
  const ttlDays = index.ttlDays === undefined ? DEFAULT_TTL_DAYS : index.ttlDays;
  return {
    ...index, ttlDays,
    cards: index.cards.map(card => {
      const updataTime = card.updataTime === undefined ? null : card.updataTime;
      const upgraded = { ...card, updataTime, enable: typeof card.enable === 'boolean' ? card.enable : false };
      const state = problems(upgraded, ttlDays, now);
      if (state.expired || state.missingFiles.length) upgraded.enable = false;
      else if (card.enable === undefined) upgraded.enable = true;
      return upgraded;
    }),
  };
}

function install(file = indexPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, JSON.stringify({ version: 1, ttlDays: DEFAULT_TTL_DAYS, cards: [] }, null, 2) + '\n', { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  withIndexLock(file, current => upgradeIndex(current));
  return file;
}

function registerCard(entry, file = indexPath()) {
  withIndexLock(file, current => {
    validateIndex(current);
    return { ...current, cards: [...current.cards, entry] };
  });
}

function syncStatus(file = indexPath(), now = new Date()) {
  return withIndexLock(file, current => {
    validateIndex(current);
    return { ...current, cards: current.cards.map(card => {
      const state = problems(card, current.ttlDays, now);
      return card.enable && (state.expired || state.missingFiles.length) ? { ...card, enable: false } : card;
    }) };
  });
}

function renewCard(id, file = indexPath(), now = new Date()) {
  const updated = now.toISOString();
  const next = withIndexLock(file, current => {
    validateIndex(current);
    const card = current.cards.find(item => item.id.toLowerCase() === id.toLowerCase());
    if (!card) throw new Error(`未找到卡片 ID：${id}`);
    if (problems(card, current.ttlDays, now).missingFiles.length) throw new Error(`卡片 ${id} 的文件缺失，请刷新内容，不能仅续期`);
    if (card.createTime && Date.parse(updated) < Date.parse(card.createTime)) throw new Error('续期时间不能早于创建时间');
    return { ...current, cards: current.cards.map(item => item.id === card.id ? { ...item, updataTime: updated, enable: true } : item) };
  });
  return next.cards.find(card => card.id.toLowerCase() === id.toLowerCase());
}

function refreshCard(id, content, metadata, file = indexPath(), now = new Date()) {
  const updated = now.toISOString();
  const next = withIndexLock(file, (current, setRollback) => {
    validateIndex(current);
    const card = current.cards.find(item => item.id.toLowerCase() === id.toLowerCase());
    if (!card) throw new Error(`未找到卡片 ID：${id}`);
    if (card.createTime && Date.parse(updated) < Date.parse(card.createTime)) throw new Error('刷新时间不能早于创建时间');
    const formats = Object.keys(card.files);
    if (formats.some(format => typeof content[format] !== 'string') || Object.keys(content).length !== formats.length) throw new Error('刷新内容必须覆盖卡片已登记的全部格式');
    const oldFiles = new Map();
    const replaced = [];
    const temps = [];
    const restore = () => {
      for (const target of replaced) {
        const original = oldFiles.get(target);
        if (original === null) fs.rmSync(target, { force: true });
        else fs.writeFileSync(target, original);
      }
    };
    try {
      for (const target of Object.values(card.files)) {
        oldFiles.set(target, fileExists(target) ? fs.readFileSync(target) : null);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const temp = `${target}.${randomUUID()}.tmp`;
        fs.writeFileSync(temp, content[path.extname(target).slice(1)], { flag: 'wx' });
        temps.push([temp, target]);
      }
      for (const [temp, target] of temps) {
        fs.renameSync(temp, target);
        replaced.push(target);
      }
    } catch (error) {
      try { restore(); }
      catch (restoreError) { error.message += `；恢复卡片文件失败：${restoreError.message}`; }
      throw error;
    } finally {
      for (const [temp] of temps) fs.rmSync(temp, { force: true });
    }
    setRollback(restore);
    const replacement = {
      ...card, title: metadata.title, summary: metadata.summary,
      ...(metadata.tags?.length ? { tags: metadata.tags } : { tags: undefined }),
      ...(metadata.source ? { source: metadata.source } : {}),
      updataTime: updated, enable: true,
    };
    if (replacement.tags === undefined) delete replacement.tags;
    if (replacement.source === undefined) delete replacement.source;
    return { ...current, cards: current.cards.map(item => item.id === card.id ? replacement : item) };
  });
  return next.cards.find(card => card.id.toLowerCase() === id.toLowerCase());
}

module.exports = { DEFAULT_TTL_DAYS, indexPath, validTime, validateIndex, readIndex, install, registerCard, renewCard, refreshCard, expiration, problems, syncStatus };
