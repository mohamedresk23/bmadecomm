import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../../db';
import { withIsolatedTx, setupTestDb } from '../../test-utils/db';
import { writeAudit } from './audit';
import { auditEvents, migrationsTest } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { ApiError } from '../api/errors';
import { requirePermission, PolicyContext } from './policy';

describe('audit writer and DB permissions integration', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  it('writes an audit row successfully', async () => {
    await withIsolatedTx(async (tx) => {
      await writeAudit(tx, {
        actor: 'user1',
        action: 'UPDATE',
        resource: 'product/1',
        diff: { price: 100 },
        requestId: 'req-1'
      });

      const rows = await tx.select().from(auditEvents);
      expect(rows).toHaveLength(1);
      expect(rows[0].actor).toBe('user1');
      expect(rows[0].action).toBe('UPDATE');
      expect(rows[0].diff).toEqual({ price: 100 });
    });
  });

  it('denied request produces no side effects', async () => {
    await withIsolatedTx(async (tx) => {
      const ctx: PolicyContext = { user: { id: 'u1', roles: [], permissions: [] } };
      
      const operation = async () => {
        await tx.transaction(async (nested) => {
          await nested.insert(migrationsTest).values({ id: 'test-1' });
          requirePermission(ctx, 'write:test'); // fails closed
          await writeAudit(nested, {
            actor: 'u1',
            action: 'CREATE',
            resource: 'migrations_test/test-1'
          });
        });
      };

      await expect(operation()).rejects.toThrowError(ApiError);

      const audits = await tx.select().from(auditEvents);
      expect(audits).toHaveLength(0);
      
      const tests = await tx.select().from(migrationsTest);
      expect(tests).toHaveLength(0);
    });
  });

  it('blocks UPDATE and DELETE on audit_events table', async () => {
    await withIsolatedTx(async (tx) => {
      await writeAudit(tx, {
        actor: 'admin',
        action: 'CREATE',
        resource: 'order/1'
      });

      const rows = await tx.select().from(auditEvents);
      expect(rows).toHaveLength(1);
      const auditId = rows[0].id;

      await expect(
        tx.transaction(async (nested) => {
          await nested.update(auditEvents).set({ action: 'MODIFIED' }).where(eq(auditEvents.id, auditId));
        })
      ).rejects.toThrow();

      await expect(
        tx.transaction(async (nested) => {
          await nested.delete(auditEvents).where(eq(auditEvents.id, auditId));
        })
      ).rejects.toThrow();

      const afterRows = await tx.select().from(auditEvents).where(eq(auditEvents.id, auditId));
      expect(afterRows).toHaveLength(1);
      expect(afterRows[0].action).toBe('CREATE');
    });
  });
});

