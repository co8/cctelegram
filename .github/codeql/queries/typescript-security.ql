/**
 * @name Custom TypeScript Security Queries for CCTelegram MCP
 * @kind problem
 * @problem.severity warning
 * @id typescript/cctelegram-security
 * @tags security
 *       external/cwe/cwe-079
 *       external/cwe/cwe-089
 *       external/cwe/cwe-094
 */

import javascript

// Query for potential command injection vulnerabilities
from CallExpr call, string method
where call.getCalleeName() = method and
      (method = "exec" or method = "spawn" or method = "execSync") and
      exists(call.getArgument(0).getStringValue())
select call, "Potential command injection vulnerability in " + method + " call"

// Query for hardcoded secrets/credentials
from StringLiteral str
where str.getValue().regexpMatch("(?i).*(password|secret|key|token|credential).*[=:].*[a-zA-Z0-9+/]{8,}.*")
select str, "Potential hardcoded secret or credential"

// Query for unsafe crypto usage
from CallExpr call
where call.getCalleeName() = "createHash" and
      call.getArgument(0).getStringValue() = "md5"
select call, "Use of insecure MD5 hash algorithm"

// Query for potential path traversal
from CallExpr call
where call.getCalleeName().regexpMatch("(readFile|writeFile|unlink|mkdir|rmdir).*") and
      exists(call.getArgument(0)) and
      call.getArgument(0).toString().matches("*../*")
select call, "Potential path traversal vulnerability"