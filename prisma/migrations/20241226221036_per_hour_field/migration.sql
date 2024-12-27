/*
  Warnings:

  - You are about to drop the column `freeHours` on the `Account` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Account" DROP COLUMN "freeHours",
ADD COLUMN     "freeHoursLeft" DOUBLE PRECISION NOT NULL DEFAULT 3,
ADD COLUMN     "perHoursLeft" DOUBLE PRECISION NOT NULL DEFAULT 0;
