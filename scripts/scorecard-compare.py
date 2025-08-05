#!/usr/bin/env python3
"""
OpenSSF Scorecard comparison script for CCTelegram
Compares current scorecard results with baseline to identify improvements and regressions
"""

import json
import sys
import argparse
from typing import Dict, Any, Tuple, List
from datetime import datetime
import os

def load_scorecard_data(filepath: str) -> Dict[str, Any]:
    """Load scorecard data from JSON file."""
    try:
        with open(filepath, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        raise FileNotFoundError(f"Scorecard file not found: {filepath}")
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON in {filepath}: {e}")

def calculate_score_diff(current: float, baseline: float) -> Tuple[float, str]:
    """Calculate score difference and status."""
    diff = current - baseline
    if diff > 0:
        status = "improved"
    elif diff < 0:
        status = "declined"
    else:
        status = "unchanged"
    
    return diff, status

def format_score_change(diff: float, status: str) -> str:
    """Format score change with appropriate emoji."""
    if status == "improved":
        return f"📈 +{diff:.1f}"
    elif status == "declined":
        return f"📉 {diff:.1f}"
    else:
        return f"➡️ {diff:.1f}"

def analyze_individual_checks(current_checks: List[Dict], baseline_checks: List[Dict]) -> Dict[str, Dict]:
    """Analyze individual check changes."""
    baseline_dict = {check['name']: check for check in baseline_checks}
    current_dict = {check['name']: check for check in current_checks}
    
    analysis = {}
    
    # Analyze all checks from current scorecard
    for check_name, current_check in current_dict.items():
        baseline_check = baseline_dict.get(check_name, {})
        
        current_score = current_check.get('score', 0)
        baseline_score = baseline_check.get('score', 0)
        
        diff, status = calculate_score_diff(current_score, baseline_score)
        
        analysis[check_name] = {
            'current_score': current_score,
            'baseline_score': baseline_score,
            'diff': diff,
            'status': status,
            'current_reason': current_check.get('reason', ''),
            'baseline_reason': baseline_check.get('reason', ''),
            'documentation': current_check.get('documentation', {})
        }
    
    # Check for any checks that were in baseline but not in current
    for check_name in baseline_dict:
        if check_name not in current_dict:
            analysis[check_name] = {
                'current_score': 0,
                'baseline_score': baseline_dict[check_name].get('score', 0),
                'diff': -baseline_dict[check_name].get('score', 0),
                'status': 'missing',
                'current_reason': 'Check not found in current results',
                'baseline_reason': baseline_dict[check_name].get('reason', ''),
                'documentation': {}
            }
    
    return analysis

def identify_priority_actions(analysis: Dict[str, Dict]) -> List[Dict[str, Any]]:
    """Identify priority actions based on score changes and security impact."""
    actions = []
    
    # High-priority security checks
    security_critical_checks = [
        'Vulnerabilities',
        'Code-Review',
        'Branch-Protection',
        'Token-Permissions',
        'Dangerous-Workflow',
        'Security-Policy'
    ]
    
    for check_name, data in analysis.items():
        if data['status'] == 'declined':
            priority = 'high' if check_name in security_critical_checks else 'medium'
            actions.append({
                'check': check_name,
                'priority': priority,
                'action': 'investigate_decline',
                'current_score': data['current_score'],
                'baseline_score': data['baseline_score'],
                'diff': data['diff'],
                'reason': data['current_reason']
            })
        elif data['status'] == 'missing':
            actions.append({
                'check': check_name,
                'priority': 'high',
                'action': 'restore_check',
                'current_score': data['current_score'],
                'baseline_score': data['baseline_score'],
                'diff': data['diff'],
                'reason': data['current_reason']
            })
        elif data['current_score'] < 7 and check_name in security_critical_checks:
            actions.append({
                'check': check_name,
                'priority': 'medium',
                'action': 'improve_security',
                'current_score': data['current_score'],
                'baseline_score': data['baseline_score'],
                'diff': data['diff'],
                'reason': data['current_reason']
            })
    
    # Sort by priority and score difference
    priority_order = {'high': 0, 'medium': 1, 'low': 2}
    actions.sort(key=lambda x: (priority_order[x['priority']], x['diff']))
    
    return actions

def generate_markdown_report(current_data: Dict, baseline_data: Dict, analysis: Dict, actions: List) -> str:
    """Generate a comprehensive markdown report."""
    current_score = current_data.get('score', 0)
    baseline_score = baseline_data.get('score', 0)
    score_diff, score_status = calculate_score_diff(current_score, baseline_score)
    
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S UTC")
    
    report = f"""# 🏆 OpenSSF Scorecard Comparison Report

Generated: {timestamp}

## 📊 Overall Score Comparison

| Metric | Current | Baseline | Change |
|--------|---------|----------|--------|
| **Overall Score** | {current_score:.1f}/10 | {baseline_score:.1f}/10 | {format_score_change(score_diff, score_status)} |

"""

    # Overall assessment
    if score_status == "improved":
        report += "### 🎉 Assessment: IMPROVED\n\nThe project's security posture has improved since the baseline.\n\n"
    elif score_status == "declined":
        report += "### ⚠️ Assessment: DECLINED\n\nThe project's security posture has declined since the baseline. Immediate attention required.\n\n"
    else:
        report += "### ➡️ Assessment: UNCHANGED\n\nThe project's security posture remains stable.\n\n"

    # Individual check analysis
    report += "## 🔍 Individual Check Analysis\n\n"
    report += "| Check | Current | Baseline | Change | Status |\n"
    report += "|-------|---------|----------|--------|---------|\n"
    
    for check_name, data in sorted(analysis.items()):
        status_emoji = {
            'improved': '📈',
            'declined': '📉',
            'unchanged': '➡️',
            'missing': '❌'
        }.get(data['status'], '❓')
        
        report += f"| {check_name} | {data['current_score']:.1f} | {data['baseline_score']:.1f} | {format_score_change(data['diff'], data['status'])} | {status_emoji} |\n"
    
    # Priority actions
    if actions:
        report += "\n## 🎯 Priority Actions\n\n"
        
        high_priority = [a for a in actions if a['priority'] == 'high']
        medium_priority = [a for a in actions if a['priority'] == 'medium']
        
        if high_priority:
            report += "### 🚨 High Priority\n\n"
            for action in high_priority:
                report += f"- **{action['check']}** (Score: {action['current_score']:.1f}, Change: {action['diff']:+.1f})\n"
                report += f"  - Action: {action['action'].replace('_', ' ').title()}\n"
                report += f"  - Reason: {action['reason']}\n\n"
        
        if medium_priority:
            report += "### ⚠️ Medium Priority\n\n"
            for action in medium_priority:
                report += f"- **{action['check']}** (Score: {action['current_score']:.1f}, Change: {action['diff']:+.1f})\n"
                report += f"  - Action: {action['action'].replace('_', ' ').title()}\n"
                report += f"  - Reason: {action['reason']}\n\n"
    else:
        report += "\n## ✅ No Priority Actions Required\n\nAll security checks are performing well.\n\n"
    
    # Detailed check information
    report += "## 📋 Detailed Check Information\n\n"
    
    for check_name, data in sorted(analysis.items()):
        if data['status'] in ['declined', 'missing'] or data['current_score'] < 7:
            report += f"### {check_name}\n\n"
            report += f"- **Current Score**: {data['current_score']:.1f}/10\n"
            report += f"- **Baseline Score**: {data['baseline_score']:.1f}/10\n"
            report += f"- **Change**: {format_score_change(data['diff'], data['status'])}\n"
            report += f"- **Current Reason**: {data['current_reason']}\n"
            
            if data['baseline_reason'] and data['baseline_reason'] != data['current_reason']:
                report += f"- **Baseline Reason**: {data['baseline_reason']}\n"
            
            # Add documentation links if available
            if data['documentation']:
                doc = data['documentation']
                if doc.get('url'):
                    report += f"- **Documentation**: [{doc.get('short', 'Learn more')}]({doc['url']})\n"
            
            report += "\n"
    
    # Recommendations
    report += "## 💡 Recommendations\n\n"
    
    if score_diff < -0.5:
        report += "### 🚨 Immediate Actions\n"
        report += "- Review recent changes that may have affected security posture\n"
        report += "- Check for new vulnerabilities in dependencies\n"
        report += "- Verify branch protection rules are still in place\n"
        report += "- Review access controls and permissions\n\n"
    
    report += "### 🔄 Regular Maintenance\n"
    report += "- Run scorecard analysis weekly\n"
    report += "- Update dependencies regularly\n"
    report += "- Review and update security policies\n"
    report += "- Monitor for new security advisories\n\n"
    
    report += "### 📈 Continuous Improvement\n"
    report += "- Implement missing security checks\n"
    report += "- Enhance documentation and security policies\n"
    report += "- Consider additional security tools and practices\n"
    report += "- Regular security training for team members\n\n"
    
    report += "---\n\n"
    report += "*This report was generated by the CCTelegram scorecard comparison tool*\n"
    
    return report

def generate_json_summary(current_data: Dict, baseline_data: Dict, analysis: Dict, actions: List) -> Dict:
    """Generate a JSON summary for programmatic use."""
    current_score = current_data.get('score', 0)
    baseline_score = baseline_data.get('score', 0)
    score_diff, score_status = calculate_score_diff(current_score, baseline_score)
    
    return {
        'timestamp': datetime.now().isoformat(),
        'overall': {
            'current_score': current_score,
            'baseline_score': baseline_score,
            'diff': score_diff,
            'status': score_status
        },
        'checks': analysis,
        'priority_actions': actions,
        'summary': {
            'improved_checks': len([a for a in analysis.values() if a['status'] == 'improved']),
            'declined_checks': len([a for a in analysis.values() if a['status'] == 'declined']),
            'unchanged_checks': len([a for a in analysis.values() if a['status'] == 'unchanged']),
            'missing_checks': len([a for a in analysis.values() if a['status'] == 'missing']),
            'high_priority_actions': len([a for a in actions if a['priority'] == 'high']),
            'medium_priority_actions': len([a for a in actions if a['priority'] == 'medium'])
        }
    }

def main():
    parser = argparse.ArgumentParser(description='Compare OpenSSF Scorecard results')
    parser.add_argument('current', help='Path to current scorecard results JSON file')
    parser.add_argument('baseline', help='Path to baseline scorecard results JSON file')
    parser.add_argument('--output-format', choices=['markdown', 'json', 'both'], default='markdown',
                        help='Output format (default: markdown)')
    parser.add_argument('--output-file', help='Output file path (default: stdout for markdown, scorecard-comparison.json for JSON)')
    parser.add_argument('--exit-on-decline', action='store_true',
                        help='Exit with error code if overall score declined')
    
    args = parser.parse_args()
    
    try:
        # Load data
        current_data = load_scorecard_data(args.current)
        baseline_data = load_scorecard_data(args.baseline)
        
        # Analyze
        current_checks = current_data.get('checks', [])
        baseline_checks = baseline_data.get('checks', [])
        
        analysis = analyze_individual_checks(current_checks, baseline_checks)
        priority_actions = identify_priority_actions(analysis)
        
        # Generate output
        if args.output_format in ['markdown', 'both']:
            markdown_report = generate_markdown_report(current_data, baseline_data, analysis, priority_actions)
            
            if args.output_file and args.output_format == 'markdown':
                with open(args.output_file, 'w') as f:
                    f.write(markdown_report)
                print(f"Markdown report written to {args.output_file}")
            elif args.output_format == 'markdown':
                print(markdown_report)
            else:  # both format
                markdown_file = args.output_file or 'scorecard-comparison.md'
                with open(markdown_file, 'w') as f:
                    f.write(markdown_report)
                print(f"Markdown report written to {markdown_file}")
        
        if args.output_format in ['json', 'both']:
            json_summary = generate_json_summary(current_data, baseline_data, analysis, priority_actions)
            
            json_file = args.output_file if args.output_format == 'json' else 'scorecard-comparison.json'
            with open(json_file, 'w') as f:
                json.dump(json_summary, f, indent=2)
            
            if args.output_format == 'json':
                print(json.dumps(json_summary, indent=2))
            else:
                print(f"JSON summary written to {json_file}")
        
        # Exit code handling
        if args.exit_on_decline:
            current_score = current_data.get('score', 0)
            baseline_score = baseline_data.get('score', 0)
            
            if current_score < baseline_score:
                print(f"ERROR: Score declined from {baseline_score:.1f} to {current_score:.1f}", file=sys.stderr)
                sys.exit(1)
        
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()