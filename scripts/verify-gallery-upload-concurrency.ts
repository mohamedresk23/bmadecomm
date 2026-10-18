import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import postgres from "postgres";
import sharp from "sharp";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/schema";
import { localDatabaseUrl } from "./local-database-config";
import { LocalFileSystemAdapter, storage } from "../src/lib/media/storage";
import { canonicalJson } from "../src/shared/idempotency/execute";
import { uploadGalleryImage } from "../src/modules/catalog/products/application/gallery-service";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

interface ChildResult {
  success: boolean;
  workerId: number;
  result?: {
    success: boolean;
    image: { id: string; position: number };
    gallery: { revision: string };
  };
  statusCode?: number;
  message?: string;
}

// -------------------------------------------------------------
// Child Worker Mode
// -------------------------------------------------------------
async function runChildWorker(args: string[]) {
  function getArg(name: string): string {
    const idx = args.indexOf(`--${name}`);
    if (idx === -1 || !args[idx + 1]) throw new Error(`Missing required argument --${name}`);
    return args[idx + 1];
  }

  const schemaName = getArg("schema");
  const productId = getArg("productId");
  const staffUserId = getArg("staffUserId");
  const key = getArg("key");
  const imagePath = getArg("imagePath");
  const workerId = Number(getArg("workerId"));
  const adapter = new LocalFileSystemAdapter(getArg("storageRoot"));
  storage.savePrivate = adapter.savePrivate.bind(adapter);
  storage.removePrivate = adapter.removePrivate.bind(adapter);
  storage.recordOrphan = adapter.recordOrphan.bind(adapter);

  const url = localDatabaseUrl();
  const client = postgres(url, {
    max: 2,
    connect_timeout: 5,
    onnotice: () => {},
    connection: { search_path: schemaName, statement_timeout: 15000, lock_timeout: 10000 },
  });
  const db = drizzle(client, { schema });

  try {
    const fileBytes = await fs.readFile(imagePath);
    const result = await uploadGalleryImage(db, {
      productId,
      staffUserId,
      requestId: `req_worker_${workerId}_${Date.now()}`,
      idempotencyKey: key,
      file: {
        name: "test.png",
        type: "image/png",
        buffer: fileBytes,
      },
    });

    const output: ChildResult = {
      success: true,
      workerId,
      result,
    };
    console.log(JSON.stringify(output));
    process.exitCode = 0;
  } catch (err: unknown) {
    console.error(`[Worker ${workerId} Error]`, err);
    const error = err as { statusCode?: number; message?: string };
    const output: ChildResult = {
      success: false,
      workerId,
      statusCode: error.statusCode || 500,
      message: error.message || String(err),
    };
    console.log(JSON.stringify(output));
    process.exitCode = error.statusCode === 422 ? 42 : 1;
  } finally {
    await client.end({ timeout: 5 });
  }
}

// -------------------------------------------------------------
// Parent Orchestrator
// -------------------------------------------------------------
async function runParent() {
  const isolated = `gallery_concurrency_${randomBytes(16).toString("hex")}`;
  const url = localDatabaseUrl();
  const admin = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} });
  let created = false;
  let tempImageDir: string | null = null;

  try {
    console.log(`[Concurrency Verification] Creating isolated schema ${isolated}...`);
    await admin.unsafe(`CREATE SCHEMA "${isolated}"`);
    created = true;

    const client = postgres(url, {
      max: 2,
      connect_timeout: 5,
      onnotice: () => {},
      connection: { search_path: isolated, statement_timeout: 15000, lock_timeout: 10000 },
    });

    try {
      console.log("[Concurrency Verification] Applying migrations 0000 through 0016 in isolated schema...");
      const journal = JSON.parse(await fs.readFile("src/db/migrations/meta/_journal.json", "utf8")) as {
        entries: { tag: string }[];
      };

      for (const entry of journal.entries) {
        assert.match(entry.tag, /^\d{4}_[a-z0-9_]+$/);
        const ddl = (await fs.readFile(`src/db/migrations/${entry.tag}.sql`, "utf8")).replaceAll(
          '"public".',
          `"${isolated}".`
        );
        for (const stmt of ddl.split("--> statement-breakpoint")) {
          if (stmt.trim()) await client.unsafe(stmt);
        }
      }

      // Ensure operation_keys table exists in isolated schema
      await client.unsafe(`
        CREATE TABLE IF NOT EXISTS "${isolated}"."operation_keys" (
          "id" text PRIMARY KEY NOT NULL,
          "actor" text NOT NULL,
          "operation" text NOT NULL,
          "key" text NOT NULL,
          "payload_hash" text NOT NULL,
          "result" jsonb,
          "completed_at" timestamp with time zone,
          "created_at" timestamp with time zone DEFAULT now() NOT NULL,
          CONSTRAINT "operation_keys_hash_check" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$'),
          CONSTRAINT "operation_keys_completion_check" CHECK ("completed_at" IS NOT NULL OR "result" IS NULL)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS "operation_keys_scope_uq" ON "${isolated}"."operation_keys" USING btree ("actor","operation","key");
      `);

      console.log("[Concurrency Verification] Seeding test staff user and draft product...");
      const staffUserId = randomUUID();
      const productId = `prd_conc_${randomUUID().slice(0, 8)}`;

      // Seed user and staff credentials
      await client`
        INSERT INTO users (id, email, role, name, phone, password_hash)
        VALUES (${staffUserId}, ${`staff_${staffUserId}@test.local`}, 'staff', 'Concurrency Staff', '01000000000', 'fixture')
      `;
      await client`
        INSERT INTO staff_accounts (user_id, enabled, mfa_enrolled_at, mfa_seed)
        VALUES (${staffUserId}, true, now(), 'seed_fixture')
      `;
      await client`INSERT INTO roles (key) VALUES ('catalog') ON CONFLICT DO NOTHING`;
      await client`INSERT INTO user_roles (user_id, role_key) VALUES (${staffUserId}, 'catalog')`;

      // Seed draft product
      await client`
        INSERT INTO products (id, name, status, media_revision)
        VALUES (${productId}, 'Draft Concurrency Product', 'draft', 0)
      `;

      // Create valid image file in temp directory
      tempImageDir = await fs.mkdtemp(path.join(os.tmpdir(), "conc-upload-"));
      const imagePath = path.join(tempImageDir, "sample.png");
      const imageBuffer = await sharp({
        create: { width: 32, height: 32, channels: 3, background: "green" },
      })
        .png()
        .toBuffer();
      await fs.writeFile(imagePath, imageBuffer);

      // Helper to spawn a child process
      function spawnChild(workerId: number, key: string): Promise<{ code: number | null; stdout: string; stderr: string; parsed: ChildResult | null }> {
        return new Promise((resolve) => {
          const proc = spawn(
            process.execPath,
            [
              path.resolve("node_modules/tsx/dist/cli.mjs"),
              "scripts/verify-gallery-upload-concurrency.ts",
              "--child",
              "--schema",
              isolated,
              "--productId",
              productId,
              "--staffUserId",
              staffUserId,
              "--key",
              key,
              "--imagePath",
              imagePath,
              "--storageRoot",
              tempImageDir!,
              "--workerId",
              String(workerId),
            ],
            { windowsHide: true }
          );

          let stdout = "";
          let stderr = "";
          proc.stdout.on("data", (d) => (stdout += d.toString()));
          proc.stderr.on("data", (d) => (stderr += d.toString()));

          proc.on("close", (code) => {
            let parsed: ChildResult | null = null;
            try {
              const lines = stdout.trim().split("\n");
              for (const line of lines) {
                if (line.startsWith("{") && line.endsWith("}")) {
                  parsed = JSON.parse(line);
                  break;
                }
              }
            } catch {}
            resolve({ code, stdout, stderr, parsed });
          });
        });
      }

      // ---------------------------------------------------------
      // TEST 1: Two Independent Node Processes with IDENTICAL Key
      // ---------------------------------------------------------
      console.log("\n--- TEST 1: Two Independent Node Processes Racing with Identical Idempotency Key ---");
      const sharedKey = `idemp_shared_${randomBytes(8).toString("hex")}`;
      console.log(`[Test 1] Spawning Worker 1 and Worker 2 concurrently with key: ${sharedKey}...`);

      const [res1, res2] = await Promise.all([spawnChild(1, sharedKey), spawnChild(2, sharedKey)]);

      console.log(`[Test 1] Worker 1 exit code: ${res1.code}, result:`, res1.parsed);
      console.log(`[Test 1] Worker 2 exit code: ${res2.code}, result:`, res2.parsed);

      assert.ok(res1.parsed?.success, `Worker 1 failed: ${res1.stderr || res1.stdout}`);
      assert.ok(res2.parsed?.success, `Worker 2 failed: ${res2.stderr || res2.stdout}`);

      // Both must return the exact same image attachment ID and position
      assert.equal(
        res1.parsed.result?.image.id,
        res2.parsed.result?.image.id,
        "Both workers must return the identical image ID"
      );
      assert.equal(
        res1.parsed.result?.image.position,
        res2.parsed.result?.image.position,
        "Both workers must return the identical sort position"
      );
      assert.equal(res1.parsed.result?.image.position, 0, "First image must be position 0");

      // Verify PostgreSQL state: exactly 1 attachment, 1 completed key, 1 audit event
      const [pmCount] = await client`SELECT count(*)::int AS count FROM product_media WHERE product_id = ${productId}`;
      assert.equal(pmCount.count, 1, "product_media must have exactly 1 row");

      const [opKey] = await client`
        SELECT key, completed_at, result
        FROM operation_keys
        WHERE actor = ${`staff:${staffUserId}`} AND key = ${sharedKey}
      `;
      assert.ok(opKey, "operation_keys record must exist");
      assert.ok(opKey.completed_at, "operation_keys completed_at must be populated");

      const [auditCount] = await client`
        SELECT count(*)::int AS count
        FROM audit_events
        WHERE resource = ${`product:${productId}`} AND action = 'catalog.product.image.attach'
      `;
      assert.equal(auditCount.count, 1, "Exactly 1 audit event must be committed");

      // Verify upload rate limit quota: exactly 1 attempt consumed
      const rateKey = createHash("sha256").update(JSON.stringify(["staff_upload", staffUserId])).digest("hex");
      const [bucket] = await client`SELECT attempts FROM upload_rate_buckets WHERE key = ${rateKey}`;
      assert.equal(bucket.attempts, 1, "Upload rate quota must be consumed exactly once (replay consumed 0)");

      console.log("[Test 1 PASS] Concurrency deduplication across independent Node processes verified successfully!");

      // Exercise stale-claim compare-and-swap across independent processes.
      const payloadHash = createHash("sha256").update(canonicalJson({fileBytesHash:createHash("sha256").update(imageBuffer).digest("hex"),filename:"test.png",mimeType:"image/png",size:imageBuffer.length})).digest("hex");
      const staleKey = "stale_" + randomUUID();
      await client`INSERT INTO operation_keys (id,actor,operation,key,payload_hash,created_at) VALUES (${randomUUID()},${`staff:${staffUserId}`},${`catalog.product.image.upload:${productId}`},${staleKey},${payloadHash},now()-interval '20 seconds')`;
      const reclaimed = await Promise.all([spawnChild(5,staleKey),spawnChild(6,staleKey)]);
      assert.ok(reclaimed.every(result=>result.parsed?.success),JSON.stringify(reclaimed));
      assert.equal(reclaimed[0].parsed?.result?.image.id,reclaimed[1].parsed?.result?.image.id);
      const [reclaimCount]=await client`SELECT count(*)::int AS count FROM product_media WHERE product_id=${productId}`;
      assert.equal(reclaimCount.count,2,"Competing stale claims attach exactly once");
      const [reclaimBucket]=await client`SELECT attempts FROM upload_rate_buckets WHERE key=${rateKey}`;
      assert.equal(reclaimBucket.attempts,2,"Only winning reclaim consumes quota");
      // Remove reclaimed attachment while retaining its private media/history.
      await client`UPDATE product_media SET removed_at=now(),sort_order=999 WHERE id=${reclaimed[0].parsed!.result!.image.id}`;
      console.log("[Reclaim PASS] Competing stale claims deduplicate; removed high position retained for append regression.");

      // Lose the response while an independent transaction still owns both
      // product/key locks; the recovery probe must wait or time out safely.
      const database = drizzle(client, { schema });
      const adapter = new LocalFileSystemAdapter(tempImageDir!);
      storage.savePrivate = adapter.savePrivate.bind(adapter);
      storage.removePrivate = adapter.removePrivate.bind(adapter);
      storage.recordOrphan = adapter.recordOrphan.bind(adapter);
      for (const timeout of [false, true]) {
        const heldProduct = "held_" + randomUUID();
        await client`INSERT INTO products (id,name,status) VALUES (${heldProduct},'Held commit fixture','draft')`;
        let release!: () => void;
        let entered!: () => void;
        let loseResponse!: (error: Error) => void;
        let staged = false;
        let injected = false;
        let filename = "";
        const enteredGate = new Promise<void>(resolve => { entered = resolve; });
        const releaseGate = new Promise<void>(resolve => { release = resolve; });
        const lostResponse = new Promise<never>((_, reject) => { loseResponse = reject; });
        let original: Promise<unknown> = Promise.resolve();
        storage.savePrivate = async (key, bytes, metadata) => { await adapter.savePrivate(key, bytes, metadata); filename = key; staged = true; };
        const context = new Proxy(database, { get(target, property, receiver) {
          if (property !== "transaction") return Reflect.get(target, property, receiver);
          return async (callback: Parameters<typeof database.transaction>[0]) => {
            if (injected) return database.transaction(callback);
            const pending = database.transaction(async tx => {
              const result = await callback(tx);
              if (staged && !injected) { injected = true; entered(); loseResponse(new Error("COMMIT response lost while transaction unresolved")); await releaseGate; }
              return result;
            });
            original = pending;
            return Promise.race([pending, lostResponse]);
          };
        }});
        const input = { productId: heldProduct, staffUserId, requestId: "held-recovery-" + timeout, idempotencyKey: randomUUID(), file: { name: "test.png", type: "image/png", buffer: imageBuffer } };
        const upload = uploadGalleryImage(context, input).then(result => ({ result, error: null }), error => ({ result: null, error }));
        await enteredGate;
        assert.ok((await adapter.readPrivate(filename)).length > 0, "Bytes survive while original transaction owns locks");
        if (timeout) {
          const unresolved = await upload;
          assert.equal(unresolved.error?.statusCode, 503, "Bounded recovery returns safe failure on held lock");
          assert.ok((await adapter.readPrivate(filename)).length > 0, "Recovery timeout preserves bytes");
          const [lease] = await client`SELECT id FROM operation_keys WHERE key=${input.idempotencyKey}`;
          assert.ok(lease, "Recovery timeout preserves reservation");
        } else {
          await new Promise(resolve => setTimeout(resolve, 100));
          assert.ok((await adapter.readPrivate(filename)).length > 0, "Recovery cannot delete bytes before original resolves");
        }
        release(); await original;
        const outcome = await upload;
        if (!timeout) assert.equal(outcome.result?.success, true, "Recovery waits for original commit and returns result");
        assert.ok((await adapter.readPrivate(filename)).length > 0, "Committed bytes remain readable");
        const replay = await uploadGalleryImage(database, input);
        assert.equal(replay.success, true);
        const [counts] = await client`SELECT count(*)::int AS count FROM product_media WHERE product_id=${heldProduct}`;
        assert.equal(counts.count, 1, "Held original/recovery/replay attach exactly once");
      }
      console.log("[Recovery PASS] Independent held transaction: waiting resolution and lock-timeout preserve committed bytes and lease.");

      // A healthy decode has finished, so lease renewal has stopped. Hold the
      // product lock long enough for a duplicate to reclaim that waiting lease.
      const longProduct = "long_lock_" + randomUUID();
      const longKey = randomUUID();
      await client`INSERT INTO products (id,name,status) VALUES (${longProduct},'Long product lock fixture','draft')`;
      const appPrefix = "long_lock_" + randomBytes(6).toString("hex");
      const longConnection = (name: string) => postgres(url, {
        max: 2, connect_timeout: 5, onnotice: () => {},
        connection: { search_path: isolated, statement_timeout: 60000, lock_timeout: 60000, application_name: name },
      });
      const locker = longConnection(appPrefix + "_locker");
      const uploaderA = longConnection(appPrefix + "_a");
      const uploaderB = longConnection(appPrefix + "_b");
      const previousStorage = { savePrivate: storage.savePrivate, removePrivate: storage.removePrivate, recordOrphan: storage.recordOrphan };
      storage.savePrivate = adapter.savePrivate.bind(adapter);
      storage.removePrivate = adapter.removePrivate.bind(adapter);
      storage.recordOrphan = adapter.recordOrphan.bind(adapter);
      let releaseProduct!: () => void;
      let productLocked!: () => void;
      const releaseProductGate = new Promise<void>(resolve => { releaseProduct = resolve; });
      const productLockedGate = new Promise<void>(resolve => { productLocked = resolve; });
      let heldProductTx: Promise<unknown> = Promise.resolve();
      let lockerPid = 0;
      type UploadOutcome = { result: Awaited<ReturnType<typeof uploadGalleryImage>> | null; error: { statusCode?: number; message?: string } | null };
      const uploads: Promise<UploadOutcome>[] = [];
      const startUpload = (connection: typeof uploaderA) => {
        const pending = uploadGalleryImage(drizzle(connection, { schema }), {
          productId: longProduct, staffUserId, requestId: "long-lock-" + randomUUID(), idempotencyKey: longKey,
          file: { name: "test.png", type: "image/png", buffer: imageBuffer },
        }).then(result => ({ result, error: null }), error => ({ result: null, error }));
        uploads.push(pending);
        return pending;
      };
      const observesProductLock = async (applicationName: string) => {
        const [waiting] = await client`WITH RECURSIVE blocking(pid,chain) AS (
          SELECT pid,ARRAY[pid] FROM pg_stat_activity
          WHERE application_name=${applicationName} AND wait_event_type='Lock' AND query LIKE '%products%'
          UNION ALL
          SELECT blocker,chain || blocker FROM blocking
          CROSS JOIN LATERAL unnest(pg_blocking_pids(blocking.pid)) AS blockers(blocker)
          WHERE NOT blocker=ANY(chain)
        ) SELECT count(*)::int AS count FROM blocking WHERE pid=${lockerPid}`;
        return waiting.count > 0;
      };
      const waitForProductLock = async (applicationName: string) => {
        const deadline = performance.now() + 20_000;
        while (performance.now() < deadline) {
          if (await observesProductLock(applicationName)) return;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error("Upload never reached the observed product lock wait: " + applicationName);
      };
      try {
        const [quotaBefore] = await client`SELECT attempts FROM upload_rate_buckets WHERE key=${rateKey}`;
        const privateDir = path.join(tempImageDir!, "storage", "private");
        const filesBefore = new Set(await fs.readdir(privateDir));
        heldProductTx = locker.begin(async tx => {
          const [session] = await tx`SELECT pg_backend_pid() AS pid`;
          lockerPid = session.pid;
          await tx`SELECT id FROM products WHERE id=${longProduct} FOR UPDATE`;
          productLocked();
          await releaseProductGate;
        });
        // Also observe early locker failure instead of waiting forever on a gate.
        await Promise.race([productLockedGate, heldProductTx.then(() => { throw new Error("Product lock released before the test gate"); })]);
        const original = startUpload(uploaderA);
        await waitForProductLock(appPrefix + "_a");
        const [originalLease] = await client`SELECT id FROM operation_keys WHERE actor=${`staff:${staffUserId}`} AND operation=${`catalog.product.image.upload:${longProduct}`} AND key=${longKey}`;
        assert.ok(originalLease, "Waiting original owns a reservation");
        const waitStarted = performance.now();
        await new Promise(resolve => setTimeout(resolve, 15_300));
        const duplicate = startUpload(uploaderB);
        await waitForProductLock(appPrefix + "_b");
        const [replacement] = await client`SELECT id,completed_at FROM operation_keys WHERE actor=${`staff:${staffUserId}`} AND operation=${`catalog.product.image.upload:${longProduct}`} AND key=${longKey}`;
        assert.notEqual(replacement.id, originalLease.id, "Duplicate reclaims the expired original lease while product stays locked");
        assert.equal(replacement.completed_at, null);
        assert.ok(await observesProductLock(appPrefix + "_a"), "Original still waits on the intended locker after replacement");
        assert.ok(await observesProductLock(appPrefix + "_b"), "Replacement also waits on the intended lock chain");
        assert.deepEqual(new Set(await fs.readdir(privateDir)), filesBefore, "Neither waiting worker stages bytes before product/key checks");
        const heldMs = performance.now() - waitStarted;
        assert.ok(heldMs >= 15_000, "Original must wait more than fifteen real seconds");
        releaseProduct();
        await heldProductTx;
        const [originalOutcome, duplicateOutcome] = await Promise.all([original, duplicate]);
        assert.equal(originalOutcome.error?.statusCode, 409, "Original is fenced after lease replacement");
        assert.match(originalOutcome.error?.message ?? "", /lease lost/);
        assert.equal(duplicateOutcome.result?.success, true, "Replacement commits successfully");
        const readState = async () => {
          const [state] = await client`SELECT media_revision::text AS revision,
            (SELECT count(*)::int FROM product_media WHERE product_id=${longProduct}) AS attachments,
            (SELECT count(*)::int FROM audit_events WHERE resource=${`product:${longProduct}`} AND action='catalog.product.image.attach') AS audits
            FROM products WHERE id=${longProduct}`;
          return state;
        };
        const state = await readState();
        assert.deepEqual(state, { revision: "1", attachments: 1, audits: 1 });
        const [quotaAfter] = await client`SELECT attempts FROM upload_rate_buckets WHERE key=${rateKey}`;
        assert.equal(quotaAfter.attempts - quotaBefore.attempts, 2, "Each owner consumes an attempt, including the fenced original");
        const [savedMedia] = await client`SELECT m.filename FROM media m JOIN product_media pm ON pm.media_id=m.id WHERE pm.product_id=${longProduct}`;
        const savedBytes = await adapter.readPrivate(savedMedia.filename);
        assert.ok(savedBytes.length > 0);
        const addedFiles = (await fs.readdir(privateDir)).filter(filename => !filesBefore.has(filename));
        assert.deepEqual(addedFiles, [savedMedia.filename], "Only the winning private file remains");
        const replay = await uploadGalleryImage(drizzle(uploaderA, { schema }), {
          productId: longProduct, staffUserId, requestId: "long-lock-replay", idempotencyKey: longKey,
          file: { name: "test.png", type: "image/png", buffer: imageBuffer },
        });
        assert.deepEqual(replay, duplicateOutcome.result, "Replay returns the complete winning response");
        const [quotaReplay] = await client`SELECT attempts FROM upload_rate_buckets WHERE key=${rateKey}`;
        assert.equal(quotaReplay.attempts, quotaAfter.attempts, "Replay does not consume a third attempt");
        assert.deepEqual(await readState(), state, "Replay leaves attachment, revision and audit counts unchanged");
        assert.deepEqual((await fs.readdir(privateDir)).filter(filename => !filesBefore.has(filename)), [savedMedia.filename], "Replay creates no extra private file");
        assert.deepEqual(await adapter.readPrivate(savedMedia.filename), savedBytes, "Replay preserves winning bytes");
        console.log("[Long product lock PASS]", { heldMs: Math.round(heldMs), originalStatus: 409, replacement: "success", attachments: 1, audits: 1, revision: "1", quotaDelta: 2, replay: "same image" });
      } finally {
        releaseProduct();
        await Promise.allSettled([heldProductTx, ...uploads]);
        Object.assign(storage, previousStorage);
        await Promise.all([locker.end({ timeout: 5 }), uploaderA.end({ timeout: 5 }), uploaderB.end({ timeout: 5 })]);
      }

      // ---------------------------------------------------------
      // TEST 2: Slot 10 Capacity Race
      // ---------------------------------------------------------
      console.log("\n--- TEST 2: Slot 10 Capacity Race (Two Processes Racing for Slot 10) ---");
      console.log("[Test 2] Seeding gallery up to 9 active attachments (slots 0..8)...");

      // Seed 8 more attachments (positions 1 through 8)
      for (let i = 1; i <= 8; i++) {
        const fakeMediaId = `med_seed_${i}_${randomBytes(4).toString("hex")}`;
        const fakePimId = `pim_seed_${i}_${randomBytes(4).toString("hex")}`;
        await client`
          INSERT INTO media (id, filename, mime_type, size, status)
          VALUES (${fakeMediaId}, ${`${fakeMediaId}.png`}, 'image/png', 1024, 'pending')
        `;
        await client`
          INSERT INTO product_media (id, product_id, media_id, sort_order, alt_text)
          VALUES (${fakePimId}, ${productId}, ${fakeMediaId}, ${i}, ${`Seed image ${i}`})
        `;
      }
      await client`UPDATE products SET media_revision = 9 WHERE id = ${productId}`;

      const [preRaceCount] = await client`SELECT count(*)::int AS count FROM product_media WHERE product_id = ${productId} AND removed_at IS NULL`;
      assert.equal(preRaceCount.count, 9, "Product must currently have exactly 9 active attachments");

      const keyRaceA = `key_race_A_${randomBytes(8).toString("hex")}`;
      const keyRaceB = `key_race_B_${randomBytes(8).toString("hex")}`;
      console.log(`[Test 2] Spawning Worker 3 (${keyRaceA}) and Worker 4 (${keyRaceB}) racing for the 10th slot...`);

      const [raceRes1, raceRes2] = await Promise.all([spawnChild(3, keyRaceA), spawnChild(4, keyRaceB)]);

      console.log(`[Test 2] Worker 3: exitCode=${raceRes1.code}, result:`, raceRes1.parsed);
      console.log(`[Test 2] Worker 4: exitCode=${raceRes2.code}, result:`, raceRes2.parsed);

      const winner = raceRes1.parsed?.success ? raceRes1 : raceRes2;
      const loser = raceRes1.parsed?.success ? raceRes2 : raceRes1;

      assert.ok(winner.parsed?.success, "Exactly one worker must succeed");
      assert.equal(winner.parsed.result?.image.position, 9, "Winning image must be assigned position 9 (10th slot)");
      assert.ok(!loser.parsed?.success, "Losing worker must fail");
      assert.equal(loser.parsed?.statusCode, 422, "Losing worker must receive 422 Unprocessable Entity");
      assert.ok(
        loser.parsed?.message?.includes("cannot exceed 10 active images"),
        "Error message must specify capacity limit"
      );

      // Verify PostgreSQL state: strictly 10 active attachments, never 11
      const [finalCount] = await client`
        SELECT count(*)::int AS count
        FROM product_media
        WHERE product_id = ${productId} AND removed_at IS NULL
      `;
      assert.equal(finalCount.count, 10, "Total active attachments in PostgreSQL must be strictly 10");

      console.log("[Test 2 PASS] Capacity race condition enforced: exactly 10 images active in PostgreSQL!");
      console.log("\n=======================================================");
      console.log("  ALL REAL POSTGRESQL CONCURRENCY CHECKS PASSED (EXIT 0)");
      console.log("=======================================================\n");
    } finally {
      await client.end({ timeout: 5 });
    }
  } finally {
    if (created) {
      console.log(`[Concurrency Verification] Dropping isolated schema "${isolated}"...`);
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${isolated}" CASCADE`);
      console.log(`[Concurrency Verification] Isolated schema dropped cleanly.`);
    }
    await admin.end({ timeout: 5 });

    if (tempImageDir) {
      await fs.rm(tempImageDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// -------------------------------------------------------------
// Entry Point Dispatcher
// -------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--child")) {
    await runChildWorker(args);
  } else {
    await runParent();
  }
}

main().catch((err) => {
  console.error("\n[FATAL ERROR] Concurrency verification failed:", err);
  process.exit(1);
});
