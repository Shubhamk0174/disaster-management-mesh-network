import { Router } from "express";
import * as nodeLocationController from "../controllers/nodeLocation.controller.js";

const router = Router();

// POST /api/node-location  – store a node's GPS location
router.post("/", nodeLocationController.create);

// GET  /api/node-location  – retrieve all stored locations
router.get("/", nodeLocationController.getAll);

export default router;
