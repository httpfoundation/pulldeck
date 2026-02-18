import "dotenv/config";
import type { Config } from "../types/index.js";

/**
 * Load and validate environment configuration
 * Fails fast if required variables are missing
 */
function loadConfig(): Config {
  const authToken = process.env.AUTH_TOKEN;

  if (!authToken) {
    console.error("FATAL: AUTH_TOKEN environment variable is required");
    process.exit(1);
  }

  const port = parseInt(process.env.PORT || "3000", 10);

  if (isNaN(port) || port < 1 || port > 65535) {
    console.error("FATAL: PORT must be a valid port number (1-65535)");
    process.exit(1);
  }

  return {
    authToken,
    githubToken: process.env.GITHUB_TOKEN,
    dockerUsername: process.env.DOCKER_USERNAME,
    dockerPassword: process.env.DOCKER_PASSWORD,
    port,
  };
}

/**
 * Application configuration singleton
 * Loaded once at startup
 */
export const config = loadConfig();
