const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Queue } = require('bullmq');

// Shared Redis connection settings for BOTH the Express app (which enqueues jobs) and
// the worker process (which consumes them). Passing a plain options object (rather than
// a pre-built ioredis instance) lets BullMQ create and correctly configure its own
// connections on each side — including the blocking connection the worker needs.
//
// Production/cloud (e.g. Upstash): set REDIS_URL to a full redis:// or rediss:// URL.
// BullMQ passes `url` to `new Redis(url, rest)`; ioredis enables TLS automatically when
// the scheme is rediss:// — no extra tls option is required.
//
// Local dev: leave REDIS_URL unset to keep the existing host/port behavior (Memurai on
// 127.0.0.1:6379, or REDIS_HOST / REDIS_PORT overrides).
const connection = process.env.REDIS_URL
  ? { url: process.env.REDIS_URL }
  : {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT) || 6379,
    };

const redisTarget = process.env.REDIS_URL
  ? process.env.REDIS_URL.split('@').pop()
  : `${connection.host}:${connection.port}`;
console.log(`[queue] redis target: ${redisTarget}`);

// One queue name, referenced by both producer and consumer so they never drift apart.
const REPLACE_QUEUE_NAME = 'replace-jobs';

// The producer-side Queue instance used by the Express app to enqueue replace jobs.
const replaceQueue = new Queue(REPLACE_QUEUE_NAME, { connection });

module.exports = { connection, REPLACE_QUEUE_NAME, replaceQueue };
