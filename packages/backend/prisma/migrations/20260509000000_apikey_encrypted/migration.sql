-- AlterTable: add encryptedKey column to ApiKey (default empty string for existing rows)
ALTER TABLE "ApiKey" ADD COLUMN "encryptedKey" TEXT NOT NULL DEFAULT '';
