# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Build Commands
- `npm start`: Start the application in production mode.
- `npm run dev`: Start the application in development mode with file watching.

## Code Style
- Uses Express.js for the web framework.
- Follows standard JavaScript coding conventions.
- Uses UUID for generating unique identifiers.
- Uses Multer for handling file uploads.

## Critical Patterns
- The runtime registry (`src/runtime.js`) is the single source of truth for real-time data.
- The stream engine (`src/stream-engine/index.js`) manages FFmpeg processes and stream states.
- The viewer manager (`src/viewer-manager/index.js`) handles viewer connections and heartbeats.
- The health module (`src/health/index.js`) monitors and records system health.

## Testing
- No specific testing framework is mentioned in the codebase.
- Manual testing is recommended for the viewer and admin interfaces.