'use strict';
const fs = require('node:fs');

class ApiError extends Error {
  constructor(msg, status, body) { super(msg); this.status = status; this.body = body; }
}

async function request(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : {}; } catch { /* keep text */ }
  if (!res.ok) {
    const detail = typeof data === 'string' ? data.slice(0, 400)
      : (data.error?.message || data.error_description || data.message || data.detail || data.title ||
         (data.errors && JSON.stringify(data.errors).slice(0, 400)) || data.description ||
         (typeof data.error === 'string' ? data.error : JSON.stringify(data).slice(0, 400)));
    throw new ApiError(`${res.status} ${detail}`, res.status, data);
  }
  return { data, headers: res.headers, status: res.status };
}

async function json(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  let body = opts.body;
  if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob) && !Buffer.isBuffer(body) && !(body instanceof URLSearchParams)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  return (await request(url, { ...opts, headers, body })).data;
}

function fileBlob(m) {
  return new Blob([fs.readFileSync(m.path)], { type: m.mime });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const isVideo = m => m.mime.startsWith('video/');
const isImage = m => m.mime.startsWith('image/');

function requirePublicUrl(media, network) {
  for (const m of media) {
    if (!m.url || /localhost|127\.0\.0\.1|\[::1\]/.test(m.url)) {
      throw new Error(`${network} downloads media from a public URL. Set "Public URL" in Settings (e.g. a Cloudflare Tunnel address) so ${m.url || 'media'} is reachable from the internet.`);
    }
  }
}

module.exports = { ApiError, request, json, fileBlob, sleep, isVideo, isImage, requirePublicUrl };
