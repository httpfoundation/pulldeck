/**
 * TypeScript interfaces for Docker Manager API
 * Based on data-model.md specification
 */

/**
 * Request body for image pull operations
 */
export interface PullRequest {
  image: string;
}

/**
 * Successful pull operation response
 */
export interface PullResponse {
  success: true;
  image: string;
  tag: string;
  digest?: string;
}

/**
 * Error response for failed operations
 */
export interface ErrorResponse {
  success: false;
  error: string;
  code?: ErrorCode;
}

/**
 * Machine-readable error codes
 */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_IMAGE"
  | "IMAGE_NOT_FOUND"
  | "REGISTRY_AUTH_FAILED"
  | "REGISTRY_TIMEOUT"
  | "DOCKER_UNAVAILABLE"
  | "INTERNAL_ERROR"
  | "INVALID_CONTAINER"
  | "CONTAINER_NOT_FOUND"
  | "COMPOSE_FILE_NOT_FOUND"
  | "SERVICE_NOT_FOUND"
  | "BUILD_FAILED"
  | "PERMISSION_DENIED";

/**
 * Union type for all API responses
 */
export type ApiResponse =
  | PullResponse
  | ListContainersResponse
  | RebuildContainerResponse
  | RebuildContainersByImageResponse
  | ErrorResponse;

/**
 * Application configuration from environment variables
 */
export interface Config {
  authToken: string;
  githubToken?: string;
  dockerUsername?: string;
  dockerPassword?: string;
  port: number;
}

/**
 * Request body for container list operations
 */
export interface ListContainersRequest {
  image: string;
}

/**
 * Information about a single container
 */
export interface ContainerInfo {
  id: string;
  name: string;
  status: string;
}

/**
 * Successful container list operation response
 */
export interface ListContainersResponse {
  success: true;
  image: string;
  containers: ContainerInfo[];
  count: number;
}

/**
 * Request body for container rebuild operations
 */
export interface RebuildContainerRequest {
  container: string;
}

/**
 * Successful container rebuild operation response
 */
export interface RebuildContainerResponse {
  success: true;
  container: string;
  status: string;
  message?: string;
}

/**
 * Container metadata extracted from docker-compose labels
 */
export interface ContainerMetadata {
  projectName: string;
  serviceName: string;
  composeFile: string;
  composeDir: string;
}

/**
 * Request body for rebuild containers by image operations
 */
export interface RebuildContainersByImageRequest {
  image: string;
}

/**
 * Rebuild status result for a single container
 */
export interface ContainerRebuildResult {
  container: string;
  status: "success" | "failed" | "skipped";
  message?: string;
  error?: string;
}

/**
 * Successful rebuild containers by image operation response
 */
export interface RebuildContainersByImageResponse {
  success: true;
  image: string;
  total: number;
  successful: number;
  failed: number;
  skipped: number;
  results: ContainerRebuildResult[];
}
