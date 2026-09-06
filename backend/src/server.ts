import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";


const app = express();

app.use(helmet());

app.use(cors({
  origin: "*"
}));

app.use(express.json());


app.get("/", (req, res) => {
  res.send("Server is running!");
});





const PORT = process.env.PORT || 5500;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});