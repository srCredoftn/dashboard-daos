import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { sendEmail } from "./txEmail";
import { logger } from "../utils/logger";

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

function readQueue(): MailJob[] {
  try {
    if (!fs.existsSync(QUEUE_FILE)) return [];
    const raw = fs.readFileSync(QUEUE_FILE, "utf8");
    if (!raw) return [];
    const q = JSON.parse(raw) as MailJob[];
    return Array.isArray(q) ? q : [];
  } catch (e) {
    logger.warn("Failed to read mail queue file", "MAIL_QUEUE", { message: String((e as Error)?.message) });
    return [];
  }
}

function writeQueue(queue: MailJob[]) {
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), "utf8");
  } catch (e) {
    logger.error("Failed to write mail queue file", "MAIL_QUEUE", { message: String((e as Error)?.message) });
  }
}

export async function enqueueMail(to: string | string[], subject: string, body: string, type?: string) {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [String(to)];
  if (recipients.length === 0) return null;
  const job: MailJob = {
    id: uuidv4(),
    to: recipients,
    subject,
    body,
    type,
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
    nextAttemptAt: Date.now(),
  };
  const q = readQueue();
  q.push(job);
  writeQueue(q);
  // trigger background processing (non-blocking)
  processQueue().catch((e) => logger.warn("Queue process error", "MAIL_QUEUE", { message: String((e as Error)?.message) }));
  return job.id;
}

export function getQueue() {
  return readQueue();
}

let isProcessing = false;
export async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;
  try {
    let queue = readQueue();
    const now = Date.now();
    // Only process jobs ready for attempt
    for (let i = 0; i < queue.length; i++) {
      const job = queue[i];
      if (job.nextAttemptAt > now) continue;
      try {
        // Attempt send
        await sendEmail(job.to, job.subject, job.body, job.type as any);
        // Remove job on success
        queue = queue.filter((j) => j.id !== job.id);
        writeQueue(queue);
        logger.info(`Mail job sent: ${job.id}`, "MAIL_QUEUE", { toCount: job.to.length });
      } catch (e) {
        const errMsg = String((e as Error)?.message || e);
        job.attempts = (job.attempts || 0) + 1;
        job.lastError = errMsg;
        // Exponential backoff
        const delay = DEFAULT_BASE_DELAY_MS * Math.pow(2, job.attempts - 1);
        job.nextAttemptAt = Date.now() + Math.min(delay, 60 * 60 * 1000); // cap 1h

        // Replace job
        queue = queue.map((j) => (j.id === job.id ? job : j));
        writeQueue(queue);

        logger.error("Mail job failed", "MAIL_QUEUE", { id: job.id, attempts: job.attempts, error: errMsg });

        if (job.attempts >= DEFAULT_MAX_ATTEMPTS) {
          // Final failure: create a system notification to surface to admins
          try {
            // dynamic import to avoid circular deps
            const { NotificationService } = await import("./notificationService");
            await NotificationService.add({
              type: "system",
              title: "Erreur d'envoi d'email",
              message: `Échec d'envoi d'email vers ${job.to.length} destinataire(s). Voir logs.`,
              data: { skipEmailMirror: true, emailError: true, jobId: job.id, lastError: job.lastError },
              recipients: "all",
            });
          } catch (_) {
            logger.warn("Failed to create system notification for mail job failure", "MAIL_QUEUE");
          }
          // keep job in queue but marked as failed (do not delete) so admin can inspect/retry
        }
      }
    }
  } finally {
    isProcessing = false;
  }
}

// Background processor interval
setInterval(() => {
  processQueue().catch((e) => logger.warn("processQueue interval error", "MAIL_QUEUE", { message: String((e as Error)?.message) }));
}, 2000);

// Export helper to requeue a job by id (reset attempts)
export function requeueJob(id: string) {
  const q = readQueue();
  const job = q.find((j) => j.id === id);
  if (!job) return false;
  job.attempts = 0;
  job.lastError = null;
  job.nextAttemptAt = Date.now();
  writeQueue(q);
  processQueue().catch(() => {});
  return true;
}
