import type { Request, Response } from "express";
import * as nodeLocationService from "../services/nodeLocation.service.js";

// POST /api/node-location
export async function create(req: Request, res: Response): Promise<void> {
  const { node_id, timestamp, latitude, longitude } = req.body as {
    node_id: unknown;
    timestamp: unknown;
    latitude: unknown;
    longitude: unknown;
  };

  // --- Validation ---
  if (typeof node_id !== "string" || node_id.trim() === "") {
    res.status(400).json({ error: "node_id must be a non-empty string." });
    return;
  }

  if (typeof timestamp !== "string" || isNaN(Date.parse(timestamp))) {
    res
      .status(400)
      .json({ error: "timestamp must be a valid ISO-8601 date string." });
    return;
  }

  if (typeof latitude !== "number" || isNaN(latitude)) {
    res.status(400).json({ error: "latitude must be a number." });
    return;
  }

  if (typeof longitude !== "number" || isNaN(longitude)) {
    res.status(400).json({ error: "longitude must be a number." });
    return;
  }

  // --- Delegate to service ---
  try {
    const record = await nodeLocationService.createNodeLocation({
      node_id: node_id.trim(),
      timestamp: new Date(timestamp),
      latitude,
      longitude,
    });

    res.status(201).json(record);
  } catch (err) {
    console.error("[nodeLocation.controller] create error:", err);
    res.status(500).json({ error: "Failed to save node location." });
  }
}

// GET /api/node-location
export async function getAll(_req: Request, res: Response): Promise<void> {
  try {
    const records = await nodeLocationService.getAllNodeLocations();
    res.status(200).json(records);
  } catch (err) {
    console.error("[nodeLocation.controller] getAll error:", err);
    res.status(500).json({ error: "Failed to fetch node locations." });
  }
}
