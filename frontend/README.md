# Frontend Dashboard (Next.js)

This folder contains the primary web application dashboard used by rescue teams to visualize the data collected from the mesh network.

## Tech Stack
- **Next.js (React)**
- **TypeScript**
- **Tailwind CSS**

## Purpose
The dashboard provides a real-time, visual representation of distress signals. It connects to the Node.js backend to fetch the decrypted locations and timestamps relayed by the Rescue Node.

## Structure
- `/app`: The Next.js App Router containing the main layout and page components.
- `/public`: Static assets.

## Setup
Run `npm install` followed by `npm run dev` to start the development server. Ensure the backend service is running to fetch real data.
