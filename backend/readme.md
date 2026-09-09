# Backend Service

This folder contains the backend infrastructure for the Disaster Management Mesh Network, responsible for data ingestion, processing, and serving the frontend dashboard.

## Tech Stack
- **Node.js** with **Express**
- **TypeScript**
- **Prisma ORM**
- **PostgreSQL** database

## Purpose
When the Rescue Node receives and decrypts messages from the mesh, it needs a place to persist and analyze this critical data. The backend exposes API routes to ingest distress signals, log locations and timestamps, and serve this aggregated data to the React/Next.js frontend dashboards.

## Structure
- `/src`: The TypeScript source files for the API routes and server configuration.
- `/prisma`: The database schema definition (`schema.prisma`).
- `package.json`: Project scripts (`npm run dev`, `npm start`, `npm run build`) and dependencies.

## Setup
Ensure you have a running PostgreSQL instance and provide the connection URL in the `.env` file before running Prisma migrations and starting the server.
