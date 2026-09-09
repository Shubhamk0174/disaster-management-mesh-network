-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE IF NOT EXISTS "NodeLocation" (
    "id" SERIAL NOT NULL,
    "node_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodeLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RescueRequest" (
    "id" SERIAL NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "originNode" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "deviceTimestamp" TEXT NOT NULL,
    "rssi" INTEGER,
    "originRoot" TEXT NOT NULL,
    "finalRoot" TEXT NOT NULL,
    "hopCount" INTEGER,
    "encryption" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unresolved',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RescueRequest_pkey" PRIMARY KEY ("id")
);
