#!/usr/bin/env tsx
import "dotenv/config";
import { createServer } from "../backend-express/index";

const app = createServer();
const PORT = Number(process.env.BACKEND_PORT || 3001);
app.listen(PORT, () => {
  console.log(`🚀 Backend server (backend alias) running on port ${PORT}`);
});
