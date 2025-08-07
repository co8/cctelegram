#!/usr/bin/env python3
"""
Link Validation Script for CCTelegram Documentation
Validates all internal markdown links across the documentation structure
"""

import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Set, Tuple
from urllib.parse import unquote

class LinkValidator:
    def __init__(self, docs_root: str):
        self.docs_root = Path(docs_root).resolve()
        self.project_root = self.docs_root.parent
        self.broken_links = []
        self.valid_links = []
        self.anchor_issues = []
        
    def extract_markdown_links(self, file_path: Path) -> List[Tuple[str, str, int]]:
        """Extract all markdown links from a file"""
        links = []
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Pattern to match [text](link) or [text](link#anchor)
            pattern = r'\[([^\]]*)\]\(([^)]+)\)'
            
            for line_num, line in enumerate(content.split('\n'), 1):
                matches = re.finditer(pattern, line)
                for match in matches:
                    text, link = match.groups()
                    # Skip external links (http/https)
                    if not link.startswith(('http://', 'https://', 'mailto:')):
                        links.append((text, link, line_num))
        except Exception as e:
            print(f"Error reading {file_path}: {e}")
        return links
    
    def resolve_relative_path(self, current_file: Path, link: str) -> Path:
        """Resolve relative path from current file to target"""
        # Remove anchor if present
        link_path = link.split('#')[0] if '#' in link else link
        
        # Handle different relative path formats
        current_dir = current_file.parent
        
        if link_path.startswith('./'):
            # Current directory relative
            return (current_dir / link_path[2:]).resolve()
        elif link_path.startswith('../'):
            # Parent directory relative
            return (current_dir / link_path).resolve()
        elif link_path.startswith('/'):
            # Root relative - from project root
            return (self.project_root / link_path[1:]).resolve()
        else:
            # Relative to current directory
            return (current_dir / link_path).resolve()
    
    def validate_anchor(self, file_path: Path, anchor: str) -> bool:
        """Validate that an anchor exists in the target file"""
        if not file_path.exists() or not file_path.suffix == '.md':
            return False
            
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Convert anchor to the format used in markdown
            # GitHub-style anchors: lowercase, spaces to dashes, remove special chars
            anchor_normalized = anchor.lower().replace(' ', '-')
            anchor_normalized = re.sub(r'[^\w\-]', '', anchor_normalized)
            
            # Look for headers that would generate this anchor
            header_patterns = [
                rf'^#+\s+.*{re.escape(anchor)}.*$',  # Direct match
                rf'^#+\s+.*{re.escape(anchor.replace("-", " "))}.*$',  # Space version
                rf'^#+\s+.*{re.escape(anchor_normalized)}.*$',  # Normalized version
            ]
            
            for pattern in header_patterns:
                if re.search(pattern, content, re.MULTILINE | re.IGNORECASE):
                    return True
                    
            # Check for explicit anchor tags
            if f'<a name="{anchor}"' in content or f'id="{anchor}"' in content:
                return True
                
        except Exception as e:
            print(f"Error checking anchor in {file_path}: {e}")
            
        return False
    
    def validate_link(self, current_file: Path, link: str, text: str, line_num: int) -> bool:
        """Validate a single link"""
        # Check if it's a directory link
        if link.endswith('/'):
            # Look for index.md or README.md in the directory
            dir_path = self.resolve_relative_path(current_file, link)
            potential_files = [dir_path / 'README.md', dir_path / 'index.md']
            
            for potential_file in potential_files:
                if potential_file.exists():
                    self.valid_links.append(f"{current_file.relative_to(self.project_root)}:{line_num} → {link}")
                    return True
                    
            self.broken_links.append({
                'file': current_file.relative_to(self.project_root),
                'line': line_num,
                'text': text,
                'link': link,
                'issue': 'Directory index not found',
                'resolved_path': str(dir_path)
            })
            return False
        
        # Handle anchors
        anchor = None
        if '#' in link:
            link_path, anchor = link.split('#', 1)
            anchor = unquote(anchor)  # Decode URL encoding
        else:
            link_path = link
        
        # Resolve the file path
        if link_path == '':
            # Same-file anchor
            target_path = current_file
        else:
            target_path = self.resolve_relative_path(current_file, link_path)
        
        # Check if target file exists
        if not target_path.exists():
            self.broken_links.append({
                'file': current_file.relative_to(self.project_root),
                'line': line_num,
                'text': text,
                'link': link,
                'issue': 'File not found',
                'resolved_path': str(target_path)
            })
            return False
        
        # Check anchor if present
        if anchor:
            if not self.validate_anchor(target_path, anchor):
                self.anchor_issues.append({
                    'file': current_file.relative_to(self.project_root),
                    'line': line_num,
                    'text': text,
                    'link': link,
                    'anchor': anchor,
                    'target_file': str(target_path.relative_to(self.project_root))
                })
                return False
        
        self.valid_links.append(f"{current_file.relative_to(self.project_root)}:{line_num} → {link}")
        return True
    
    def scan_directory(self) -> None:
        """Scan all markdown files in the documentation"""
        md_files = list(self.docs_root.rglob('*.md'))
        
        # Also include root level markdown files
        root_md_files = list(self.project_root.glob('*.md'))
        md_files.extend(root_md_files)
        
        print(f"Scanning {len(md_files)} markdown files...")
        
        for md_file in md_files:
            links = self.extract_markdown_links(md_file)
            
            for text, link, line_num in links:
                self.validate_link(md_file, link, text, line_num)
    
    def generate_report(self) -> str:
        """Generate a comprehensive validation report"""
        report = []
        report.append("# CCTelegram Documentation Link Validation Report")
        report.append(f"Generated on: {Path().cwd()}")
        report.append("")
        
        # Summary
        total_links = len(self.valid_links) + len(self.broken_links)
        report.append("## Summary")
        report.append(f"- **Total Links Checked**: {total_links}")
        report.append(f"- **Valid Links**: {len(self.valid_links)}")
        report.append(f"- **Broken Links**: {len(self.broken_links)}")
        report.append(f"- **Anchor Issues**: {len(self.anchor_issues)}")
        report.append("")
        
        if len(self.broken_links) == 0 and len(self.anchor_issues) == 0:
            report.append("✅ **All links are valid!**")
        else:
            report.append("❌ **Issues found that need fixing:**")
        
        report.append("")
        
        # Broken Links
        if self.broken_links:
            report.append("## 🔴 Broken Links")
            report.append("")
            for i, link in enumerate(self.broken_links, 1):
                report.append(f"### {i}. {link['issue']}")
                report.append(f"- **File**: `{link['file']}:{link['line']}`")
                report.append(f"- **Link Text**: \"{link['text']}\"")
                report.append(f"- **Link URL**: `{link['link']}`")
                report.append(f"- **Resolved Path**: `{link['resolved_path']}`")
                report.append("")
        
        # Anchor Issues
        if self.anchor_issues:
            report.append("## 🟡 Anchor Issues")
            report.append("")
            for i, issue in enumerate(self.anchor_issues, 1):
                report.append(f"### {i}. Missing Anchor")
                report.append(f"- **File**: `{issue['file']}:{issue['line']}`")
                report.append(f"- **Link Text**: \"{issue['text']}\"")
                report.append(f"- **Full Link**: `{issue['link']}`")
                report.append(f"- **Missing Anchor**: `#{issue['anchor']}`")
                report.append(f"- **Target File**: `{issue['target_file']}`")
                report.append("")
        
        # Valid Links Summary
        if self.valid_links:
            report.append("## ✅ Valid Links Summary")
            report.append(f"Found {len(self.valid_links)} valid links across the documentation.")
            report.append("")
        
        return "\n".join(report)

def main():
    docs_root = Path(__file__).parent.parent  # Go up from reference/ to docs/
    validator = LinkValidator(str(docs_root))
    
    print("🔍 Starting link validation...")
    validator.scan_directory()
    
    print("📊 Generating report...")
    report = validator.generate_report()
    
    # Write report
    report_file = docs_root / 'reference' / 'link_validation_report.md'
    with open(report_file, 'w', encoding='utf-8') as f:
        f.write(report)
    
    print(f"📝 Report saved to: {report_file}")
    
    # Print summary to console
    total_issues = len(validator.broken_links) + len(validator.anchor_issues)
    if total_issues == 0:
        print("✅ All links are valid!")
        return 0
    else:
        print(f"❌ Found {total_issues} issues:")
        print(f"   - {len(validator.broken_links)} broken links")
        print(f"   - {len(validator.anchor_issues)} anchor issues")
        return 1

if __name__ == "__main__":
    sys.exit(main())