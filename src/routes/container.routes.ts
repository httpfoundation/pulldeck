import { Router, type Router as RouterType } from "express";
import {
  listContainersHandler,
  rebuildContainerHandler,
  rebuildContainersByImageHandler,
} from "../controllers/container.controller.js";

const router: RouterType = Router();

/**
 * POST /api/containers/list
 * List running containers that use a specific Docker image
 *
 * Request body: { "image": "nginx:alpine" }
 * Response: { "success": true, "image": "nginx:alpine", "containers": [...], "count": 1 }
 *
 * Note: Authentication is handled by authMiddleware applied at /api level in index.ts
 */
router.post("/list", listContainersHandler);

/**
 * POST /api/containers/rebuild
 * Rebuild a container that was started via docker-compose
 *
 * Request body: { "container": "my-app-container" }
 * Response: { "success": true, "container": "my-app-container", "status": "running", "message": "..." }
 *
 * Note: Authentication is handled by authMiddleware applied at /api level in index.ts
 */
router.post("/rebuild", rebuildContainerHandler);

/**
 * POST /api/containers/rebuild-by-image
 * Rebuild all containers (running and stopped) that use a specific Docker image
 *
 * Request body: { "image": "nginx:alpine" }
 * Response: { "success": true, "image": "nginx:alpine", "total": 3, "successful": 2, "failed": 1, "skipped": 0, "results": [...] }
 *
 * Note: Authentication is handled by authMiddleware applied at /api level in index.ts
 */
router.post("/rebuild-by-image", rebuildContainersByImageHandler);

export const containerRoutes = router;
