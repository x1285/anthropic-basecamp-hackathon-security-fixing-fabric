-- AlterTable
ALTER TABLE "Repo" ADD COLUMN     "declared" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "lock" JSONB NOT NULL DEFAULT '{}';
