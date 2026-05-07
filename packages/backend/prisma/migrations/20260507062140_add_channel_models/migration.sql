-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Channel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'openai',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "models" TEXT NOT NULL DEFAULT '[]',
    "modelAliases" TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO "new_Channel" ("baseUrl", "createdAt", "enabled", "encryptedKey", "id", "name", "provider", "updatedAt") SELECT "baseUrl", "createdAt", "enabled", "encryptedKey", "id", "name", "provider", "updatedAt" FROM "Channel";
DROP TABLE "Channel";
ALTER TABLE "new_Channel" RENAME TO "Channel";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
