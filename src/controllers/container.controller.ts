import type { Request, Response } from "express";
import { dockerService, DockerError } from "../services/docker.service.js";
import {
  logRequest,
  logSuccess,
  logError,
  logRejection,
} from "../utils/logger.js";
import type {
  ListContainersRequest,
  ErrorResponse,
  ListContainersResponse,
  RebuildContainerRequest,
  RebuildContainerResponse,
  RebuildContainersByImageRequest,
  RebuildContainersByImageResponse,
} from "../types/index.js";

/**
 * Handle POST /api/containers/list
 * Lists running containers that use a specific Docker image
 */
export async function listContainersHandler(
  req: Request<object, object, ListContainersRequest>,
  res: Response
): Promise<void> {
  const { image } = req.body;

  // Validate request body (T013)
  if (!image || typeof image !== "string") {
    logRejection("/api/containers/list", "missing or invalid image parameter");
    res.status(400).json({
      success: false,
      error: "Image name is required",
      code: "INVALID_IMAGE",
    } satisfies ErrorResponse);
    return;
  }

  const trimmedImage = image.trim();
  if (!trimmedImage) {
    logRejection("/api/containers/list", "empty image name");
    res.status(400).json({
      success: false,
      error: "Image name cannot be empty",
      code: "INVALID_IMAGE",
    } satisfies ErrorResponse);
    return;
  }

  logRequest("POST", "/api/containers/list", `image=${trimmedImage}`);

  try {
    // Call service method (T012)
    const result = await dockerService.listContainersByImage(trimmedImage);
    logSuccess(
      "POST",
      "/api/containers/list",
      `found ${result.count} container(s)`
    );
    res.status(200).json(result satisfies ListContainersResponse);
  } catch (error) {
    // Handle DockerError exceptions (T014)
    if (error instanceof DockerError) {
      logError(
        "POST",
        "/api/containers/list",
        error.code,
        error.message
      );
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
    logError(
      "POST",
      "/api/containers/list",
      "INTERNAL_ERROR",
      errorMessage
    );
    res.status(500).json({
      success: false,
      error: "An unexpected error occurred during container list operation",
      code: "INTERNAL_ERROR",
    } satisfies ErrorResponse);
  }
}

/**
 * Handle POST /api/containers/rebuild
 * Rebuilds a container that was started via docker-compose
 */
export async function rebuildContainerHandler(
  req: Request<object, object, RebuildContainerRequest>,
  res: Response
): Promise<void> {
  const { container } = req.body;

  // Validate request body
  if (!container || typeof container !== "string") {
    logRejection(
      "/api/containers/rebuild",
      "missing or invalid container parameter"
    );
    res.status(400).json({
      success: false,
      error: "Container identifier is required",
      code: "INVALID_CONTAINER",
    } satisfies ErrorResponse);
    return;
  }

  const trimmedContainer = container.trim();
  if (!trimmedContainer) {
    logRejection("/api/containers/rebuild", "empty container identifier");
    res.status(400).json({
      success: false,
      error: "Container identifier cannot be empty",
      code: "INVALID_CONTAINER",
    } satisfies ErrorResponse);
    return;
  }

  // Validate container identifier length (max 256 characters per data-model.md)
  if (trimmedContainer.length > 256) {
    logRejection("/api/containers/rebuild", "container identifier too long");
    res.status(400).json({
      success: false,
      error: "Container identifier exceeds maximum length (256 characters)",
      code: "INVALID_CONTAINER",
    } satisfies ErrorResponse);
    return;
  }

  logRequest("POST", "/api/containers/rebuild", `container=${trimmedContainer}`);

  try {
    // Call service method
    const result = await dockerService.rebuildContainer(trimmedContainer);
    logSuccess(
      "POST",
      "/api/containers/rebuild",
      `status=${result.status}`
    );
    res.status(200).json(result satisfies RebuildContainerResponse);
  } catch (error) {
    // Handle DockerError exceptions
    if (error instanceof DockerError) {
      logError(
        "POST",
        "/api/containers/rebuild",
        error.code,
        error.message
      );

      // Map error codes to HTTP status codes
      let statusCode = error.statusCode;
      if (error.code === "CONTAINER_NOT_FOUND") {
        statusCode = 404;
      } else if (
        error.code === "BUILD_FAILED" ||
        error.code === "COMPOSE_FILE_NOT_FOUND" ||
        error.code === "SERVICE_NOT_FOUND" ||
        error.code === "PERMISSION_DENIED"
      ) {
        statusCode = 500;
      } else if (error.code === "DOCKER_UNAVAILABLE") {
        statusCode = 503;
      }

      res.status(statusCode).json({
        success: false,
        error: error.message,
        code: error.code,
      } satisfies ErrorResponse);
      return;
    }

    // Unexpected error
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logError(
      "POST",
      "/api/containers/rebuild",
      "INTERNAL_ERROR",
      errorMessage
    );
    res.status(500).json({
      success: false,
      error: "An unexpected error occurred during container rebuild operation",
      code: "INTERNAL_ERROR",
    } satisfies ErrorResponse);
  }
}

/**
 * Handle POST /api/containers/rebuild-by-image
 * Rebuilds all containers (running and stopped) that use a specific Docker image
 */
export async function rebuildContainersByImageHandler(
  req: Request<object, object, RebuildContainersByImageRequest>,
  res: Response
): Promise<void> {
  const { image } = req.body;

  // Validate request body (T022)
  if (!image || typeof image !== "string") {
    logRejection(
      "/api/containers/rebuild-by-image",
      "missing or invalid image parameter"
    );
    res.status(400).json({
      success: false,
      error: "Image name is required",
      code: "INVALID_IMAGE",
    } satisfies ErrorResponse);
    return;
  }

  const trimmedImage = image.trim();
  if (!trimmedImage) {
    logRejection("/api/containers/rebuild-by-image", "empty image name");
    res.status(400).json({
      success: false,
      error: "Image name cannot be empty",
      code: "INVALID_IMAGE",
    } satisfies ErrorResponse);
    return;
  }

  // Validate image name length (max 256 characters per data-model.md)
  if (trimmedImage.length > 256) {
    logRejection(
      "/api/containers/rebuild-by-image",
      "image name too long"
    );
    res.status(400).json({
      success: false,
      error: "Image name exceeds maximum length (256 characters)",
      code: "INVALID_IMAGE",
    } satisfies ErrorResponse);
    return;
  }

  logRequest(
    "POST",
    "/api/containers/rebuild-by-image",
    `image=${trimmedImage}`
  );

  try {
    // Call service method
    const result = await dockerService.rebuildContainersByImage(trimmedImage);
    logSuccess(
      "POST",
      "/api/containers/rebuild-by-image",
      `${result.successful} successful, ${result.failed} failed, ${result.skipped} skipped`
    );
    res.status(200).json(result satisfies RebuildContainersByImageResponse);
  } catch (error) {
    // Handle DockerError exceptions (T023)
    if (error instanceof DockerError) {
      logError(
        "POST",
        "/api/containers/rebuild-by-image",
        error.code,
        error.message
      );

      // Map error codes to HTTP status codes
      let statusCode = error.statusCode;
      if (error.code === "INVALID_IMAGE") {
        statusCode = 400;
      } else if (error.code === "DOCKER_UNAVAILABLE") {
        statusCode = 503;
      } else {
        statusCode = 500;
      }

      res.status(statusCode).json({
        success: false,
        error: error.message,
        code: error.code,
      } satisfies ErrorResponse);
      return;
    }

    // Unexpected error
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logError(
      "POST",
      "/api/containers/rebuild-by-image",
      "INTERNAL_ERROR",
      errorMessage
    );
    res.status(500).json({
      success: false,
      error: "An unexpected error occurred during rebuild containers by image operation",
      code: "INTERNAL_ERROR",
    } satisfies ErrorResponse);
  }
}
