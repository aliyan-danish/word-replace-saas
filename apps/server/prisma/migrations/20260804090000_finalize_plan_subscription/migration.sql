-- AlterEnum
BEGIN;
CREATE TYPE "SubscriptionStatus_new" AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELED');
ALTER TABLE "Subscription" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Subscription" ALTER COLUMN "status" TYPE "SubscriptionStatus_new" USING ("status"::text::"SubscriptionStatus_new");
ALTER TYPE "SubscriptionStatus" RENAME TO "SubscriptionStatus_old";
ALTER TYPE "SubscriptionStatus_new" RENAME TO "SubscriptionStatus";
DROP TYPE "SubscriptionStatus_old";
ALTER TABLE "Subscription" ALTER COLUMN "status" SET DEFAULT 'TRIAL';
COMMIT;

-- AlterTable
ALTER TABLE "Plan" DROP COLUMN "durationDays",
DROP COLUMN "isTrial",
DROP COLUMN "priceCents",
ADD COLUMN     "maxFilesPerJob" INTEGER NOT NULL,
ADD COLUMN     "maxUploadBytes" INTEGER NOT NULL,
ADD COLUMN     "monthlyJobLimit" INTEGER;

-- AlterTable
ALTER TABLE "Subscription" ALTER COLUMN "status" SET DEFAULT 'TRIAL';
