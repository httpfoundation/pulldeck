import Docker from "dockerode";
import { exec } from "child_process";
import { promisify } from "util";
import { config } from "../config/env.js";
import {
  logOperation,
  logOperationSuccess,
  logWarning,
} from "../utils/logger.js";
import type {
  PullResponse,
  ListContainersResponse,
  ContainerInfo,
  ErrorCode,
  RebuildContainerResponse,
  ContainerMetadata,
  RebuildContainersByImageResponse,
  ContainerRebuildResult,
} from "../types/index.js";

const execAsync = promisify(exec);

/**
 * Custom error class for Docker operations
 */
export class DockerError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public statusCode: number = 500,
  ) {
    super(message);
    this.name = "DockerError";
  }
}

/**
 * Image name validation regex
 * Supports: registry/repo:tag, repo:tag, repo (defaults to latest)
 */
const IMAGE_NAME_REGEX =
  /^(?:([a-z0-9.-]+(?::[0-9]+)?)\/)?((?:[a-z0-9._-]+\/)*[a-z0-9._-]+)(?::([a-zA-Z0-9._-]+))?$/;

/**
 * Validate Docker image name format
 */
export function validateImageName(imageName: string): boolean {
  if (!imageName || imageName.length > 256) {
    return false;
  }
  return IMAGE_NAME_REGEX.test(imageName);
}

/**
 * Parse image name into components
 */
export function parseImageName(imageName: string): {
  registry?: string;
  repository: string;
  tag: string;
} {
  const match = imageName.match(IMAGE_NAME_REGEX);
  if (!match) {
    throw new DockerError("Invalid image name format", "INVALID_IMAGE", 400);
  }

  const [, registry, repository, tag] = match;
  return {
    registry: registry || undefined,
    repository: repository,
    tag: tag || "latest",
  };
}

/**
 * Docker service for image operations
 * Wraps Dockerode with error handling and GHCR auth support
 */
export class DockerService {
  private docker: Docker;

  constructor() {
    // Connect to Docker daemon - use named pipe on Windows, socket on Linux
    const isWindows = process.platform === "win32";
    this.docker = new Docker(
      isWindows
        ? { socketPath: "//./pipe/docker_engine" }
        : { socketPath: "/var/run/docker.sock" },
    );
  }

  /**
   * Check if Docker daemon is available
   */
  async ping(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Pull a Docker image from registry
   * @param imageName Full image name (e.g., nginx:latest, ghcr.io/org/repo:tag)
   */
  async pullImage(imageName: string): Promise<PullResponse> {
    // Validate image name
    if (!validateImageName(imageName)) {
      throw new DockerError("Invalid image name format", "INVALID_IMAGE", 400);
    }

    const { registry, repository, tag } = parseImageName(imageName);
    const fullImageName = registry
      ? `${registry}/${repository}:${tag}`
      : `${repository}:${tag}`;

    // Check if GHCR and needs auth
    const isGHCR = registry === "ghcr.io";
    let authconfig: Docker.AuthConfig | undefined;

    if (isGHCR && config.githubToken) {
      authconfig = {
        username: "token",
        password: config.githubToken,
        serveraddress: "ghcr.io",
      };
    } else if (registry && config.dockerUsername && config.dockerPassword) {
      authconfig = {
        username: config.dockerUsername,
        password: config.dockerPassword,
        serveraddress: registry,
      };
    }

    console.log(`Pulling image: ${fullImageName}`);

    try {
      // Check Docker daemon availability
      const isAvailable = await this.ping();
      if (!isAvailable) {
        throw new DockerError(
          "Docker daemon is not accessible",
          "DOCKER_UNAVAILABLE",
          503,
        );
      }

      // Pull the image
      const stream = await this.docker.pull(fullImageName, { authconfig });

      // Wait for pull to complete using followProgress
      const result = await new Promise<{ digest?: string }>(
        (resolve, reject) => {
          this.docker.modem.followProgress(
            stream,
            (
              err: Error | null,
              output: Array<{
                status?: string;
                id?: string;
                aux?: { Digest?: string };
              }>,
            ) => {
              if (err) {
                reject(err);
                return;
              }

              // Extract digest from output if available
              const digestLine = output.find((line) => line.aux?.Digest);
              resolve({ digest: digestLine?.aux?.Digest });
            },
            () => {
              // Progress callback - no logging needed, we log success at the end
            },
          );
        },
      );

      logOperationSuccess(`Pulled image`, fullImageName);

      return {
        success: true,
        image: repository,
        tag,
        digest: result.digest,
      };
    } catch (error) {
      // Handle specific Docker errors
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      if (errorMessage.includes("not found") || errorMessage.includes("404")) {
        throw new DockerError(
          "Image not found in registry",
          "IMAGE_NOT_FOUND",
          404,
        );
      }

      if (
        errorMessage.includes("unauthorized") ||
        errorMessage.includes("401")
      ) {
        // Provide helpful error message for GHCR private images without token
        // Never log token values - only check if token exists
        const errorMsg =
          isGHCR && !config.githubToken
            ? "Registry authentication required for private GitHub Container Registry images. Configure GITHUB_TOKEN environment variable with read:packages scope."
            : "Registry authentication failed";
        throw new DockerError(errorMsg, "REGISTRY_AUTH_FAILED", 401);
      }

      if (
        errorMessage.includes("timeout") ||
        errorMessage.includes("ETIMEDOUT")
      ) {
        throw new DockerError(
          "Registry connection timeout",
          "REGISTRY_TIMEOUT",
          504,
        );
      }

      if (
        errorMessage.includes("ENOENT") ||
        errorMessage.includes("connect ENOENT")
      ) {
        throw new DockerError(
          "Docker daemon is not accessible",
          "DOCKER_UNAVAILABLE",
          503,
        );
      }

      // Re-throw DockerError as-is
      if (error instanceof DockerError) {
        throw error;
      }

      // Wrap unknown errors
      console.error("Docker pull error:", errorMessage);
      throw new DockerError("Failed to pull image", "INTERNAL_ERROR", 500);
    }
  }

  /**
   * List running containers that use a specific Docker image
   * @param imageName Full image name (e.g., nginx:latest, ghcr.io/org/repo:tag)
   */
  async listContainersByImage(
    imageName: string,
  ): Promise<ListContainersResponse> {
    // Validate image name (T008)
    if (!validateImageName(imageName)) {
      throw new DockerError("Invalid image name format", "INVALID_IMAGE", 400);
    }

    logOperation(`Listing containers by image`, imageName);

    try {
      // Check Docker daemon availability (T010)
      const isAvailable = await this.ping();
      if (!isAvailable) {
        throw new DockerError(
          "Docker daemon is not accessible",
          "DOCKER_UNAVAILABLE",
          503,
        );
      }

      // List containers and filter by image name
      // Note: We can't rely solely on ancestor filter because it matches exact image reference
      // (including digest), so containers created with old digests won't match after pulling new version
      // Instead, we get all containers and match by Image field
      const allContainers = await this.docker.listContainers({
        all: false, // Only running containers
      });

      // Parse the requested image name to extract registry, repository and tag
      const { registry, repository, tag } = parseImageName(imageName);
      // Reconstruct full image name for matching (registry/repository:tag)
      const requestedImageName = registry
        ? `${registry}/${repository}:${tag || "latest"}`
        : `${repository}:${tag || "latest"}`;

      // Also create image name without tag for matching containers created without explicit tag
      // e.g., if searching for "nginx:latest", also match containers using just "nginx"
      const requestedImageNameWithoutTag = registry
        ? `${registry}/${repository}`
        : repository;

      // Helper to check if container image matches the requested image
      const matchesImage = (containerImage: string): boolean => {
        // Match by repository:tag (ignore digest if present)
        // e.g., "ghcr.io/org/repo:latest" or "ghcr.io/org/repo:latest@sha256:..."
        if (containerImage.startsWith(requestedImageName)) {
          return true;
        }
        // Also match containers created without explicit tag (e.g., "nginx" matches "nginx:latest")
        // Only when searching for "latest" tag
        if (tag === "latest" || !tag) {
          if (
            containerImage === requestedImageNameWithoutTag ||
            containerImage.startsWith(requestedImageNameWithoutTag + "@")
          ) {
            return true;
          }
        }
        return false;
      };

      // Filter containers by matching image name (repository:tag)
      // Note: container.Image from listContainers() may be just an image ID (e.g., "8bc30e7bf489")
      // We need to inspect each container to get the actual image name from Config.Image
      const containers = await Promise.all(
        allContainers.map(async (container) => {
          try {
            const containerObj = this.docker.getContainer(container.Id);
            const inspectData = await containerObj.inspect();
            const containerImage =
              inspectData.Config?.Image || container.Image || "";
            return matchesImage(containerImage) ? container : null;
          } catch (error) {
            // If inspection fails, fall back to Image field matching
            const containerImage = container.Image || "";
            return matchesImage(containerImage) ? container : null;
          }
        }),
      );

      // Filter out null values
      const filteredContainers = containers.filter(
        (container): container is NonNullable<typeof container> =>
          container !== null,
      );

      // Transform Docker container data to ContainerInfo format (T009)
      const containerInfos: ContainerInfo[] = filteredContainers.map(
        (container) => ({
          id: container.Id.substring(0, 12), // Short container ID (first 12 characters)
          name:
            container.Names[0]?.replace(/^\//, "") ||
            container.Id.substring(0, 12), // Remove leading slash from name
          status: container.Status || "Unknown", // Container status string
        }),
      );

      // Log operation (T011)
      logOperationSuccess(
        `Listed containers by image`,
        `${containerInfos.length} container(s) found`,
      );

      return {
        success: true,
        image: imageName,
        containers: containerInfos,
        count: containerInfos.length,
      };
    } catch (error) {
      // Handle specific Docker errors
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      // Log operation failure (T011)
      logWarning(`List containers failed: ${imageName} - ${errorMessage}`);

      // Re-throw DockerError as-is
      if (error instanceof DockerError) {
        throw error;
      }

      // Handle Docker daemon unavailable errors
      if (
        errorMessage.includes("ENOENT") ||
        errorMessage.includes("connect ENOENT") ||
        errorMessage.includes("ECONNREFUSED")
      ) {
        throw new DockerError(
          "Docker daemon is not accessible",
          "DOCKER_UNAVAILABLE",
          503,
        );
      }

      // Wrap unknown errors
      logWarning(`Docker list containers error: ${errorMessage}`);
      throw new DockerError("Failed to list containers", "INTERNAL_ERROR", 500);
    }
  }

  /**
   * List all containers (running and stopped) that use a specific Docker image
   * Similar to listContainersByImage but includes stopped containers
   */
  async listAllContainersByImage(
    imageName: string,
  ): Promise<ListContainersResponse> {
    // Validate image name
    if (!validateImageName(imageName)) {
      throw new DockerError("Invalid image name format", "INVALID_IMAGE", 400);
    }

    logOperation(`Listing all containers by image`, imageName);

    try {
      // Check Docker daemon availability
      const isAvailable = await this.ping();
      if (!isAvailable) {
        throw new DockerError(
          "Docker daemon is not accessible",
          "DOCKER_UNAVAILABLE",
          503,
        );
      }

      // List containers and filter by image name
      // Note: ancestor filter matches exact image reference (including digest)
      // So containers created with old digests won't match after pulling new version
      // Instead, we get all containers and match by Image field (repository:tag)
      const allContainers = await this.docker.listContainers({
        all: true, // Include stopped containers
      });

      // Parse the requested image name to extract registry, repository and tag
      const { registry, repository, tag } = parseImageName(imageName);
      // Reconstruct full image name for matching (registry/repository:tag)
      const requestedImageName = registry
        ? `${registry}/${repository}:${tag || "latest"}`
        : `${repository}:${tag || "latest"}`;

      // Also create image name without tag for matching containers created without explicit tag
      // e.g., if searching for "nginx:latest", also match containers using just "nginx"
      const requestedImageNameWithoutTag = registry
        ? `${registry}/${repository}`
        : repository;

      // Helper to check if container image matches the requested image
      const matchesImage = (containerImage: string): boolean => {
        // Match by repository:tag (ignore digest if present)
        // e.g., "ghcr.io/org/repo:latest" or "ghcr.io/org/repo:latest@sha256:..."
        if (containerImage.startsWith(requestedImageName)) {
          return true;
        }
        // Also match containers created without explicit tag (e.g., "nginx" matches "nginx:latest")
        // Only when searching for "latest" tag
        if (tag === "latest" || !tag) {
          if (
            containerImage === requestedImageNameWithoutTag ||
            containerImage.startsWith(requestedImageNameWithoutTag + "@")
          ) {
            return true;
          }
        }
        return false;
      };

      // Filter containers by matching image name (repository:tag)
      // Note: container.Image from listContainers() may be just an image ID (e.g., "8bc30e7bf489")
      // We need to inspect each container to get the actual image name from Config.Image
      const containers = await Promise.all(
        allContainers.map(async (container) => {
          try {
            const containerObj = this.docker.getContainer(container.Id);
            const inspectData = await containerObj.inspect();
            const containerImage =
              inspectData.Config?.Image || container.Image || "";
            return matchesImage(containerImage) ? container : null;
          } catch (error) {
            // If inspection fails, fall back to Image field matching
            const containerImage = container.Image || "";
            return matchesImage(containerImage) ? container : null;
          }
        }),
      );

      // Filter out null values
      const filteredContainers = containers.filter(
        (container): container is NonNullable<typeof container> =>
          container !== null,
      );

      // Transform Docker container data to ContainerInfo format
      const containerInfos: ContainerInfo[] = filteredContainers.map(
        (container) => ({
          id: container.Id.substring(0, 12), // Short container ID (first 12 characters)
          name:
            container.Names[0]?.replace(/^\//, "") ||
            container.Id.substring(0, 12), // Remove leading slash from name
          status: container.Status || "Unknown", // Container status string
        }),
      );

      // Log operation
      logOperationSuccess(
        `Listed all containers by image`,
        `${containerInfos.length} container(s) found`,
      );

      return {
        success: true,
        image: imageName,
        containers: containerInfos,
        count: containerInfos.length,
      };
    } catch (error) {
      // Handle specific Docker errors
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      // Log operation failure
      logWarning(`List all containers failed: ${imageName} - ${errorMessage}`);

      // Re-throw DockerError as-is
      if (error instanceof DockerError) {
        throw error;
      }

      // Handle Docker daemon unavailable errors
      if (
        errorMessage.includes("ENOENT") ||
        errorMessage.includes("connect ENOENT") ||
        errorMessage.includes("ECONNREFUSED")
      ) {
        throw new DockerError(
          "Docker daemon is not accessible",
          "DOCKER_UNAVAILABLE",
          503,
        );
      }

      // Wrap unknown errors
      logWarning(`Docker list all containers error: ${errorMessage}`);
      throw new DockerError("Failed to list containers", "INTERNAL_ERROR", 500);
    }
  }

  /**
   * Extract docker-compose metadata from container labels
   * @param inspectData Container inspect data from Dockerode
   * @returns ContainerMetadata with compose information
   */
  extractComposeMetadata(
    inspectData: Docker.ContainerInspectInfo,
  ): ContainerMetadata {
    const labels = inspectData.Config.Labels || {};
    const projectName = labels["com.docker.compose.project"];
    const serviceName = labels["com.docker.compose.service"];
    const hostComposeDir = labels["com.docker.compose.project.working_dir"];
    const configFiles = labels["com.docker.compose.project.config_files"];

    if (!projectName || !serviceName || !hostComposeDir) {
      throw new DockerError(
        "Container not managed by Docker Compose or missing labels",
        "COMPOSE_FILE_NOT_FOUND",
        400,
      );
    }

    // Extract compose file name (first file if multiple)
    const composeFile =
      configFiles?.split(",")[0]?.trim().split("/").at(-1) ||
      "docker-compose.yml";

    return {
      projectName,
      serviceName,
      composeFile,
      composeDir: hostComposeDir,
    };
  }

  /**
   * Translate host filesystem path to container-accessible path
   * @param hostPath Path on the host filesystem
   * @returns Path accessible from within the container
   */
  translateHostPathToContainerPath(hostPath: string): string {
    // Check if running in container (via environment variable)
    const isInContainer =
      process.env.DOCKER_MANAGER_RUNNING_IN_CONTAINER === "true" ||
      process.env.DOCKER_CONTAINER === "true";

    // If not in container, return path as-is (use host paths directly)
    // This handles Windows dev environment where we run directly on host
    if (!isInContainer) {
      return hostPath;
    }

    // Normalize path separators (handle Windows paths)
    // Remove Windows drive letters (e.g., D:/path -> /path)
    let normalizedPath = hostPath.replace(/\\/g, "/").replace(/^[A-Z]:/i, "");

    // Ensure path starts with /
    const cleanPath = normalizedPath.startsWith("/")
      ? normalizedPath
      : `/${normalizedPath}`;
    return cleanPath;
  }

  /**
   * Execute docker-compose command with error handling
   * @param command Docker-compose command to execute
   * @param composeDir Working directory for the command
   * @param timeout Timeout in milliseconds (default: 30 seconds)
   * @returns Command output (stdout)
   */
  async executeComposeCommand(
    command: string,
    composeDir: string,
    timeout: number = 30000,
  ): Promise<string> {
    try {
      console.log(`Executing: ${command} in ${composeDir}`);

      // Determine shell based on platform and container status
      // Only use /bin/sh when running in a Linux container
      // On Windows host, let Node.js use the default shell (cmd.exe)
      const isInContainer =
        process.env.DOCKER_MANAGER_RUNNING_IN_CONTAINER === "true" ||
        process.env.DOCKER_CONTAINER === "true";
      const isWindows = process.platform === "win32";

      const execOptions: {
        cwd: string;
        timeout: number;
        shell?: string;
      } = {
        cwd: composeDir,
        timeout,
      };

      // Only specify shell when running in container (Linux)
      // On Windows host, omit shell option to use default (cmd.exe)
      if (isInContainer && !isWindows) {
        execOptions.shell = "/bin/sh";
      }

      const { stdout, stderr } = await execAsync(command, execOptions);

      if (stderr && !stderr.includes("WARNING")) {
        // Log warnings but don't fail on them
        console.warn(`docker-compose stderr: ${stderr}`);
      }

      return stdout;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorOutput =
        error instanceof Error && "stderr" in error
          ? (error as { stderr?: string }).stderr || ""
          : "";

      // Parse error to determine error code
      const fullError = `${errorMessage} ${errorOutput}`.toLowerCase();

      if (
        fullError.includes("no such service") ||
        fullError.includes("service not found")
      ) {
        throw new DockerError(
          "Service not found in compose file",
          "SERVICE_NOT_FOUND",
          400,
        );
      }

      if (
        fullError.includes("permission denied") ||
        fullError.includes("eacces")
      ) {
        throw new DockerError(
          "Permission denied accessing compose file or executing command",
          "PERMISSION_DENIED",
          500,
        );
      }

      if (
        fullError.includes("no such file") ||
        fullError.includes("cannot find") ||
        fullError.includes("compose file not found")
      ) {
        throw new DockerError(
          "Docker-compose file not found or inaccessible",
          "COMPOSE_FILE_NOT_FOUND",
          500,
        );
      }

      if (
        fullError.includes("docker daemon") ||
        fullError.includes("cannot connect") ||
        fullError.includes("econnrefused")
      ) {
        throw new DockerError(
          "Docker daemon unavailable",
          "DOCKER_UNAVAILABLE",
          503,
        );
      }

      if (
        fullError.includes("enoent") ||
        fullError.includes("spawn") ||
        fullError.includes("not found")
      ) {
        throw new DockerError(
          "Shell or docker-compose command not found. Ensure docker-compose is installed in the container. Error: " +
            fullError +
            " Command: " +
            command +
            " Compose Dir: " +
            composeDir,
          "INTERNAL_ERROR",
          500,
        );
      }

      // Re-throw DockerError as-is
      if (error instanceof DockerError) {
        throw error;
      }

      // Wrap unknown errors
      throw new DockerError(
        `docker-compose command failed: ${errorMessage}`,
        "INTERNAL_ERROR",
        500,
      );
    }
  }

  /**
   * Rebuild a container that was started via docker-compose
   * @param containerIdOrName Container identifier (ID or name)
   * @returns RebuildContainerResponse with container status
   */
  async rebuildContainer(
    containerIdOrName: string,
  ): Promise<RebuildContainerResponse> {
    console.log(`Rebuild container request received: ${containerIdOrName}`);

    try {
      // Check Docker daemon availability
      const isAvailable = await this.ping();
      if (!isAvailable) {
        throw new DockerError(
          "Docker daemon is not accessible",
          "DOCKER_UNAVAILABLE",
          503,
        );
      }

      // Get container and inspect it
      const container = this.docker.getContainer(containerIdOrName);
      let inspect: Docker.ContainerInspectInfo;

      try {
        inspect = await container.inspect();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        if (
          errorMessage.includes("no such container") ||
          errorMessage.includes("404")
        ) {
          throw new DockerError(
            "Container not found",
            "CONTAINER_NOT_FOUND",
            404,
          );
        }
        throw error;
      }

      // Extract compose metadata
      const metadata = this.extractComposeMetadata(inspect);
      console.log(
        `Extracted compose metadata: project=${metadata.projectName}, service=${metadata.serviceName}, file=${metadata.composeFile}`,
      );

      // Translate host path to container path
      const containerComposeDir = this.translateHostPathToContainerPath(
        metadata.composeDir,
      );

      console.log(
        `Translated paths: host=${metadata.composeDir} -> container=${containerComposeDir}`,
      );

      // Step 1: Stop container (if running) - handle gracefully if already stopped
      try {
        console.log(
          `Stopping container: docker compose -f ${metadata.composeFile} -p ${metadata.projectName} stop ${metadata.serviceName}`,
        );
        await this.executeComposeCommand(
          `docker compose -f ${metadata.composeFile} -p ${metadata.projectName} stop ${metadata.serviceName}`,
          containerComposeDir,
          30000,
        );
        console.log(`Container stopped successfully`);
      } catch (error) {
        // Ignore if already stopped, log otherwise
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        if (
          !errorMessage.toLowerCase().includes("already stopped") &&
          !errorMessage.toLowerCase().includes("no such service")
        ) {
          throw error;
        }
        console.log(`Container already stopped or not running`);
      }

      // Step 2: Build image
      console.log(
        `Building image: docker compose -f ${metadata.composeFile} -p ${metadata.projectName} build ${metadata.serviceName}`,
      );
      try {
        await this.executeComposeCommand(
          `docker compose -f ${metadata.composeFile} -p ${metadata.projectName} build ${metadata.serviceName}`,
          containerComposeDir,
          300000, // 5 minute timeout for builds
        );
        console.log(`Image built successfully`);
      } catch (error) {
        // Map build failures to BUILD_FAILED error code
        if (error instanceof DockerError) {
          // If it's already a DockerError, check if it's a build-related error
          const errorMessage = error.message.toLowerCase();
          if (
            errorMessage.includes("build") ||
            errorMessage.includes("failed") ||
            error.code === "INTERNAL_ERROR"
          ) {
            throw new DockerError(
              `Image build failed: ${error.message}`,
              "BUILD_FAILED",
              500,
            );
          }
          throw error;
        }
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        throw new DockerError(
          `Image build failed: ${errorMessage}`,
          "BUILD_FAILED",
          500,
        );
      }

      // Step 3: Recreate and start container
      console.log(
        `Starting container: docker compose -f ${metadata.composeFile} -p ${metadata.projectName} up -d ${metadata.serviceName}`,
      );
      await this.executeComposeCommand(
        `docker compose -f ${metadata.composeFile} -p ${metadata.projectName} up -d ${metadata.serviceName}`,
        containerComposeDir,
        60000, // 1 minute timeout for start
      );
      console.log(`Container started successfully`);

      // Step 4: Verify container status
      // Note: After docker compose up -d, the container may have been recreated with a new ID
      // So we find the container by service name instead of using the old container ID
      let finalInspect: Docker.ContainerInspectInfo;
      let finalContainerId = containerIdOrName;
      try {
        // Try to inspect the original container first (in case it wasn't recreated)
        finalInspect = await container.inspect();
      } catch (error) {
        // If the original container doesn't exist (was recreated), find it by service name
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        if (
          errorMessage.includes("no such container") ||
          errorMessage.includes("404")
        ) {
          // Find the new container by service name pattern: project-service-1
          const allContainers = await this.docker.listContainers({ all: true });
          const serviceContainer = allContainers.find((c) => {
            const name = c.Names[0]?.replace(/^\//, "") || "";
            // Match pattern: project-service-1 or project-service-1-suffix
            return name.startsWith(
              `${metadata.projectName}-${metadata.serviceName}-`,
            );
          });

          if (serviceContainer) {
            const newContainer = this.docker.getContainer(serviceContainer.Id);
            finalInspect = await newContainer.inspect();
            finalContainerId = serviceContainer.Id.substring(0, 12);
          } else {
            // If we can't find the container, assume success (docker compose succeeded)
            return {
              success: true,
              container: containerIdOrName,
              status: "running",
              message: "Container rebuilt and started successfully",
            };
          }
        } else {
          throw error;
        }
      }

      const status = finalInspect.State?.Status || "unknown";

      console.log(`Rebuild completed: ${finalContainerId} -> status=${status}`);

      return {
        success: true,
        container: finalContainerId,
        status,
        message: "Container rebuilt and started successfully",
      };
    } catch (error) {
      // Re-throw DockerError as-is
      if (error instanceof DockerError) {
        console.error(
          `Rebuild failed: ${containerIdOrName} -> ${error.code}: ${error.message}`,
        );
        throw error;
      }

      // Wrap unknown errors
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error(`Rebuild error: ${containerIdOrName} -> ${errorMessage}`);
      throw new DockerError(
        "An unexpected error occurred during rebuild",
        "INTERNAL_ERROR",
        500,
      );
    }
  }

  /**
   * Rebuild all containers (running and stopped) that use a specific Docker image
   * Processes containers sequentially and handles partial failures gracefully
   */
  async rebuildContainersByImage(
    imageName: string,
  ): Promise<RebuildContainersByImageResponse> {
    // Validate image name format (FR-002)
    if (!validateImageName(imageName)) {
      throw new DockerError("Invalid image name format", "INVALID_IMAGE", 400);
    }

    console.log(`Rebuild containers by image request received: ${imageName}`);

    // Check Docker daemon availability before processing (FR-019)
    const isAvailable = await this.ping();
    if (!isAvailable) {
      throw new DockerError(
        "Docker daemon is not accessible",
        "DOCKER_UNAVAILABLE",
        503,
      );
    }

    // IMPORTANT: Find containers BEFORE pulling the image
    // This ensures we find containers using the old image version/digest
    // After pulling, the image reference changes and containers using old versions won't match
    logOperation(`Finding containers using image`, imageName);
    const listResponse = await this.listAllContainersByImage(imageName);

    logOperation(
      `Found containers using image`,
      `${listResponse.count} container(s)`,
    );

    // Pull the latest version of the image after finding containers
    // This way we rebuild containers that were using the image name,
    // regardless of which version/digest they had
    logOperation(`Pulling latest image version`, imageName);
    try {
      await this.pullImage(imageName);
      // pullImage() already logs success, no need to log again
    } catch (error) {
      // If pull fails, log warning but continue - image might already exist locally
      // This allows rebuilds to proceed even if registry is temporarily unavailable
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logWarning(
        `Failed to pull image ${imageName}: ${errorMessage}. Continuing with rebuild using existing image.`,
      );
    }

    const results: ContainerRebuildResult[] = [];
    let successful = 0;
    let failed = 0;
    let skipped = 0;

    // Process containers sequentially (one at a time) (FR-006)
    for (let i = 0; i < listResponse.containers.length; i++) {
      const containerInfo = listResponse.containers[i];
      const containerId = containerInfo.id;
      const progress = `${i + 1}/${listResponse.count}`;

      logOperation(`Rebuilding container`, `${containerId} (${progress})`);

      try {
        // Attempt to rebuild the container (FR-007)
        const rebuildResult = await this.rebuildContainer(containerId);

        // Success - container was rebuilt
        results.push({
          container: containerId,
          status: "success",
          message:
            rebuildResult.message ||
            "Container rebuilt and started successfully",
        });
        successful++;
      } catch (error) {
        // Handle errors - categorize as skipped or failed (FR-014)
        if (error instanceof DockerError) {
          if (error.code === "COMPOSE_FILE_NOT_FOUND") {
            // Container not started via docker-compose - mark as skipped (FR-005)
            results.push({
              container: containerId,
              status: "skipped",
              error: "Container not started via docker-compose",
            });
            skipped++;
          } else {
            // Actual rebuild failure
            results.push({
              container: containerId,
              status: "failed",
              error: error.message,
            });
            failed++;
          }
        } else {
          // Unexpected error
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          results.push({
            container: containerId,
            status: "failed",
            error: errorMessage,
          });
          failed++;
        }
        // Continue processing remaining containers even if this one failed (FR-011, FR-020)
      }
    }

    // Log operation completion with summary (FR-010, FR-018)
    logOperationSuccess(
      `Rebuild containers by image completed`,
      `${successful} successful, ${failed} failed, ${skipped} skipped`,
    );

    // Return response with summary and detailed results (FR-008, FR-009, FR-017)
    return {
      success: true,
      image: imageName,
      total: listResponse.count,
      successful,
      failed,
      skipped,
      results,
    };
  }
}

// Export singleton instance
export const dockerService = new DockerService();
