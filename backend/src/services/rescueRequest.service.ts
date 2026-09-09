import { prisma } from "../lib/prisma.js";

export interface CreateRescueRequestInput {
  receivedAt: Date;
  originNode: string;
  location: string;
  deviceTimestamp: string;
  rssi: number | null;
  originRoot: string;
  finalRoot: string;
  hopCount: number | null;
  encryption: string;
  auth: string;
  status: string;
  notes: string;
}

export interface UpdateRescueRequestInput {
  status?: string;
  notes?: string;
}

export async function createRescueRequest(data: CreateRescueRequestInput) {
  return prisma.rescueRequest.create({ data });
}

export async function getAllRescueRequests() {
  return prisma.rescueRequest.findMany({
    orderBy: { receivedAt: "asc" },
  });
}

export async function updateRescueRequest(
  id: number,
  data: UpdateRescueRequestInput
) {
  return prisma.rescueRequest.update({
    where: { id },
    data,
  });
}
