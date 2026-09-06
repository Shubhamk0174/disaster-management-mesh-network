-- CreateTable
CREATE TABLE "Expense" (
    "id" BIGSERIAL NOT NULL,
    "year" BIGINT NOT NULL,
    "month" TEXT,
    "expense" BIGINT,
    "user_id" UUID,
    "reason" TEXT,
    "date" BIGINT,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Income" (
    "id" BIGSERIAL NOT NULL,
    "year" BIGINT NOT NULL,
    "month" TEXT,
    "income" BIGINT,
    "user_id" UUID,
    "reason" TEXT,
    "date" BIGINT,

    CONSTRAINT "Income_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" BIGSERIAL NOT NULL,
    "mail" TEXT NOT NULL,
    "message" TEXT,
    "subject" TEXT,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rescue_alerts" (
    "id" BIGSERIAL NOT NULL,
    "message_id" TEXT,
    "origin_node_id" TEXT,
    "timestamp_ms" BIGINT,
    "path" JSONB,
    "location" JSONB,
    "address" TEXT,
    "message" TEXT,
    "received_at_rescue_node" TEXT,
    "received_at_server" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rescue_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeLocation" (
    "id" SERIAL NOT NULL,
    "node_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodeLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rescue_alerts_message_id_key" ON "rescue_alerts"("message_id");
