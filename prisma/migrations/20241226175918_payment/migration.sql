-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "freeHours" DOUBLE PRECISION NOT NULL DEFAULT 3,
ADD COLUMN     "freeHoursStartDate" TIMESTAMP(3),
ADD COLUMN     "isBalanceFrozen" BOOLEAN NOT NULL DEFAULT false;
