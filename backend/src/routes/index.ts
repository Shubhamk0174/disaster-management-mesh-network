import { Router } from "express";
import nodeLocationRouter from "./nodeLocation.routes.js";
import rescueRequestRouter from "./rescueRequest.routes.js";

const apiRouter = Router();

// Health check for the /api prefix
apiRouter.get("/", (_req, res) => {
  res.json({ status: "ok", message: "API is running" });
});

// Feature routers
apiRouter.use("/node-location", nodeLocationRouter);
apiRouter.use("/rescue-request", rescueRequestRouter);

// Future routers go here, e.g.,:
// apiRouter.use("/other-feature", otherRouter);

export default apiRouter;
