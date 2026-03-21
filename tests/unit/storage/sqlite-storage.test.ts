import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SQLiteStorage } from '../../../src/storage/sqlite-storage.js';
import { createMessage, createMessages, resetFixtures } from '../../helpers/fixtures.js';

describe('SQLiteStorage', () => {
  let storage: SQLiteStorage;
  let tempDir: string;

  beforeEach(async () => {
    resetFixtures();
    tempDir = mkdtempSync(join(tmpdir(), 'rc-test-'));
    storage = new SQLiteStorage(join(tempDir, 'test.db'));
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('creates database and runs migrations', async () => {
      const sessions = await storage.getSessions();
      expect(sessions).toEqual([]);
    });

    it('is idempotent', async () => {
      // Calling initialize on an already-initialized DB should not throw
      const storage2 = new SQLiteStorage(join(tempDir, 'test.db'));
      await storage2.initialize();
      await storage2.close();
    });
  });

  describe('sessions', () => {
    it('creates and retrieves a session', async () => {
      await storage.ensureSession('s1');
      const session = await storage.getSession('s1');
      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe('s1');
      expect(session!.messageCount).toBe(0);
    });

    it('ensureSession is idempotent', async () => {
      await storage.ensureSession('s1');
      await storage.ensureSession('s1'); // should not throw
      const sessions = await storage.getSessions();
      expect(sessions).toHaveLength(1);
    });
  });

  describe('storeMessage / getMessages', () => {
    it('stores and retrieves messages', async () => {
      await storage.ensureSession('s1');
      const msg = createMessage({ sessionId: 's1', messageIndex: 0 });
      await storage.storeMessage(msg);

      const messages = await storage.getMessages('s1');
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe(msg.id);
      expect(messages[0].content).toBe(msg.content);
    });

    it('retrieves messages in range', async () => {
      await storage.ensureSession('s1');
      const msgs = createMessages(10, 's1');
      for (const msg of msgs) await storage.storeMessage(msg);

      const range = await storage.getMessages('s1', { start: 3, end: 7 });
      expect(range).toHaveLength(4);
      expect(range[0].messageIndex).toBe(3);
      expect(range[3].messageIndex).toBe(6);
    });

    it('updates session counters on store', async () => {
      await storage.ensureSession('s1');
      const msgs = createMessages(5, 's1');
      for (const msg of msgs) await storage.storeMessage(msg);

      const session = await storage.getSession('s1');
      expect(session!.messageCount).toBe(5);
      expect(session!.totalTokens).toBeGreaterThan(0);
    });

    it('stores metadata as JSON', async () => {
      await storage.ensureSession('s1');
      const msg = createMessage({
        sessionId: 's1',
        messageIndex: 0,
        metadata: { toolName: 'rc_grep', params: { pattern: 'test' } },
      });
      await storage.storeMessage(msg);

      const retrieved = await storage.getMessages('s1');
      expect(retrieved[0].metadata).toEqual({ toolName: 'rc_grep', params: { pattern: 'test' } });
    });
  });

  describe('getTailMessages', () => {
    it('returns last N messages in order', async () => {
      await storage.ensureSession('s1');
      const msgs = createMessages(20, 's1');
      for (const msg of msgs) await storage.storeMessage(msg);

      const tail = await storage.getTailMessages('s1', 5);
      expect(tail).toHaveLength(5);
      expect(tail[0].messageIndex).toBe(15);
      expect(tail[4].messageIndex).toBe(19);
    });
  });

  describe('getNextMessageIndex', () => {
    it('returns 0 for empty session', async () => {
      await storage.ensureSession('s1');
      const idx = await storage.getNextMessageIndex('s1');
      expect(idx).toBe(0);
    });

    it('returns next index after messages', async () => {
      await storage.ensureSession('s1');
      const msgs = createMessages(5, 's1');
      for (const msg of msgs) await storage.storeMessage(msg);

      const idx = await storage.getNextMessageIndex('s1');
      expect(idx).toBe(5);
    });
  });

  describe('fullTextSearch', () => {
    it('finds messages by content', async () => {
      await storage.ensureSession('s1');
      await storage.storeMessage(createMessage({ sessionId: 's1', messageIndex: 0, content: 'The authentication system uses JWT tokens' }));
      await storage.storeMessage(createMessage({ sessionId: 's1', messageIndex: 1, content: 'The database uses PostgreSQL' }));
      await storage.storeMessage(createMessage({ sessionId: 's1', messageIndex: 2, content: 'JWT refresh tokens expire after 7 days' }));

      const results = await storage.fullTextSearch('JWT', { sessionId: 's1' });
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.every(r => r.message.content.includes('JWT'))).toBe(true);
    });

    it('respects session scope', async () => {
      await storage.ensureSession('s1');
      await storage.ensureSession('s2');
      await storage.storeMessage(createMessage({ sessionId: 's1', messageIndex: 0, content: 'alpha bravo charlie' }));
      await storage.storeMessage(createMessage({ sessionId: 's2', messageIndex: 0, content: 'alpha delta echo' }));

      const scoped = await storage.fullTextSearch('alpha', { sessionId: 's1' });
      expect(scoped).toHaveLength(1);
      expect(scoped[0].message.sessionId).toBe('s1');

      const all = await storage.fullTextSearch('alpha', { scope: 'all' });
      expect(all).toHaveLength(2);
    });

    it('respects time filters', async () => {
      await storage.ensureSession('s1');
      const now = Date.now();
      await storage.storeMessage(createMessage({ sessionId: 's1', messageIndex: 0, content: 'old keyword message', timestamp: now - 100000 }));
      await storage.storeMessage(createMessage({ sessionId: 's1', messageIndex: 1, content: 'new keyword message', timestamp: now }));

      const results = await storage.fullTextSearch('keyword', { sessionId: 's1', since: now - 50000 });
      expect(results).toHaveLength(1);
      expect(results[0].message.content).toContain('new');
    });

    it('handles CJK characters via regex fallback', async () => {
      // FTS5 unicode61 tokenizes CJK characters individually, so multi-char CJK
      // queries should use regexSearch for accurate results
      await storage.ensureSession('s1');
      await storage.storeMessage(createMessage({ sessionId: 's1', messageIndex: 0, content: '这是一个关于认证系统的讨论' }));
      await storage.storeMessage(createMessage({ sessionId: 's1', messageIndex: 1, content: '数据库使用PostgreSQL' }));

      const results = await storage.regexSearch('认证', { sessionId: 's1' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].message.content).toContain('认证');
    });
  });

  describe('regexSearch', () => {
    it('finds messages by regex pattern', async () => {
      await storage.ensureSession('s1');
      await storage.storeMessage(createMessage({ sessionId: 's1', messageIndex: 0, content: 'Error: connection timeout at 14:30' }));
      await storage.storeMessage(createMessage({ sessionId: 's1', messageIndex: 1, content: 'Success: all tests passed' }));
      await storage.storeMessage(createMessage({ sessionId: 's1', messageIndex: 2, content: 'Error: disk full at 15:00' }));

      const results = await storage.regexSearch('Error:.*at \\d{2}:\\d{2}', { sessionId: 's1' });
      expect(results).toHaveLength(2);
    });
  });

  describe('getTimeline', () => {
    it('aggregates messages into time periods', async () => {
      await storage.ensureSession('s1');
      const now = Date.now();
      const hourMs = 3600000;

      // Messages in two different hours
      for (let i = 0; i < 5; i++) {
        await storage.storeMessage(createMessage({ sessionId: 's1', messageIndex: i, timestamp: now - hourMs + i * 1000 }));
      }
      for (let i = 5; i < 8; i++) {
        await storage.storeMessage(createMessage({ sessionId: 's1', messageIndex: i, timestamp: now + i * 1000 }));
      }

      const timeline = await storage.getTimeline('s1');
      expect(timeline.length).toBeGreaterThanOrEqual(1);
      const totalMsgs = timeline.reduce((sum, e) => sum + e.messageCount, 0);
      expect(totalMsgs).toBe(8);
    });
  });

  describe('cross-session', () => {
    it('searches across multiple sessions', async () => {
      await storage.ensureSession('s1');
      await storage.ensureSession('s2');
      await storage.storeMessage(createMessage({ sessionId: 's1', messageIndex: 0, content: 'Deploy the authentication service' }));
      await storage.storeMessage(createMessage({ sessionId: 's2', messageIndex: 0, content: 'Authentication failed for user' }));

      const results = await storage.getMessagesAcrossSessions('authentication');
      expect(results).toHaveLength(2);
      const sessionIds = results.map(r => r.message.sessionId);
      expect(sessionIds).toContain('s1');
      expect(sessionIds).toContain('s2');
    });
  });

  describe('bulk operations', () => {
    it('handles 1000 messages', async () => {
      await storage.ensureSession('s1');
      const msgs = createMessages(1000, 's1');
      for (const msg of msgs) await storage.storeMessage(msg);

      const count = await storage.getMessageCount('s1');
      expect(count).toBe(1000);

      const tail = await storage.getTailMessages('s1', 10);
      expect(tail).toHaveLength(10);
      expect(tail[9].messageIndex).toBe(999);
    });
  });

  describe('empty database edge cases', () => {
    it('getMessages returns empty for non-existent session', async () => {
      const msgs = await storage.getMessages('nonexistent');
      expect(msgs).toEqual([]);
    });

    it('getMessageCount returns 0 for non-existent session', async () => {
      const count = await storage.getMessageCount('nonexistent');
      expect(count).toBe(0);
    });

    it('fullTextSearch returns empty on no match', async () => {
      await storage.ensureSession('s1');
      const results = await storage.fullTextSearch('nonexistent_term_xyz', { sessionId: 's1' });
      expect(results).toEqual([]);
    });
  });
});
