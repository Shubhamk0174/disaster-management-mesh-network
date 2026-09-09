import { Router } from "express";
import * as rescueRequestController from "../controllers/rescueRequest.controller.js";

const router = Router();

// POST /api/rescue-request  – store a new rescue request
router.post("/", rescueRequestController.create);

// GET  /api/rescue-request  – retrieve all rescue requests
router.get("/", rescueRequestController.getAll);

// PATCH /api/rescue-request/:id  – update status and/or notes
router.patch("/:id", rescueRequestController.update);

export default router;
