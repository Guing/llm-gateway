-- Add model capability type fields
ALTER TABLE "Channel" ADD COLUMN "modelTypes" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "ModelRoute" ADD COLUMN "types" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "RequestLog" ADD COLUMN "modelTypes" TEXT NOT NULL DEFAULT '[]';
