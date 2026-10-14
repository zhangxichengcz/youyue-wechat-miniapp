PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL, location TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  senderId TEXT NOT NULL, senderName TEXT NOT NULL,
  recipientId TEXT NOT NULL DEFAULT '', recipientName TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','cancelled','declined')),
  startAt INTEGER NOT NULL, endAt INTEGER NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, scheduleRevision INTEGER NOT NULL DEFAULT 1,
  proposedStartAt INTEGER, proposedEndAt INTEGER, proposerId TEXT, token TEXT NOT NULL,
  CHECK (endAt > startAt), CHECK (recipientId = '' OR recipientId <> senderId)
);
CREATE INDEX IF NOT EXISTS bookings_sender ON bookings(senderId, createdAt DESC);
CREATE INDEX IF NOT EXISTS bookings_recipient ON bookings(recipientId, createdAt DESC);
CREATE INDEX IF NOT EXISTS bookings_sender_time ON bookings(senderId, status, startAt);
CREATE INDEX IF NOT EXISTS bookings_recipient_time ON bookings(recipientId, status, startAt);
CREATE TABLE IF NOT EXISTS reminders (
  bookingId TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('sender','recipient')),
  userId TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'none' CHECK(status IN ('none','pending','dispatching','sent','failed','uncertain','skipped','expired')),
  generation INTEGER NOT NULL DEFAULT 1,
  dueAt INTEGER NOT NULL, authorizedAt INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0, claim TEXT, claimedAt INTEGER, sentAt INTEGER, errorCode TEXT,
  PRIMARY KEY (bookingId, role)
);
CREATE INDEX IF NOT EXISTS reminders_due ON reminders(status, dueAt);
CREATE INDEX IF NOT EXISTS reminders_stale ON reminders(status, claimedAt);
CREATE TABLE IF NOT EXISTS service_tokens (id TEXT PRIMARY KEY, token TEXT NOT NULL, expiresAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits (id TEXT PRIMARY KEY, windowAt INTEGER NOT NULL, hits INTEGER NOT NULL);

/* 冲突检查与写入在同一条 SQLite 语句里进行，避免并发请求同时占用时间。 */
CREATE TRIGGER IF NOT EXISTS conflict_insert BEFORE INSERT ON bookings
WHEN NEW.status IN ('pending','confirmed') BEGIN
  SELECT RAISE(ABORT,'TIME_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM bookings b WHERE b.id <> NEW.id AND b.status IN ('pending','confirmed')
      AND b.startAt < NEW.endAt AND b.endAt > NEW.startAt
      AND (b.senderId = NEW.senderId OR b.recipientId = NEW.senderId)
  );
  SELECT RAISE(ABORT,'TOO_MANY_BOOKINGS') WHERE (
    SELECT COUNT(*) FROM bookings b WHERE b.id <> NEW.id AND b.status IN ('pending','confirmed')
      AND b.endAt > NEW.updatedAt AND (b.senderId = NEW.senderId OR b.recipientId = NEW.senderId)
  ) >= 100;
END;
CREATE TRIGGER IF NOT EXISTS conflict_update BEFORE UPDATE OF startAt,endAt,recipientId,status ON bookings
WHEN NEW.status IN ('pending','confirmed') BEGIN
  SELECT RAISE(ABORT,'TIME_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM bookings b WHERE b.id <> NEW.id AND b.status IN ('pending','confirmed')
      AND b.startAt < NEW.endAt AND b.endAt > NEW.startAt
      AND (b.senderId = NEW.senderId OR b.recipientId = NEW.senderId
        OR (NEW.recipientId <> '' AND (b.senderId = NEW.recipientId OR b.recipientId = NEW.recipientId)))
  );
  SELECT RAISE(ABORT,'TOO_MANY_BOOKINGS') WHERE NEW.recipientId <> '' AND (
    SELECT COUNT(*) FROM bookings b WHERE b.id <> NEW.id AND b.status IN ('pending','confirmed')
      AND b.endAt > NEW.updatedAt AND (b.senderId = NEW.recipientId OR b.recipientId = NEW.recipientId)
  ) >= 100;
END;
CREATE TRIGGER IF NOT EXISTS reminder_create AFTER INSERT ON bookings BEGIN
  INSERT INTO reminders (bookingId,role,userId,dueAt) VALUES(NEW.id,'sender',NEW.senderId,NEW.startAt-86400000);
  INSERT INTO reminders (bookingId,role,userId,dueAt) VALUES(NEW.id,'recipient',NEW.recipientId,NEW.startAt-86400000);
END;
CREATE TRIGGER IF NOT EXISTS reminder_recipient AFTER UPDATE OF recipientId ON bookings BEGIN
  UPDATE reminders SET userId=NEW.recipientId WHERE bookingId=NEW.id AND role='recipient';
END;
CREATE TRIGGER IF NOT EXISTS reminder_stop AFTER UPDATE OF status ON bookings
WHEN NEW.status IN ('cancelled','declined') BEGIN
  UPDATE reminders SET status='skipped' WHERE bookingId=NEW.id AND status='pending';
END;
CREATE TRIGGER IF NOT EXISTS reschedule_send_lock BEFORE UPDATE OF scheduleRevision ON bookings
WHEN NEW.scheduleRevision <> OLD.scheduleRevision BEGIN
  SELECT RAISE(ABORT,'REMINDER_SENDING') WHERE EXISTS (
    SELECT 1 FROM reminders WHERE bookingId=NEW.id AND status='dispatching'
  );
END;
CREATE TRIGGER IF NOT EXISTS reminder_reschedule AFTER UPDATE OF scheduleRevision ON bookings
WHEN NEW.scheduleRevision <> OLD.scheduleRevision BEGIN
  UPDATE reminders SET generation=NEW.scheduleRevision,
    status=CASE WHEN status='pending' THEN 'pending' ELSE 'none' END,
    dueAt=MAX(NEW.startAt-86400000,NEW.updatedAt), attempts=0,
    claim=NULL, claimedAt=NULL, sentAt=NULL, errorCode=NULL
    WHERE bookingId=NEW.id;
END;
