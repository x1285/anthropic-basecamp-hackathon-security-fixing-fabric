-- CreateTable
CREATE TABLE "Environment" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slaCritical" INTEGER,
    "slaHigh" INTEGER,
    "slaMedium" INTEGER,
    "slaLow" INTEGER,
    "ticket" BOOLEAN NOT NULL,
    "slack" BOOLEAN NOT NULL,
    "channel" TEXT NOT NULL,
    "page" TEXT NOT NULL,

    CONSTRAINT "Environment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "slaCritical" INTEGER,
    "slaHigh" INTEGER,
    "slaMedium" INTEGER,
    "slaLow" INTEGER,
    "contact" TEXT NOT NULL,
    "notifyUnaffected" BOOLEAN NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectCustomer" (
    "projectId" TEXT NOT NULL,
    "envId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ProjectCustomer_pkey" PRIMARY KEY ("projectId","envId","customerId")
);

-- CreateTable
CREATE TABLE "Repo" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "ecosystem" TEXT NOT NULL,
    "watched" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "tests" TEXT NOT NULL,
    "deployed" JSONB NOT NULL,
    "releases" JSONB NOT NULL,

    CONSTRAINT "Repo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dep" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "direct" BOOLEAN NOT NULL,
    "via" TEXT NOT NULL,
    "env" JSONB NOT NULL,

    CONSTRAINT "Dep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL,
    "incidentId" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Run_firedAt_idx" ON "Run"("firedAt");

-- AddForeignKey
ALTER TABLE "ProjectCustomer" ADD CONSTRAINT "ProjectCustomer_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCustomer" ADD CONSTRAINT "ProjectCustomer_envId_fkey" FOREIGN KEY ("envId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCustomer" ADD CONSTRAINT "ProjectCustomer_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repo" ADD CONSTRAINT "Repo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dep" ADD CONSTRAINT "Dep_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
