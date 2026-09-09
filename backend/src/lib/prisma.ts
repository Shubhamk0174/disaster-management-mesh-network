import "dotenv/config";

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
  ssl: {
    rejectUnauthorized: false, // Aiven uses a self-signed cert chain
  },
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });