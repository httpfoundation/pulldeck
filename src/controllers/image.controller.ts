import type { Request, Response } from "express";
import { dockerService, DockerError } from "../services/docker.service.js";
import { logRequest, logSuccess, logError, logRejection } from "../utils/logger.js";
import type { PullRequest, ErrorResponse } from "../types/index.js";

/**
 * Handle POST /api/images/pull
 * Pulls a Docker image from registry
 */
export async function pullImageHandler(
  req: Request<object, object, PullRequest>,
  res: Response
): Promise<void> {
  const { image } = req.body;

  // Validate request body
  if (!image || typeof image !== "string") {
    logRejection("/api/images/pull", "missing or invalid image parameter");
    res.status(400).json({
      success: false,
      error: "Image name is required",
      code: "INVALID_IMAGE",
    } satisfies ErrorResponse);
    return;
  }

  const trimmedImage = image.trim();
  if (!trimmedImage) {
    logRejection("/api/images/pull", "empty image name");
    res.status(400).json({
      success: false,
      error: "Image name cannot be empty",
      code: "INVALID_IMAGE",
    } satisfies ErrorResponse);
    return;
  }

  logRequest("POST", "/api/images/pull", `image=${trimmedImage}`);

  try {
    const result = await dockerService.pullImage(trimmedImage);
    logSuccess(
      "POST",
      "/api/images/pull",
      `tag=${result.tag}${result.digest ? `, digest=${result.digest.substring(0, 12)}...` : ""}`
    );
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof DockerError) {
      logError("POST", "/api/images/pull", error.code, error.message);
      res.status(error.statusCode).json({
        success: false,
        error: error.message,
        code: error.code,
      } satisfies ErrorResponse);
      return;
    }

    // Unexpected error
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logError("POST", "/api/images/pull", "INTERNAL_ERROR", errorMessage);
    res.status(500).json({
      success: false,
      error: "An unexpected error occurred",
      code: "INTERNAL_ERROR",
    } satisfies ErrorResponse);
  }
}
