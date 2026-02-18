import { Router, type Router as RouterType } from "express";
import { pullImageHandler } from "../controllers/image.controller.js";

const router: RouterType = Router();

/**
 * POST /api/images/pull
 * Pull a Docker image from registry
 *
 * Request body: { "image": "nginx:latest" }
 * Response: { "success": true, "image": "nginx", "tag": "latest", "digest": "sha256:..." }
 */
router.post("/pull", pullImageHandler);

export const imageRoutes = router;
