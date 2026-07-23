-- AlterTable
ALTER TABLE "AiConversation" ADD COLUMN "fileId" TEXT;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
