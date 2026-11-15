'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function credentialsPath() {
  return path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE || process.env.HOME || '.', 'MagpieDashboard', 'credentials.json');
}

function createCredentialStore({ file, initialPassword }) {
  let record = null;
  let fallback = initialPassword;
  if (file) {
    try {
      record = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (record.algorithm !== 'scrypt' || !/^[0-9a-f]{32}$/.test(record.salt) || !/^[0-9a-f]{64}$/.test(record.hash)) throw new Error('Invalid credential file');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  function verify(password) {
    if (typeof password !== 'string' || password.length > 128) return false;
    if (!record) return crypto.timingSafeEqual(crypto.createHash('sha256').update(password).digest(), crypto.createHash('sha256').update(fallback).digest());
    return crypto.timingSafeEqual(crypto.scryptSync(password, Buffer.from(record.salt, 'hex'), 32), Buffer.from(record.hash, 'hex'));
  }
  function change(password) {
    const salt = crypto.randomBytes(16);
    const next = { algorithm: 'scrypt', salt: salt.toString('hex'), hash: crypto.scryptSync(password, salt, 32).toString('hex') };
    if (file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
      try {
        fs.writeFileSync(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, file);
      } catch (error) {
        try { fs.unlinkSync(temporary); } catch {}
        throw error;
      }
    }
    record = next;
    fallback = '';
  }
  return { verify, change };
}

module.exports = { createCredentialStore, credentialsPath };
