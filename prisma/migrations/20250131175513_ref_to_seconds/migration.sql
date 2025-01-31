/*
  Warnings:

  - You are about to drop the column `isBalanceFrozen` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `perHoursLeft` on the `Account` table. All the data in the column will be lost.
  - You are about to alter the column `freeHoursLeft` on the `Account` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.

*/
-- AlterTable
ALTER TABLE "Account" DROP COLUMN "isBalanceFrozen",
DROP COLUMN "perHoursLeft",
ALTER COLUMN "freeHoursLeft" SET DEFAULT 108000,
ALTER COLUMN "freeHoursLeft" SET DATA TYPE INTEGER;
