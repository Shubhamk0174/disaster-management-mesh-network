import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import apiRouter from "./routes/index.js";

const app = express();

// --- Middleware ---
app.use(helmet());
app.use(cors({ origin: "*" }));
app.use(express.json());

// --- Health check ---
app.get("/", (_req, res) => {
  res.json({ status: "ok", message: "Server is running!" });
});

// --- API routes ---
app.use("/api", apiRouter);

// --- Start ---
const PORT = process.env.PORT || 5500;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});