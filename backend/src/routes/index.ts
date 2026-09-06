import { Router } from "express";
import nodeLocationRouter from "./nodeLocation.routes.js";

const apiRouter = Router();

// Health check for the /api prefix
apiRouter.get("/", (_req, res) => {
  res.json({ status: "ok", message: "API is running" });
});

// Feature routers
apiRouter.use("/node-location", nodeLocationRouter);

// Future routers go here, e.g.:
// apiRouter.use("/rescue-alerts", rescueAlertsRouter);

export default apiRouter;
