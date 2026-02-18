import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { config } from "./config/env.js";
import { authMiddleware } from "./middleware/auth.js";
import { imageRoutes } from "./routes/image.routes.js";
import { containerRoutes } from "./routes/container.routes.js";
import type { ErrorResponse } from "./types/index.js";

const app = express();

// Middleware
app.use(express.json({ limit: "1mb" }));

// Health check (unauthenticated)
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Protected API routes
app.use("/api", authMiddleware);

// Image routes
app.use("/api/images", imageRoutes);

// Container routes
app.use("/api/containers", containerRoutes);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    code: "INTERNAL_ERROR",
  } satisfies ErrorResponse);
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({
    success: false,
    error: "An unexpected error occurred",
    code: "INTERNAL_ERROR",
  } satisfies ErrorResponse);
});

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

// Start server
app.listen(config.port, () => {
  const baseUrl = `http://localhost:${config.port}`;

  console.log(
    `\n${colors.bright}${colors.cyan}Docker Manager API${colors.reset} running on port ${colors.bright}${colors.green}${config.port}${colors.reset}\n`
  );
  console.log(`${colors.bright}Available Endpoints:${colors.reset}\n`);

  console.log(`${colors.bright}  Health Check:${colors.reset}`);
  console.log(
    `    ${colors.green}GET${colors.reset}  ${colors.cyan}${baseUrl}/health${colors.reset}\n`
  );

  console.log(`${colors.bright}  Pull Image:${colors.reset}`);
  console.log(
    `    ${colors.yellow}POST${colors.reset} ${colors.cyan}${baseUrl}/api/images/pull${colors.reset}`
  );
  console.log(
    `    ${colors.gray}Body:${colors.reset}   ${colors.magenta}{"image": "nginx:alpine"}${colors.reset}`
  );
  console.log(
    `    ${colors.gray}Header:${colors.reset} ${colors.magenta}Authorization: Bearer <AUTH_TOKEN>${colors.reset}\n`
  );

  console.log(`${colors.bright}  List Containers:${colors.reset}`);
  console.log(
    `    ${colors.yellow}POST${colors.reset} ${colors.cyan}${baseUrl}/api/containers/list${colors.reset}`
  );
  console.log(
    `    ${colors.gray}Body:${colors.reset}   ${colors.magenta}{"image": "nginx:alpine"}${colors.reset}`
  );
  console.log(
    `    ${colors.gray}Header:${colors.reset} ${colors.magenta}Authorization: Bearer <AUTH_TOKEN>${colors.reset}\n`
  );

  console.log(`${colors.bright}  Rebuild Container:${colors.reset}`);
  console.log(
    `    ${colors.yellow}POST${colors.reset} ${colors.cyan}${baseUrl}/api/containers/rebuild${colors.reset}`
  );
  console.log(
    `    ${colors.gray}Body:${colors.reset}   ${colors.magenta}{"container": "my-service-1"}${colors.reset}`
  );
  console.log(
    `    ${colors.gray}Header:${colors.reset} ${colors.magenta}Authorization: Bearer <AUTH_TOKEN>${colors.reset}\n`
  );

  console.log(
    `${colors.bright}  Rebuild Containers by Image:${colors.reset}`
  );
  console.log(
    `    ${colors.yellow}POST${colors.reset} ${colors.cyan}${baseUrl}/api/containers/rebuild-by-image${colors.reset}`
  );
  console.log(
    `    ${colors.gray}Body:${colors.reset}   ${colors.magenta}{"image": "nginx:alpine"}${colors.reset}`
  );
  console.log(
    `    ${colors.gray}Header:${colors.reset} ${colors.magenta}Authorization: Bearer <AUTH_TOKEN>${colors.reset}\n`
  );
});
