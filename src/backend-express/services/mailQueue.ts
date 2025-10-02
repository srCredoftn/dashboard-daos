import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { sendEmail } from "./txEmail";
import { logger } from "../utils/logger";

// Optional Mongo support
import mongoose, { type Document, type Schema } from "mongoose";
import { connectToDatabase } from "../config/database";

// lightweight id generator (no external deps)
function genId() {
  return `mj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

const DATA_DIR = path.join(__dirname, "..", "data");
const QUEUE_FILE = path.join(DATA_DIR, "mail-queue.json");

type MailJob = {
  id: string;
  to: string[];
  subject: string;
  body: string;
  type?: string | undefined;
  attempts: number;
  lastError?: string | null;
  createdAt: string;
  nextAttemptAt: number;
};

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 1000;

// Ensure data dir exists
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {}

// Mongoose schema & model (lazy init)
let MailJobModel: mongoose.Model<Document> | null = null;
function getMailJobModel() {
  if (MailJobModel) return MailJobModel;
  const schema = new mongoose.Schema(
    {
      id: { type: String, required: true, index: true, unique: true },
      to: { type: [String], required: true },
      subject: { type: String, required: true },
      body: { type: String, required: true },
      type: { type: String },
      attempts: { type: Number, default: 0 },
      lastError: { type: String, default: null },
      createdAt: { type: String, required: true },
      nextAttemptAt: { type: Number, required: true, index: true },
      processed: { type: Boolean, default: false, index: true },
      locked: { type: Boolean, default: false },
      failed: { type: Boolean, default: false },
    },
    { timestamps: false },
  );
  MailJobModel = mongoose.model("MailJob", schema);
  return MailJobModel;
}

function readQueueFile(): MailJob[] {
  try {
    if (!fs.existsSync(QUEUE_FILE)) return [];
    const raw = fs.readFileSync(QUEUE_FILE, "utf8");
    if (!raw) return [];
    const q = JSON.parse(raw) as MailJob[];
    return Array.isArray(q) ? q : [];
  } catch (e) {
    logger.warn("Failed to read mail queue file", "MAIL_QUEUE", {
      message: String((e as Error)?.message),
    });
    return [];
  }
}

function writeQueueFile(queue: MailJob[]) {
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), "utf8");
  } catch (e) {
    logger.error("Failed to write mail queue file", "MAIL_QUEUE", {
      message: String((e as Error)?.message),
    });
  }
}

const USE_MONGO = String(process.env.USE_MONGO || "").toLowerCase() === "true";

export async function enqueueMail(
  to: string | string[],
  subject: string,
  body: string,
  type?: string,
) {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [String(to)];
  if (recipients.length === 0) return null;
  const job: MailJob = {
    id: genId(),
    to: recipients,
    subject,
    body,
    type,
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
    nextAttemptAt: Date.now(),
  };

  if (USE_MONGO) {
    try {
      await connectToDatabase();
      const M = getMailJobModel();
      await M.create({
        ...job,
        processed: false,
        locked: false,
        failed: false,
      });
      // kick processing
      processQueue().catch((e) =>
        logger.warn("Queue process error (mongo)", "MAIL_QUEUE", {
          message: String((e as Error)?.message),
        }),
      );
      return job.id;
    } catch (e) {
      logger.warn(
        "Failed to enqueue mail in Mongo, falling back to file",
        "MAIL_QUEUE",
        { message: String((e as Error)?.message) },
      );
      // fall through to file fallback
    }
  }

  // File fallback
  const q = readQueueFile();
  q.push(job);
  writeQueueFile(q);
  // trigger background processing (non-blocking)
  processQueue().catch((e) =>
    logger.warn("Queue process error (file)", "MAIL_QUEUE", {
      message: String((e as Error)?.message),
    }),
  );
  return job.id;
}

export async function getQueue() {
  if (USE_MONGO) {
    try {
      await connectToDatabase();
      const M = getMailJobModel();
      const docs = await M.find().sort({ nextAttemptAt: 1 }).lean().exec();
      return docs.map((d: any) => ({
        id: d.id,
        to: d.to,
        subject: d.subject,
        body: d.body,
        type: d.type,
        attempts: d.attempts,
        lastError: d.lastError,
        createdAt: d.createdAt,
        nextAttemptAt: d.nextAttemptAt,
        processed: d.processed,
        failed: d.failed,
      }));
    } catch (e) {
      logger.warn(
        "Failed to read mail queue from Mongo, falling back to file",
        "MAIL_QUEUE",
        { message: String((e as Error)?.message) },
      );
      return readQueueFile();
    }
  }
  return readQueueFile();
}

let isProcessing = false;
export async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;
  try {
    const now = Date.now();

    if (USE_MONGO) {
      try {
        await connectToDatabase();
        const M = getMailJobModel();

        // Try to atomically fetch and lock one job ready for processing
        const doc = await M.findOneAndUpdate(
          {
            nextAttemptAt: { $lte: now },
            processed: false,
            failed: false,
            locked: false,
          },
          { $set: { locked: true } },
          { sort: { nextAttemptAt: 1 }, returnDocument: "after" as any },
        )
          .lean()
          .exec();

        if (!doc) return;

        const job = doc as any;
        try {
          await sendEmail(job.to, job.subject, job.body, job.type as any);
          // remove or mark processed
          // Save into logs for history before removing
          try {
            const LogModel =
              mongoose.models.MailJobLog ||
              mongoose.model(
                "MailJobLog",
                new mongoose.Schema({
                  id: String,
                  to: [String],
                  subject: String,
                  body: String,
                  type: String,
                  attempts: Number,
                  lastError: String,
                  createdAt: String,
                  processedAt: String,
                  status: String,
                }),
              );
            await LogModel.create({
              id: job.id,
              to: job.to,
              subject: job.subject,
              body: job.body,
              type: job.type,
              attempts: job.attempts || 0,
              lastError: job.lastError || null,
              createdAt: job.createdAt,
              processedAt: new Date().toISOString(),
              status: "sent",
            });
          } catch (e) {
            logger.warn("Failed to write mail job log (mongo)", "MAIL_QUEUE", {
              message: String((e as Error)?.message),
            });
          }
          await M.deleteOne({ id: job.id }).exec();
          logger.info(`Mail job sent (mongo): ${job.id}`, "MAIL_QUEUE", {
            toCount: (job.to || []).length,
          });
        } catch (e) {
          const errMsg = String((e as Error)?.message || e);
          const attempts = (job.attempts || 0) + 1;
          const delay = DEFAULT_BASE_DELAY_MS * Math.pow(2, attempts - 1);
          const nextAttemptAt = Date.now() + Math.min(delay, 60 * 60 * 1000);

          const update: any = {
            attempts,
            lastError: errMsg,
            nextAttemptAt,
            locked: false,
          };
          if (attempts >= DEFAULT_MAX_ATTEMPTS) {
            update.failed = true;
          }
          await M.updateOne({ id: job.id }, { $set: update }).exec();

          logger.error("Mail job failed (mongo)", "MAIL_QUEUE", {
            id: job.id,
            attempts,
            error: errMsg,
          });

          if (attempts >= DEFAULT_MAX_ATTEMPTS) {
            try {
              const LogModel =
                mongoose.models.MailJobLog ||
                mongoose.model(
                  "MailJobLog",
                  new mongoose.Schema({
                    id: String,
                    to: [String],
                    subject: String,
                    body: String,
                    type: String,
                    attempts: Number,
                    lastError: String,
                    createdAt: String,
                    processedAt: String,
                    status: String,
                  }),
                );
              await LogModel.create({
                id: job.id,
                to: job.to,
                subject: job.subject,
                body: job.body,
                type: job.type,
                attempts,
                lastError: errMsg,
                createdAt: job.createdAt,
                processedAt: new Date().toISOString(),
                status: "failed",
              });
            } catch (e) {
              logger.warn(
                "Failed to write mail job failure log (mongo)",
                "MAIL_QUEUE",
                { message: String((e as Error)?.message) },
              );
            }
            try {
              const { NotificationService } = await import(
                "./notificationService"
              );
              await NotificationService.add({
                type: "system",
                title: "Erreur d'envoi d'email",
                message: `Échec d'envoi d'email vers ${(job.to || []).length} destinataire(s). Voir logs.`,
                data: {
                  skipEmailMirror: true,
                  emailError: true,
                  jobId: job.id,
                  lastError: errMsg,
                },
                recipients: "all",
              });
            } catch (_) {
              logger.warn(
                "Failed to create system notification for mail job failure (mongo)",
                "MAIL_QUEUE",
              );
            }
          }
        }
      } catch (e) {
        logger.warn(
          "Mongo queue processing failed, skipping this cycle",
          "MAIL_QUEUE",
          { message: String((e as Error)?.message) },
        );
      }
      return;
    }

    // File-based processing (existing behaviour)
    let queue = readQueueFile();
    const LOG_FILE = path.join(DATA_DIR, "mail-queue-log.json");
    function readLogFile(): any[] {
      try {
        if (!fs.existsSync(LOG_FILE)) return [];
        const raw = fs.readFileSync(LOG_FILE, "utf8");
        if (!raw) return [];
        const q = JSON.parse(raw) as any[];
        return Array.isArray(q) ? q : [];
      } catch (e) {
        logger.warn("Failed to read mail queue log file", "MAIL_QUEUE", {
          message: String((e as Error)?.message),
        });
        return [];
      }
    }
    function appendLogFile(entry: any) {
      try {
        const logs = readLogFile();
        logs.unshift(entry);
        fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), "utf8");
      } catch (e) {
        logger.warn("Failed to append mail queue log file", "MAIL_QUEUE", {
          message: String((e as Error)?.message),
        });
      }
    }
    for (let i = 0; i < queue.length; i++) {
      const job = queue[i];
      if (job.nextAttemptAt > now) continue;
      try {
        await sendEmail(job.to, job.subject, job.body, job.type as any);
        // append success to log
        try {
          appendLogFile({
            id: job.id,
            to: job.to,
            subject: job.subject,
            body: job.body,
            type: job.type,
            attempts: job.attempts || 0,
            lastError: job.lastError || null,
            createdAt: job.createdAt,
            processedAt: new Date().toISOString(),
            status: "sent",
          });
        } catch (e) {
          logger.warn("Failed to write mail log (file)", "MAIL_QUEUE", {
            message: String((e as Error)?.message),
          });
        }
        queue = queue.filter((j) => j.id !== job.id);
        writeQueueFile(queue);
        logger.info(`Mail job sent: ${job.id}`, "MAIL_QUEUE", {
          toCount: job.to.length,
        });
      } catch (e) {
        const errMsg = String((e as Error)?.message || e);
        job.attempts = (job.attempts || 0) + 1;
        job.lastError = errMsg;
        const delay = DEFAULT_BASE_DELAY_MS * Math.pow(2, job.attempts - 1);
        job.nextAttemptAt = Date.now() + Math.min(delay, 60 * 60 * 1000);
        queue = queue.map((j) => (j.id === job.id ? job : j));
        writeQueueFile(queue);
        logger.error("Mail job failed", "MAIL_QUEUE", {
          id: job.id,
          attempts: job.attempts,
          error: errMsg,
        });
        if (job.attempts >= DEFAULT_MAX_ATTEMPTS) {
          try {
            appendLogFile({
              id: job.id,
              to: job.to,
              subject: job.subject,
              body: job.body,
              type: job.type,
              attempts: job.attempts,
              lastError: job.lastError,
              createdAt: job.createdAt,
              processedAt: new Date().toISOString(),
              status: "failed",
            });
          } catch (e) {
            logger.warn(
              "Failed to write mail failure log (file)",
              "MAIL_QUEUE",
              { message: String((e as Error)?.message) },
            );
          }
          try {
            const { NotificationService } = await import(
              "./notificationService"
            );
            await NotificationService.add({
              type: "system",
              title: "Erreur d'envoi d'email",
              message: `Échec d'envoi d'email vers ${job.to.length} destinataire(s). Voir logs.`,
              data: {
                skipEmailMirror: true,
                emailError: true,
                jobId: job.id,
                lastError: job.lastError,
              },
              recipients: "all",
            });
          } catch (_) {
            logger.warn(
              "Failed to create system notification for mail job failure",
              "MAIL_QUEUE",
            );
          }
        }
      }
    }
  } finally {
    isProcessing = false;
  }
}

// Background processor interval
setInterval(() => {
  processQueue().catch((e) =>
    logger.warn("processQueue interval error", "MAIL_QUEUE", {
      message: String((e as Error)?.message),
    }),
  );
}, 2000);

// Export helper to requeue a job by id (reset attempts)
export async function requeueJob(id: string) {
  if (USE_MONGO) {
    try {
      await connectToDatabase();
      const M = getMailJobModel();
      const doc = await M.findOne({ id }).exec();
      if (!doc) return false;
      await M.updateOne(
        { id },
        {
          $set: {
            attempts: 0,
            lastError: null,
            nextAttemptAt: Date.now(),
            failed: false,
          },
        },
      ).exec();
      processQueue().catch(() => {});
      return true;
    } catch (e) {
      logger.warn(
        "Failed to requeue job in Mongo, falling back to file",
        "MAIL_QUEUE",
        { message: String((e as Error)?.message) },
      );
    }
  }

  const q = readQueueFile();
  const job = q.find((j) => j.id === id);
  if (!job) return false;
  job.attempts = 0;
  job.lastError = null;
  job.nextAttemptAt = Date.now();
  writeQueueFile(q);
  processQueue().catch(() => {});
  return true;
}
