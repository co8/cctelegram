/**
 * Jest Custom Matchers Type Definitions
 */

declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidUUID(): R;
      toBeValidISO8601(): R;
      toHaveSecurityHeaders(): R;
      toMatchEventStructure(): R;
      toMatchResponseStructure(): R;
      toMatchBridgeStatusStructure(): R;
    }
  }
}

export {};