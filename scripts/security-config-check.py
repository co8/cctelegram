#!/usr/bin/env python3
"""
Security Configuration Validation Script for CCTelegram
Validates security configurations across both Bridge and MCP Server components
"""

import os
import json
import yaml
import re
import sys
import argparse
from pathlib import Path
from typing import Dict, List, Any, Tuple
import subprocess

class SecurityConfigChecker:
    def __init__(self, project_root: str):
        self.project_root = Path(project_root)
        self.bridge_root = self.project_root
        self.mcp_root = self.project_root / "mcp-server"
        self.results = {
            "timestamp": "",
            "overall_status": "pending",
            "scores": {},
            "issues": [],
            "recommendations": []
        }
    
    def log_issue(self, component: str, severity: str, message: str, recommendation: str = ""):
        """Log a security configuration issue."""
        self.results["issues"].append({
            "component": component,
            "severity": severity,
            "message": message,
            "recommendation": recommendation
        })
        print(f"[{severity.upper()}] {component}: {message}")
    
    def log_recommendation(self, component: str, message: str):
        """Log a security recommendation."""
        self.results["recommendations"].append({
            "component": component,
            "message": message
        })
        print(f"[RECOMMENDATION] {component}: {message}")
    
    def check_file_permissions(self) -> int:
        """Check file permissions for sensitive files."""
        print("\n🔒 Checking file permissions...")
        score = 10
        sensitive_files = [
            ".env",
            "config.toml",
            "mcp-server/.env",
            "mcp-server/config.json"
        ]
        
        for file_path in sensitive_files:
            full_path = self.project_root / file_path
            if full_path.exists():
                # Get file permissions
                stat_info = full_path.stat()
                permissions = oct(stat_info.st_mode)[-3:]
                
                # Check if file is readable by others
                if int(permissions[2]) > 0:
                    score -= 2
                    self.log_issue(
                        "FilePermissions", 
                        "warning",
                        f"{file_path} is readable by others (permissions: {permissions})",
                        f"Run: chmod 600 {full_path}"
                    )
                else:
                    print(f"✅ {file_path}: {permissions} (secure)")
        
        self.results["scores"]["file_permissions"] = score
        return score
    
    def check_environment_variables(self) -> int:
        """Check for proper environment variable usage."""
        print("\n🌍 Checking environment variable security...")
        score = 10
        
        # Check for hardcoded secrets in source files
        hardcoded_patterns = [
            (r'token\s*=\s*["\'][^"\']{20,}["\']', "Hardcoded token"),
            (r'key\s*=\s*["\'][^"\']{16,}["\']', "Hardcoded key"),
            (r'password\s*=\s*["\'][^"\']{8,}["\']', "Hardcoded password"),
            (r'secret\s*=\s*["\'][^"\']{12,}["\']', "Hardcoded secret")
        ]
        
        source_dirs = [
            self.bridge_root / "src",
            self.mcp_root / "src"
        ]
        
        for src_dir in source_dirs:
            if src_dir.exists():
                for file_path in src_dir.rglob("*.rs"):
                    self._check_file_for_patterns(file_path, hardcoded_patterns, score)
                
                for file_path in src_dir.rglob("*.ts"):
                    self._check_file_for_patterns(file_path, hardcoded_patterns, score)
        
        # Check for proper environment variable usage
        env_examples = [
            (self.project_root / "config.example.toml", "Bridge"),
            (self.mcp_root / ".env.example", "MCP Server")
        ]
        
        for env_file, component in env_examples:
            if env_file.exists():
                print(f"✅ {component}: Environment example file found")
            else:
                score -= 1
                self.log_recommendation(
                    component,
                    f"Create {env_file.name} with example configuration"
                )
        
        self.results["scores"]["environment_variables"] = score
        return score
    
    def _check_file_for_patterns(self, file_path: Path, patterns: List[Tuple[str, str]], score: int) -> int:
        """Check a file for security patterns."""
        try:
            content = file_path.read_text(encoding='utf-8')
            for pattern, description in patterns:
                matches = re.findall(pattern, content, re.IGNORECASE)
                if matches and "process.env" not in content:
                    score -= 3
                    self.log_issue(
                        "HardcodedSecrets",
                        "critical",
                        f"{description} found in {file_path.relative_to(self.project_root)}",
                        "Move secrets to environment variables"
                    )
        except (UnicodeDecodeError, PermissionError):
            pass  # Skip binary or inaccessible files
        
        return score
    
    def check_authentication_config(self) -> int:
        """Check authentication configuration."""
        print("\n🔐 Checking authentication configuration...")
        score = 0
        
        # Check Bridge authentication
        if self._check_bridge_auth_config():
            score += 5
            print("✅ Bridge: Authentication properly configured")
        else:
            self.log_issue(
                "BridgeAuth",
                "warning",
                "Bridge authentication may not be properly configured",
                "Ensure TELEGRAM_ALLOWED_USERS is set"
            )
        
        # Check MCP Server authentication
        if self._check_mcp_auth_config():
            score += 5
            print("✅ MCP Server: Authentication properly configured")
        else:
            self.log_issue(
                "MCPAuth",
                "warning", 
                "MCP Server authentication may not be properly configured",
                "Ensure MCP_API_KEYS is configured"
            )
        
        self.results["scores"]["authentication"] = score
        return score
    
    def _check_bridge_auth_config(self) -> bool:
        """Check Bridge authentication configuration."""
        # Check for authentication code in source
        auth_files = [
            self.bridge_root / "src" / "telegram" / "handlers.rs",
            self.bridge_root / "src" / "utils" / "security.rs"
        ]
        
        for auth_file in auth_files:
            if auth_file.exists():
                content = auth_file.read_text()
                if "TELEGRAM_ALLOWED_USERS" in content or "user_id" in content:
                    return True
        
        return False
    
    def _check_mcp_auth_config(self) -> bool:
        """Check MCP Server authentication configuration."""
        auth_files = [
            self.mcp_root / "src" / "security.ts",
            self.mcp_root / "src" / "index.ts"
        ]
        
        for auth_file in auth_files:
            if auth_file.exists():
                content = auth_file.read_text()
                if "MCP_API_KEYS" in content or "authenticate" in content:
                    return True
        
        return False
    
    def check_rate_limiting(self) -> int:
        """Check rate limiting configuration."""
        print("\n⏱️ Checking rate limiting configuration...")
        score = 0
        
        # Check Bridge rate limiting
        if self._check_bridge_rate_limiting():
            score += 5
            print("✅ Bridge: Rate limiting configured")
        else:
            self.log_issue(
                "BridgeRateLimit",
                "medium",
                "Bridge rate limiting not found",
                "Implement rate limiting for user requests"
            )
        
        # Check MCP Server rate limiting
        if self._check_mcp_rate_limiting():
            score += 5
            print("✅ MCP Server: Rate limiting configured")
        else:
            self.log_issue(
                "MCPRateLimit",
                "medium",
                "MCP Server rate limiting not found",
                "Implement rate limiting for API requests"
            )
        
        self.results["scores"]["rate_limiting"] = score
        return score
    
    def _check_bridge_rate_limiting(self) -> bool:
        """Check Bridge rate limiting implementation."""
        rate_limit_files = [
            self.bridge_root / "src" / "utils" / "security.rs",
            self.bridge_root / "src" / "telegram" / "handlers.rs"
        ]
        
        for file_path in rate_limit_files:
            if file_path.exists():
                content = file_path.read_text()
                if "rate_limit" in content.lower() or "throttle" in content.lower():
                    return True
        
        return False
    
    def _check_mcp_rate_limiting(self) -> bool:
        """Check MCP Server rate limiting implementation."""
        rate_limit_files = [
            self.mcp_root / "src" / "security.ts",
            self.mcp_root / "package.json"
        ]
        
        for file_path in rate_limit_files:
            if file_path.exists():
                content = file_path.read_text()
                if "rate" in content.lower() and "limit" in content.lower():
                    return True
        
        return False
    
    def check_input_validation(self) -> int:
        """Check input validation implementation."""
        print("\n🔍 Checking input validation...")
        score = 0
        
        # Check Bridge input validation
        if self._check_bridge_input_validation():
            score += 5
            print("✅ Bridge: Input validation implemented")
        else:
            self.log_issue(
                "BridgeValidation",
                "high",
                "Bridge input validation not comprehensive",
                "Implement comprehensive input sanitization"
            )
        
        # Check MCP Server input validation
        if self._check_mcp_input_validation():
            score += 5
            print("✅ MCP Server: Input validation implemented")
        else:
            self.log_issue(
                "MCPValidation",
                "high",
                "MCP Server input validation not found",
                "Implement input validation with Joi or similar"
            )
        
        self.results["scores"]["input_validation"] = score
        return score
    
    def _check_bridge_input_validation(self) -> bool:
        """Check Bridge input validation."""
        validation_indicators = ["sanitize", "validate", "SecurityManager"]
        
        src_files = list((self.bridge_root / "src").rglob("*.rs"))
        for file_path in src_files:
            if file_path.exists():
                content = file_path.read_text()
                if any(indicator in content for indicator in validation_indicators):
                    return True
        
        return False
    
    def _check_mcp_input_validation(self) -> bool:
        """Check MCP Server input validation."""
        # Check for Joi or other validation libraries
        package_json = self.mcp_root / "package.json"
        if package_json.exists():
            content = package_json.read_text()
            if "joi" in content.lower() or "validator" in content.lower():
                return True
        
        # Check for validation in source code
        src_files = list((self.mcp_root / "src").rglob("*.ts"))
        for file_path in src_files:
            if file_path.exists():
                content = file_path.read_text()
                if "validate" in content.lower() or "sanitize" in content.lower():
                    return True
        
        return False
    
    def check_logging_security(self) -> int:
        """Check secure logging practices."""
        print("\n📝 Checking logging security...")
        score = 10
        
        # Patterns that shouldn't appear in logs
        sensitive_log_patterns = [
            (r'log.*password', "Password in logs"),
            (r'log.*token', "Token in logs"),
            (r'log.*key', "Key in logs"),
            (r'println!.*password', "Password in Rust logs"),
            (r'console\.log.*password', "Password in JS logs")
        ]
        
        all_source_files = []
        all_source_files.extend(list((self.bridge_root / "src").rglob("*.rs")))
        all_source_files.extend(list((self.mcp_root / "src").rglob("*.ts")))
        
        for file_path in all_source_files:
            if file_path.exists():
                try:
                    content = file_path.read_text()
                    for pattern, description in sensitive_log_patterns:
                        if re.search(pattern, content, re.IGNORECASE):
                            score -= 2
                            self.log_issue(
                                "LoggingSecurity",
                                "medium",
                                f"{description} in {file_path.relative_to(self.project_root)}",
                                "Remove sensitive data from logs"
                            )
                except (UnicodeDecodeError, PermissionError):
                    pass
        
        self.results["scores"]["logging_security"] = score
        return score
    
    def check_dependency_security(self) -> int:
        """Check dependency security configuration."""
        print("\n📦 Checking dependency security...")
        score = 0
        
        # Check for Cargo.lock
        if (self.bridge_root / "Cargo.lock").exists():
            score += 2
            print("✅ Bridge: Cargo.lock present")
        else:
            self.log_issue(
                "BridgeDeps",
                "medium",
                "Cargo.lock not found",
                "Run cargo build to generate Cargo.lock"
            )
        
        # Check for package-lock.json
        if (self.mcp_root / "package-lock.json").exists():
            score += 2
            print("✅ MCP Server: package-lock.json present")
        else:
            self.log_issue(
                "MCPDeps",
                "medium",
                "package-lock.json not found",
                "Run npm install to generate package-lock.json"
            )
        
        # Check for audit scripts
        mcp_package_json = self.mcp_root / "package.json"
        if mcp_package_json.exists():
            content = json.loads(mcp_package_json.read_text())
            scripts = content.get("scripts", {})
            if any("audit" in script for script in scripts.keys()):
                score += 3
                print("✅ MCP Server: Audit scripts configured")
            else:
                self.log_recommendation(
                    "MCPDeps",
                    "Add npm audit scripts to package.json"
                )
        
        # Check for security-focused dependencies
        if mcp_package_json.exists():
            content = json.loads(mcp_package_json.read_text())
            deps = content.get("dependencies", {})
            if "helmet" in deps or "express-rate-limit" in deps:
                score += 3
                print("✅ MCP Server: Security dependencies found")
            else:
                self.log_recommendation(
                    "MCPDeps",
                    "Consider adding security dependencies like helmet"
                )
        
        self.results["scores"]["dependency_security"] = score
        return score
    
    def check_ci_security(self) -> int:
        """Check CI/CD security configuration."""
        print("\n🔄 Checking CI/CD security...")
        score = 0
        
        workflows_dir = self.project_root / ".github" / "workflows"
        if workflows_dir.exists():
            security_workflows = [
                "security-enhanced.yml",
                "scorecard.yml", 
                "slsa-provenance.yml"
            ]
            
            for workflow in security_workflows:
                if (workflows_dir / workflow).exists():
                    score += 3
                    print(f"✅ Security workflow: {workflow}")
                else:
                    self.log_recommendation(
                        "CI/CD",
                        f"Consider adding {workflow} security workflow"
                    )
            
            # Check for proper permissions in workflows
            workflow_files = list(workflows_dir.glob("*.yml"))
            for workflow_file in workflow_files:
                content = workflow_file.read_text()
                if "permissions:" in content:
                    score += 1
                    print(f"✅ {workflow_file.name}: Permissions specified")
        else:
            self.log_issue(
                "CI/CD",
                "medium",
                "No CI/CD workflows found",
                "Set up GitHub Actions workflows for security"
            )
        
        # Cap the score at 10
        score = min(score, 10)
        self.results["scores"]["ci_security"] = score
        return score
    
    def generate_report(self) -> Dict[str, Any]:
        """Generate final security configuration report."""
        from datetime import datetime
        
        self.results["timestamp"] = datetime.now().isoformat()
        
        # Calculate overall score
        scores = self.results["scores"]
        if scores:
            total_score = sum(scores.values())
            max_score = len(scores) * 10
            percentage = (total_score / max_score) * 100
            
            if percentage >= 90:
                status = "excellent"
            elif percentage >= 80:
                status = "good"
            elif percentage >= 70:
                status = "fair"
            elif percentage >= 60:
                status = "poor"
            else:
                status = "critical"
            
            self.results["overall_status"] = status
            self.results["overall_score"] = total_score
            self.results["max_score"] = max_score
            self.results["percentage"] = percentage
        
        return self.results
    
    def run_all_checks(self) -> Dict[str, Any]:
        """Run all security configuration checks."""
        print("🛡️ CCTelegram Security Configuration Checker")
        print("=" * 50)
        
        checks = [
            ("File Permissions", self.check_file_permissions),
            ("Environment Variables", self.check_environment_variables),
            ("Authentication", self.check_authentication_config),
            ("Rate Limiting", self.check_rate_limiting),
            ("Input Validation", self.check_input_validation),
            ("Logging Security", self.check_logging_security),
            ("Dependency Security", self.check_dependency_security),
            ("CI/CD Security", self.check_ci_security)
        ]
        
        total_score = 0
        max_score = len(checks) * 10
        
        for check_name, check_func in checks:
            try:
                score = check_func()
                total_score += score
                print(f"📊 {check_name}: {score}/10")
            except Exception as e:
                print(f"❌ {check_name}: Error - {e}")
                self.log_issue("SystemError", "critical", f"Check failed: {check_name} - {e}")
        
        percentage = (total_score / max_score) * 100
        
        print("\n" + "=" * 50)
        print(f"🏆 Overall Security Configuration Score: {total_score}/{max_score} ({percentage:.1f}%)")
        
        if percentage >= 90:
            print("✅ Status: EXCELLENT - Security configuration is outstanding")
        elif percentage >= 80:
            print("✅ Status: GOOD - Security configuration is solid")
        elif percentage >= 70:
            print("⚠️ Status: FAIR - Security configuration needs some improvements")
        elif percentage >= 60:
            print("⚠️ Status: POOR - Security configuration has significant issues")
        else:
            print("❌ Status: CRITICAL - Security configuration needs immediate attention")
        
        return self.generate_report()

def main():
    parser = argparse.ArgumentParser(description="CCTelegram Security Configuration Checker")
    parser.add_argument("--project-root", default=".", help="Project root directory")
    parser.add_argument("--output", help="Output JSON report file")
    parser.add_argument("--fail-on-critical", action="store_true", 
                       help="Exit with error code if critical issues found")
    
    args = parser.parse_args()
    
    try:
        checker = SecurityConfigChecker(args.project_root)
        report = checker.run_all_checks()
        
        if args.output:
            with open(args.output, 'w') as f:
                json.dump(report, f, indent=2)
            print(f"\n📄 Report saved to: {args.output}")
        
        # Check for critical issues
        critical_issues = [issue for issue in report["issues"] if issue["severity"] == "critical"]
        
        if args.fail_on_critical and critical_issues:
            print(f"\n❌ Found {len(critical_issues)} critical security issues")
            sys.exit(1)
        
        # Exit with appropriate code based on overall score
        if report.get("percentage", 0) < 70:
            sys.exit(1)
        
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()