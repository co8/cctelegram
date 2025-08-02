# System Utilities for macOS (Darwin)

## File System Commands
```bash
# List files and directories
ls -la                    # Detailed listing
ls -lah                   # Human-readable sizes
find . -name "*.rs"       # Find Rust files
find . -type f -name "*.toml"  # Find TOML files

# File operations
cp file1 file2            # Copy files
mv file1 file2            # Move/rename files
rm file                   # Remove file
rm -rf directory          # Remove directory recursively
mkdir -p path/to/dir      # Create directory with parents

# File permissions
chmod +x script.sh        # Make executable
chmod 644 file           # Set file permissions
chown user:group file    # Change ownership
```

## Text Processing
```bash
# Search in files
grep -r "pattern" .       # Recursive search
grep -n "pattern" file    # Show line numbers
rg "pattern" .            # ripgrep (faster alternative)

# File content
cat file                  # Display file content
head -n 20 file          # First 20 lines
tail -n 20 file          # Last 20 lines
tail -f file             # Follow file changes
less file                # Paginated view
```

## Process Management
```bash
# Process information
ps aux                    # All running processes
ps aux | grep cc-telegram # Find specific process
pgrep -f cc-telegram     # Find process by name pattern
pkill -f cc-telegram     # Kill process by name

# System monitoring
top                       # Real-time process monitor
htop                      # Enhanced process monitor (if installed)
lsof -i :8080            # List processes using port 8080
netstat -an | grep 8080  # Network connections on port
```

## Git Commands (macOS)
```bash
# Basic git operations
git status               # Repository status
git add .               # Stage all changes
git commit -m "message" # Commit changes
git push                # Push to remote
git pull                # Pull from remote
git log --oneline       # Compact log view
git diff                # Show changes
```

## Network Tools
```bash
# HTTP requests
curl -s http://localhost:8080/health     # Silent request
curl -v http://localhost:8080/metrics    # Verbose output
curl -f http://localhost:8080/report     # Fail on HTTP errors

# Network connectivity
ping google.com          # Test connectivity
nslookup domain.com     # DNS lookup
dig domain.com          # Advanced DNS lookup
```

## macOS-Specific Tools
```bash
# Package management (Homebrew)
brew install curl jq bc  # Install dependencies
brew update              # Update package list
brew upgrade            # Upgrade packages

# System information
sw_vers                 # macOS version
uname -a                # System information
df -h                   # Disk usage
du -sh directory        # Directory size
free                    # Memory usage (may need to install)
```

## Performance Monitoring
```bash
# System resources
activity_monitor        # GUI process monitor
vm_stat 1              # Virtual memory statistics
iostat 1               # I/O statistics
netstat -i             # Network interface statistics

# CPU and memory
sysctl hw.ncpu         # Number of CPU cores
sysctl hw.memsize      # Total memory
top -l 1 | head -10    # Current system load
```

## File Compression and Archives
```bash
# Create archives
tar -czf archive.tar.gz directory/   # Create compressed archive
zip -r archive.zip directory/        # Create zip archive

# Extract archives
tar -xzf archive.tar.gz              # Extract tar.gz
unzip archive.zip                    # Extract zip
```

## Development Environment
```bash
# Rust-specific
which rustc             # Find Rust compiler
rustc --version         # Rust version
cargo --version         # Cargo version
rustup show             # Toolchain information

# Environment variables
export VAR=value        # Set environment variable
env                     # Show all environment variables
echo $VAR              # Show specific variable
```