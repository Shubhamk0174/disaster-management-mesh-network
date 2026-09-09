import type { Request, Response } from "express";
import * as rescueRequestService from "../services/rescueRequest.service.js";

// POST /api/rescue-request
export async function create(req: Request, res: Response): Promise<void> {
  const {
    receivedAt,
    originNode,
    location,
    deviceTimestamp,
    rssi,
    originRoot,
    finalRoot,
    hopCount,
    encryption,
    auth,
    status,
    notes,
  } = req.body as Record<string, unknown>;

  // --- Validation ---
  if (typeof receivedAt !== "string" || isNaN(Date.parse(receivedAt))) {
    res.status(400).json({ error: "receivedAt must be a valid ISO-8601 date string." });
    return;
  }
  if (typeof originNode !== "string" || originNode.trim() === "") {
    res.status(400).json({ error: "originNode must be a non-empty string." });
    return;
  }
  if (typeof location !== "string") {
    res.status(400).json({ error: "location must be a string." });
    return;
  }
  if (typeof deviceTimestamp !== "string") {
    res.status(400).json({ error: "deviceTimestamp must be a string." });
    return;
  }
  if (rssi !== null && rssi !== undefined && typeof rssi !== "number") {
    res.status(400).json({ error: "rssi must be a number or null." });
    return;
  }
  if (typeof originRoot !== "string") {
    res.status(400).json({ error: "originRoot must be a string." });
    return;
  }
  if (typeof finalRoot !== "string") {
    res.status(400).json({ error: "finalRoot must be a string." });
    return;
  }
  if (hopCount !== null && hopCount !== undefined && typeof hopCount !== "number") {
    res.status(400).json({ error: "hopCount must be a number or null." });
    return;
  }
  if (typeof encryption !== "string") {
    res.status(400).json({ error: "encryption must be a string." });
    return;
  }
  if (typeof auth !== "string") {
    res.status(400).json({ error: "auth must be a string." });
    return;
  }

  const validStatuses = ["unresolved", "solved", "unmarked"];
  const resolvedStatus = typeof status === "string" && validStatuses.includes(status) ? status : "unresolved";

  // --- Delegate to service ---
  try {
    const record = await rescueRequestService.createRescueRequest({
      receivedAt: new Date(receivedAt as string),
      originNode: (originNode as string).trim(),
      location: location as string,
      deviceTimestamp: deviceTimestamp as string,
      rssi: (rssi ?? null) as number | null,
      originRoot: originRoot as string,
      finalRoot: finalRoot as string,
      hopCount: (hopCount ?? null) as number | null,
      encryption: encryption as string,
      auth: auth as string,
      status: resolvedStatus,
      notes: typeof notes === "string" ? notes : "",
    });

    res.status(201).json(record);
  } catch (err) {
    console.error("[rescueRequest.controller] create error:", err);
    res.status(500).json({ error: "Failed to save rescue request." });
  }
}

// GET /api/rescue-request
export async function getAll(_req: Request, res: Response): Promise<void> {
  try {
    const records = await rescueRequestService.getAllRescueRequests();
    res.status(200).json(records);
  } catch (err) {
    console.error("[rescueRequest.controller] getAll error:", err);
    res.status(500).json({ error: "Failed to fetch rescue requests." });
  }
}

// PATCH /api/rescue-request/:id
export async function update(req: Request, res: Response): Promise<void> {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "id must be a valid integer." });
    return;
  }

  const { status, notes } = req.body as Record<string, unknown>;

  const validStatuses = ["unresolved", "solved", "unmarked"];
  const patch: { status?: string; notes?: string } = {};

  if (status !== undefined) {
    if (typeof status !== "string" || !validStatuses.includes(status)) {
      res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}.` });
      return;
    }
    patch.status = status;
  }

  if (notes !== undefined) {
    if (typeof notes !== "string") {
      res.status(400).json({ error: "notes must be a string." });
      return;
    }
    patch.notes = notes;
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "At least one of 'status' or 'notes' must be provided." });
    return;
  }

  try {
    const record = await rescueRequestService.updateRescueRequest(id, patch);
    res.status(200).json(record);
  } catch (err) {
    console.error("[rescueRequest.controller] update error:", err);
    res.status(500).json({ error: "Failed to update rescue request." });
  }
}
