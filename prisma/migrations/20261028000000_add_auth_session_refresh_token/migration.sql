-- AlterTable
ALTER TABLE "AuthSession" ADD COLUMN     "refreshTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_refreshTokenHash_key" ON "AuthSession"("refreshTokenHash");
