#!/bin/bash

# Start Ponder and Realtime Server together

echo "Starting Ponder and Realtime Server..."

# Start Ponder in the background
PORT=${PORT:-42069} ponder start &
PONDER_PID=$!

# Start Realtime Server in the background
REALTIME_PORT=${REALTIME_PORT:-42070} tsx realtime-server.ts &
REALTIME_PID=$!

echo "Ponder running with PID: $PONDER_PID"
echo "Realtime Server running with PID: $REALTIME_PID"

# Wait for both processes
wait $PONDER_PID $REALTIME_PID

