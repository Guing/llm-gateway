-- Add advanced config field to ModelRoute
ALTER TABLE "ModelRoute" ADD COLUMN "config" TEXT NOT NULL DEFAULT '{}';
