/**
 * Logger utility with color support for consistent API logging
 */

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

/**
 * Format timestamp for logs
 */
function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Log API request received
 */
export function logRequest(method: string, endpoint: string, params?: string): void {
  const timestamp = getTimestamp();
  console.log(
    `${colors.gray}[${timestamp}]${colors.reset} ${colors.cyan}${method}${colors.reset} ${colors.bright}${endpoint}${colors.reset}${params ? ` ${colors.magenta}${params}${colors.reset}` : ""}`
  );
}

/**
 * Log API request success
 */
export function logSuccess(
  method: string,
  endpoint: string,
  message: string
): void {
  const timestamp = getTimestamp();
  console.log(
    `${colors.gray}[${timestamp}]${colors.reset} ${colors.green}✓${colors.reset} ${colors.cyan}${method}${colors.reset} ${colors.bright}${endpoint}${colors.reset} ${colors.green}${message}${colors.reset}`
  );
}

/**
 * Log API request failure
 */
export function logError(
  method: string,
  endpoint: string,
  code: string,
  message: string
): void {
  const timestamp = getTimestamp();
  console.error(
    `${colors.gray}[${timestamp}]${colors.reset} ${colors.red}✗${colors.reset} ${colors.cyan}${method}${colors.reset} ${colors.bright}${endpoint}${colors.reset} ${colors.red}${code}${colors.reset}: ${colors.yellow}${message}${colors.reset}`
  );
}

/**
 * Log API request rejection (validation errors)
 */
export function logRejection(endpoint: string, reason: string): void {
  const timestamp = getTimestamp();
  console.log(
    `${colors.gray}[${timestamp}]${colors.reset} ${colors.yellow}⚠${colors.reset} ${colors.bright}${endpoint}${colors.reset} ${colors.yellow}rejected${colors.reset}: ${colors.magenta}${reason}${colors.reset}`
  );
}

/**
 * Log operation info (for service-level operations)
 */
export function logOperation(operation: string, details?: string): void {
  const timestamp = getTimestamp();
  console.log(
    `${colors.gray}[${timestamp}]${colors.reset} ${colors.blue}→${colors.reset} ${colors.cyan}${operation}${colors.reset}${details ? ` ${colors.gray}${details}${colors.reset}` : ""}`
  );
}

/**
 * Log operation success
 */
export function logOperationSuccess(operation: string, details: string): void {
  const timestamp = getTimestamp();
  console.log(
    `${colors.gray}[${timestamp}]${colors.reset} ${colors.green}✓${colors.reset} ${colors.cyan}${operation}${colors.reset} ${colors.green}${details}${colors.reset}`
  );
}

/**
 * Log operation warning
 */
export function logWarning(message: string): void {
  const timestamp = getTimestamp();
  console.warn(
    `${colors.gray}[${timestamp}]${colors.reset} ${colors.yellow}⚠${colors.reset} ${colors.yellow}${message}${colors.reset}`
  );
}
