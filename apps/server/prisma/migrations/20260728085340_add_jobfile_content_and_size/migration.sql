/*
  Warnings:

  - Added the required column `content` to the `JobFile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `size` to the `JobFile` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Job" ALTER COLUMN "storagePath" DROP NOT NULL;

-- AlterTable
ALTER TABLE "JobFile" ADD COLUMN     "content" TEXT NOT NULL,
ADD COLUMN     "size" INTEGER NOT NULL;
