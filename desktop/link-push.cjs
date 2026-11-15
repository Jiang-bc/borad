'use strict';

async function pushLink(address, { token, channels }, send = fetch) {
  if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(address)) throw new Error('公网地址尚未就绪。');
  const deliveries = await Promise.all(channels.map(async channel => {
    try {
      const response = await send('https://www.pushplus.plus/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, channel, title: 'Borad 公网看板', content: address, template: 'txt' }),
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      return response.ok && (await response.json()).code === 200;
    } catch { return false; }
  }));
  return { sent: channels.filter((_channel, index) => deliveries[index]), failed: channels.filter((_channel, index) => !deliveries[index]) };
}

module.exports = { pushLink };
