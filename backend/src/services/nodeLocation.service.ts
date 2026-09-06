import { prisma } from "../lib/prisma.js";

export interface CreateNodeLocationInput {
  node_id: string;
  timestamp: Date;
  latitude: number;
  longitude: number;
}

export async function createNodeLocation(data: CreateNodeLocationInput) {
  return prisma.nodeLocation.create({ data });
}

export async function getAllNodeLocations() {
  return prisma.nodeLocation.findMany({
    orderBy: { createdAt: "desc" },
  });
}
